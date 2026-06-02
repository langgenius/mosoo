import type { DriverEventInput } from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";

import { DriverTurnCancelledError } from "../../core/driver-runtime-state";
import type { AgentDriverContext } from "../agent-driver-backend";
import { toOpenAiErrorMessage, toOpenAiSessionUsageSummary } from "./app-server-event-mapping";
import {
  OpenAiItemState,
  OpenAiMessageState,
  OpenAiPlanState,
  OpenAiToolState,
} from "./app-server-event-state";
import { OpenAiAppServerItemEventBridge } from "./app-server-item-events";
import { isRecord, readNonEmptyString, readRecord, readString } from "./app-server-json";
import type { JsonObject } from "./app-server-json";
import { OpenAiTurnTracker } from "./app-server-turn-tracker";
import type {
  ServerNotificationMethod,
  ServerNotificationParams,
} from "./generated/app-server-protocol";

interface OpenAiAppServerEventBridgeOptions {
  push(context: AgentDriverContext, reason: string, events: DriverEventInput[]): Promise<void>;
  requireThreadId(): string;
}

function createOpenAiTurnSourceEventId(eventName: string, turnId: string): string {
  return `openai.${eventName}:${turnId}`;
}

function createOpenAiTurnEventFields(input: {
  eventName: string;
  runId?: SessionRunId | undefined;
  turnId: string;
}): {
  native: { eventName: string; provider: string; turnId: string };
  runId?: SessionRunId | undefined;
  sourceEventId: string;
} {
  return {
    native: {
      eventName: input.eventName,
      provider: "openai",
      turnId: input.turnId,
    },
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    sourceEventId: createOpenAiTurnSourceEventId(input.eventName, input.turnId),
  };
}

export class OpenAiAppServerEventBridge {
  readonly #itemEvents: OpenAiAppServerItemEventBridge;
  readonly #items = new OpenAiItemState();
  readonly #messages = new OpenAiMessageState();
  readonly #options: OpenAiAppServerEventBridgeOptions;
  readonly #plans = new OpenAiPlanState();
  readonly #tools = new OpenAiToolState();
  readonly #turns = new OpenAiTurnTracker();
  #runtimeErrorEmitted = false;

  constructor(options: OpenAiAppServerEventBridgeOptions) {
    this.#options = options;
    this.#itemEvents = new OpenAiAppServerItemEventBridge({
      items: this.#items,
      messages: this.#messages,
      plans: this.#plans,
      push: (context, reason, events) => this.#push(context, reason, events),
      tools: this.#tools,
    });
  }

  activeTurnIds(): string[] {
    return this.#turns.activeTurnIds();
  }

  clearActiveTurns(): void {
    this.#turns.clearActiveTurns();
  }

  rejectTurn(turnId: string, error: Error): void {
    this.#turns.rejectTurn(turnId, error);
  }

  rejectActiveTurns(error: Error): void {
    this.#turns.rejectActiveTurns(error);
  }

  markTurnCancelled(turnId: string, reason: string): void {
    this.#turns.markCancelled(turnId, reason);
  }

  resetRuntimeError(): void {
    this.#runtimeErrorEmitted = false;
  }

  async trackTurn(turnId: string, runId: SessionRunId): Promise<void> {
    return this.#turns.track(turnId, runId);
  }

  async handleNotification<M extends ServerNotificationMethod>(
    context: AgentDriverContext,
    method: M,
    params: ServerNotificationParams[M],
  ): Promise<void> {
    const payload = isRecord(params) ? params : {};

    switch (method) {
      case "configWarning": {
        this.#handleConfigWarning(context, payload);
        return;
      }
      case "warning": {
        this.#handleWarning(context, payload);
        return;
      }
      case "remoteControl/status/changed": {
        this.#handleRemoteControlStatusChanged(context, payload);
        return;
      }
      case "thread/started": {
        this.#handleThreadStarted(context, payload);
        return;
      }
      case "thread/status/changed": {
        await this.#handleThreadStatusChanged(context, payload);
        return;
      }
      case "thread/settings/updated": {
        this.#handleThreadSettingsUpdated(context, payload);
        return;
      }
      case "turn/started": {
        await this.#handleTurnStarted(context, payload);
        return;
      }
      case "item/started": {
        await this.#itemEvents.handleItemStarted(context, payload);
        return;
      }
      case "item/agentMessage/delta": {
        await this.#itemEvents.handleAgentMessageDelta(context, payload);
        return;
      }
      case "item/plan/delta": {
        await this.#itemEvents.handlePlanDelta(context, payload);
        return;
      }
      case "item/reasoning/summaryPartAdded":
      case "item/reasoning/summaryTextDelta": {
        await this.#itemEvents.handleReasoningSummaryDelta(context, payload);
        return;
      }
      case "item/reasoning/textDelta": {
        return;
      }
      case "item/completed": {
        await this.#itemEvents.handleItemCompleted(context, payload);
        return;
      }
      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta": {
        await this.#itemEvents.handleToolOutputDelta(context, payload);
        return;
      }
      case "item/fileChange/patchUpdated": {
        await this.#itemEvents.handleFileChangePatchUpdated(context, payload);
        return;
      }
      case "thread/tokenUsage/updated": {
        await this.#handleUsageUpdated(context, payload);
        return;
      }
      case "turn/completed": {
        await this.#handleTurnCompleted(context, payload);
        return;
      }
      case "turn/diff/updated": {
        await this.#handleTurnDiffUpdated(context, payload);
        return;
      }
      case "turn/plan/updated": {
        await this.#itemEvents.handleTurnPlanUpdated(context, payload);
        return;
      }
      case "error": {
        await this.#handleRuntimeError(context, payload);
        return;
      }
      default: {
        return;
      }
    }
  }

  async publishNativeResumeRef(context: AgentDriverContext): Promise<void> {
    await this.#push(context, "driver.openai.native_resume_ref.updated", [
      {
        kind: "runtime.resume.updated",
        payload: {
          resumePointer: this.#options.requireThreadId(),
          threadId: this.#options.requireThreadId(),
        },
        visibility: "owner_debug",
      },
    ]);
  }

  async publishRunStarted(
    context: AgentDriverContext,
    input: { runId?: SessionRunId | undefined; turnId: string },
  ): Promise<void> {
    if (!this.#turns.markTurnStarted(input.turnId)) {
      return;
    }

    await this.#push(context, "driver.openai.turn.started", [
      {
        ...createOpenAiTurnEventFields({
          eventName: "turn.started",
          runId: input.runId,
          turnId: input.turnId,
        }),
        kind: "run.started",
        payload: {
          startedAt: new Date().toISOString(),
        },
      },
    ]);
  }

  #handleConfigWarning(context: AgentDriverContext, params: JsonObject): void {
    context.logger.warn("driver.openai.config.warning", {
      details: readString(params, "details"),
      path: readString(params, "path"),
      range: readRecord(params, "range"),
      summary: readString(params, "summary") ?? "OpenAi app-server configuration warning.",
    });
  }

  #handleRemoteControlStatusChanged(context: AgentDriverContext, params: JsonObject): void {
    context.logger.debug("driver.openai.remote_control.status_changed", {
      environmentId: readString(params, "environmentId"),
      installationId: readString(params, "installationId"),
      serverName: readString(params, "serverName"),
      status: readString(params, "status"),
    });
  }

  #handleThreadSettingsUpdated(context: AgentDriverContext, params: JsonObject): void {
    const threadSettings = readRecord(params, "threadSettings");

    context.logger.debug("driver.openai.thread.settings_updated", {
      model: readString(threadSettings, "model"),
      modelProvider: readString(threadSettings, "modelProvider"),
      threadIdPresent: readString(params, "threadId") !== null,
    });
  }

  #handleThreadStarted(context: AgentDriverContext, params: JsonObject): void {
    const thread = readRecord(params, "thread");

    context.logger.debug("driver.openai.thread.started", {
      threadIdPresent: readString(thread, "id") !== null,
    });
  }

  async #handleThreadStatusChanged(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const status = readRecord(params, "status");
    const statusType = readString(status, "type");

    context.logger.debug("driver.openai.thread.status_changed", {
      status: statusType,
      threadIdPresent: readString(params, "threadId") !== null,
    });

    if (statusType === "systemError") {
      await this.#handleRuntimeError(context, {
        message: "OpenAi app-server thread entered systemError.",
      });
    }
  }

  #handleWarning(context: AgentDriverContext, params: JsonObject): void {
    context.logger.warn("driver.openai.warning", {
      message: readString(params, "message") ?? "OpenAi app-server warning.",
      threadIdPresent: readString(params, "threadId") !== null,
    });
  }

  async #handleRuntimeError(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const error = readRecord(params, "error");
    const message =
      readString(error, "message") ?? readString(params, "message") ?? "OpenAi app-server error.";
    const additionalDetails = readString(error, "additionalDetails");
    const displayMessage = toOpenAiErrorMessage(message, additionalDetails);
    const turnId = readString(params, "turnId");
    const willRetry = params["willRetry"] === true;

    if (willRetry) {
      context.logger.warn("driver.openai.error.retrying", {
        additionalDetails,
        message,
        threadIdPresent: readString(params, "threadId") !== null,
        turnIdPresent: turnId !== null,
      });
      return;
    }

    const errorResult = new Error(displayMessage);
    const runId = turnId === null ? undefined : (this.#turns.activeRunId(turnId) ?? undefined);

    if (turnId !== null) {
      this.#turns.settle(turnId, { error: errorResult, kind: "failed" });
    } else {
      for (const activeTurnId of this.activeTurnIds()) {
        this.#turns.settle(activeTurnId, { error: errorResult, kind: "failed" });
      }
    }

    if (this.#runtimeErrorEmitted) {
      return;
    }

    this.#runtimeErrorEmitted = true;

    await this.#push(context, "driver.openai.error", [
      {
        ...(turnId === null
          ? {}
          : createOpenAiTurnEventFields({
              eventName: "turn.failed",
              runId,
              turnId,
            })),
        kind: "run.failed",
        payload: {
          error: {
            code: "openai.app_server.error",
            message: displayMessage,
          },
          recoverable: false,
        },
      },
    ]);
  }

  async #handleTurnCompleted(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const turn = readRecord(params, "turn");
    const turnId = turn === null ? null : readNonEmptyString(turn, "id");

    if (turnId === null || this.#turns.hasTerminal(turnId)) {
      return;
    }

    const runId = this.#turns.activeRunId(turnId) ?? undefined;

    await this.publishRunStarted(context, { runId, turnId });
    await this.#itemEvents.handleTurnCompletedItems(context, params, turnId);
    const status = turn ? readString(turn, "status") : null;
    const error = turn ? readRecord(turn, "error") : null;
    const cancellationReason = this.#turns.takeCancellationReason(turnId);

    if (cancellationReason !== null || status === "interrupted") {
      this.#turns.settle(turnId, {
        error: new DriverTurnCancelledError(cancellationReason ?? "OpenAI turn was interrupted."),
        kind: "failed",
      });
      return;
    }

    if (status === "failed") {
      const message = readString(error, "message") ?? "OpenAi turn failed.";
      await this.#push(context, "driver.openai.turn.failed", [
        {
          ...createOpenAiTurnEventFields({
            eventName: "turn.failed",
            runId,
            turnId,
          }),
          kind: "run.failed",
          payload: {
            error: {
              code: "openai.turn_failed",
              message,
            },
            recoverable: false,
          },
        },
      ]);
      this.#turns.settle(turnId, {
        error: new Error(message),
        kind: "failed",
      });
      return;
    }

    await this.#push(context, "driver.openai.turn.completed", [
      {
        ...createOpenAiTurnEventFields({
          eventName: "turn.completed",
          runId,
          turnId,
        }),
        kind: "run.completed",
        payload: {
          stopReason: "end_turn",
        },
      },
    ]);
    this.#turns.settle(turnId, { kind: "completed" });
  }

  async #handleTurnDiffUpdated(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const turnId = readNonEmptyString(params, "turnId");
    const diff = readString(params, "diff");

    if (turnId === null || diff === null) {
      return;
    }

    await this.#push(context, "driver.openai.turn.diff.updated", [
      {
        kind: "diagnostic.reported",
        payload: {
          diff,
          message: "OpenAI turn diff updated.",
          severity: "info",
          turnId,
        },
        visibility: "owner_debug",
      },
    ]);
  }

  async #handleTurnStarted(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const turn = readRecord(params, "turn");
    const turnId = turn === null ? null : readNonEmptyString(turn, "id");

    if (turnId === null) {
      return;
    }

    const runId = this.#turns.activeRunId(turnId) ?? undefined;

    await this.publishRunStarted(context, { runId, turnId });
  }

  async #handleUsageUpdated(context: AgentDriverContext, params: JsonObject): Promise<void> {
    await this.#push(context, "driver.openai.usage.updated", [
      {
        kind: "usage.updated",
        payload: toOpenAiSessionUsageSummary(params),
      },
    ]);
  }

  async #push(
    context: AgentDriverContext,
    reason: string,
    events: DriverEventInput[],
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.#options.push(context, reason, events);
  }
}
