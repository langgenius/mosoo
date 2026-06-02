import type { DriverEventInput } from "@mosoo/driver-protocol";

import type { AgentDriverContext } from "../agent-driver-backend";
import { shouldIgnoreAcpReplayUpdate, toAcpPermissionResolvedEvent } from "./acp-event-translator";
import type { AcpPermissionOption, AcpTurnEventState } from "./acp-event-translator";
import { AcpFileSystem } from "./acp-file-system";
import { createAcpMethodNotFoundError } from "./acp-json";
import type { AcpJsonRpcNotification, AcpJsonRpcRequest } from "./acp-json";
import { AcpTerminalManager } from "./acp-terminal-manager";
import { isRecord, readNonEmptyString, stringifyForDisplay } from "./acp-types";

interface AcpClientRequestHandlerOptions {
  readonly allowedRoots: readonly string[];
  readonly cwd: string;
  isTurnCancelRequested(): boolean;
  nativeSessionId(): string | null;
  push(context: AgentDriverContext, reason: string, events: DriverEventInput[]): Promise<void>;
  readonly turnEvents: AcpTurnEventState;
}

export class AcpClientRequestHandler {
  readonly #fileSystem: AcpFileSystem;
  readonly #isTurnCancelRequested: () => boolean;
  readonly #nativeSessionId: () => string | null;
  readonly #push: AcpClientRequestHandlerOptions["push"];
  #replayingSession = false;
  #suppressSessionUpdates = false;
  readonly #terminalManager: AcpTerminalManager;
  readonly #turnEvents: AcpTurnEventState;

  constructor(options: AcpClientRequestHandlerOptions) {
    this.#isTurnCancelRequested = options.isTurnCancelRequested;
    this.#nativeSessionId = options.nativeSessionId;
    this.#push = options.push;
    this.#turnEvents = options.turnEvents;
    this.#fileSystem = new AcpFileSystem({
      allowedRoots: options.allowedRoots,
      cwd: options.cwd,
      push: options.push,
    });
    this.#terminalManager = new AcpTerminalManager({
      allowedRoots: options.allowedRoots,
      cwd: options.cwd,
      push: options.push,
    });
  }

  async handleNotification(
    context: AgentDriverContext,
    notification: AcpJsonRpcNotification,
  ): Promise<void> {
    if (notification.method === "session/update") {
      await this.#handleSessionUpdate(context, notification.params);
      return;
    }

    await this.#push(context, "driver.acp.notification.unsupported", [
      {
        kind: "diagnostic.reported",
        payload: {
          message: `Unsupported ACP notification: ${notification.method}.`,
          params: notification.params,
          severity: "info",
        },
        visibility: "owner_debug",
      },
    ]);
  }

  async handleRequest(context: AgentDriverContext, request: AcpJsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case "elicitation/create": {
        return this.#handleElicitationCreate(context, request);
      }
      case "fs/read_text_file": {
        this.#assertSessionScopedParams(request.method, request.params);
        return this.#fileSystem.readTextFile(request.params);
      }
      case "fs/write_text_file": {
        this.#assertSessionScopedParams(request.method, request.params);
        return this.#fileSystem.writeTextFile(context, request.params);
      }
      case "session/request_permission": {
        this.#assertSessionScopedParams(request.method, request.params);
        return this.#handlePermissionRequest(context, request);
      }
      case "session/update": {
        await this.#handleSessionUpdate(context, request.params);
        return null;
      }
      case "terminal/create": {
        this.#assertSessionScopedParams(request.method, request.params);
        return this.#terminalManager.create(context, request.params);
      }
      case "terminal/kill": {
        this.#assertSessionScopedParams(request.method, request.params);
        return this.#terminalManager.kill(context, request.params);
      }
      case "terminal/output": {
        this.#assertSessionScopedParams(request.method, request.params);
        return this.#terminalManager.output(request.params);
      }
      case "terminal/release": {
        this.#assertSessionScopedParams(request.method, request.params);
        return this.#terminalManager.release(context, request.params);
      }
      case "terminal/wait_for_exit": {
        this.#assertSessionScopedParams(request.method, request.params);
        return this.#terminalManager.waitForExit(request.params);
      }
      default: {
        throw createAcpMethodNotFoundError(request.method);
      }
    }
  }

  async stopTerminals(context: AgentDriverContext): Promise<void> {
    await this.#terminalManager.stopAll(context);
  }

  async withSessionReplay<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#replayingSession;
    this.#replayingSession = true;

    try {
      return await operation();
    } finally {
      this.#replayingSession = previous;
    }
  }

  async withSuppressedSessionUpdates<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#suppressSessionUpdates;
    this.#suppressSessionUpdates = true;

    try {
      return await operation();
    } finally {
      this.#suppressSessionUpdates = previous;
    }
  }

  async #handleElicitationCreate(
    context: AgentDriverContext,
    request: AcpJsonRpcRequest,
  ): Promise<{ action: "decline" }> {
    const requestId = String(request.id);
    const runId = this.#turnEvents.activeRunId();
    const params = isRecord(request.params) ? request.params : null;
    await this.#push(context, "driver.acp.elicitation.declined", [
      {
        kind: "user.input.requested",
        payload: {
          mode: readNonEmptyString(params, "mode"),
          prompt: readNonEmptyString(params, "message") ?? "User input requested",
          requestId,
          schema: params?.["requestedSchema"] ?? null,
        },
        ...(runId === null ? {} : { runId }),
      },
      {
        kind: "user.input.resolved",
        payload: {
          outcome: "declined",
          requestId,
        },
        ...(runId === null ? {} : { runId }),
      },
    ]);

    return { action: "decline" };
  }

  async #handlePermissionRequest(
    context: AgentDriverContext,
    request: AcpJsonRpcRequest,
  ): Promise<{ outcome: { optionId?: string; outcome: "cancelled" | "selected" } }> {
    if (this.#suppressSessionUpdates) {
      return { outcome: { outcome: "cancelled" } };
    }

    const requestId = String(request.id);
    const runId = this.#turnEvents.activeRunId();
    const translation = this.#turnEvents.translatePermissionRequest({
      params: request.params,
      requestId,
    });
    await this.#push(context, "driver.acp.permission.requested", translation.events);
    const chosen = await this.#resolvePermission(
      context,
      requestId,
      translation.options,
      request.params,
    );
    const resolvedOption = this.#isTurnCancelRequested() ? null : chosen;
    await this.#push(context, "driver.acp.permission.resolved", [
      toAcpPermissionResolvedEvent({
        option: resolvedOption,
        requestId,
        runId,
      }),
    ]);

    if (resolvedOption === null) {
      return { outcome: { outcome: "cancelled" } };
    }

    return {
      outcome: {
        optionId: resolvedOption.optionId,
        outcome: "selected",
      },
    };
  }

  async #handleSessionUpdate(context: AgentDriverContext, params: unknown): Promise<void> {
    this.#assertSessionScopedParams("session/update", params);

    if (this.#suppressSessionUpdates) {
      return;
    }

    if (this.#replayingSession && shouldIgnoreAcpReplayUpdate(params)) {
      return;
    }

    const events = this.#turnEvents.translateUpdate(params);

    if (events.length === 0) {
      return;
    }

    await this.#push(context, "driver.acp.session.update", events);
  }

  #assertSessionScopedParams(method: string, params: unknown): void {
    const expectedSessionId = this.#requireNativeSessionId();
    const record = isRecord(params) ? params : null;
    const actualSessionId = readNonEmptyString(record, "sessionId");

    if (actualSessionId === null) {
      throw new Error(`ACP ${method} requires sessionId.`);
    }

    if (actualSessionId !== expectedSessionId) {
      throw new Error(`ACP ${method} sessionId does not match the active session.`);
    }
  }

  async #resolvePermission(
    context: AgentDriverContext,
    requestId: string,
    options: readonly AcpPermissionOption[],
    params: unknown,
  ): Promise<AcpPermissionOption | null> {
    const allowOnce = options.find((option) => option.kind === "allow_once") ?? null;
    const rejectOnce = options.find((option) => option.kind === "reject_once") ?? null;

    if (allowOnce === null && rejectOnce === null) {
      return null;
    }

    const record = isRecord(params) ? params : {};
    const toolCall = isRecord(record["toolCall"]) ? record["toolCall"] : {};
    const decision = await context.permissions.request({
      rawInput: stringifyForDisplay(toolCall["rawInput"]),
      requestId,
      title:
        readNonEmptyString(toolCall, "title") ??
        readNonEmptyString(toolCall, "kind") ??
        "Allow tool call?",
      toolCallId: readNonEmptyString(toolCall, "toolCallId"),
      toolKind: readNonEmptyString(toolCall, "kind"),
    });

    return decision === "allow_once" ? allowOnce : rejectOnce;
  }

  #requireNativeSessionId(): string {
    const sessionId = this.#nativeSessionId();

    if (sessionId === null) {
      throw new Error("ACP driver backend session is not initialized.");
    }

    return sessionId;
  }
}
