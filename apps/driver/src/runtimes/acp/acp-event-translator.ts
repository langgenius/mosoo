import type { DriverEventInput } from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";

import { toAcpPermissionRequest } from "./acp-permission-events";
import type { AcpPermissionTranslation } from "./acp-permission-events";
import {
  normalizePromptUsage,
  summarizeContentBlock,
  toAvailableCommandsEvents,
  toPlanEvents,
  toSessionConfigEvents,
  toSessionInfoEvents,
  toSessionModeEvents,
  toUsageUpdateEvents,
} from "./acp-session-events";
import {
  AcpToolEventState,
  isTerminalToolStatus,
  toRuntimeToolStatus,
  toToolCallPayload,
} from "./acp-tool-events";
import { isRecord, readNonEmptyString, readRecord, readString } from "./acp-types";
import type { AcpPromptStopReason, JsonObject } from "./acp-types";

export type { AcpPermissionOption, AcpPermissionTranslation } from "./acp-permission-events";
export { toAcpPermissionRequest, toAcpPermissionResolvedEvent } from "./acp-permission-events";
export {
  shouldIgnoreAcpReplayUpdate,
  toAcpAuthSessionEvent,
  toAcpInitializeEvents,
  toAcpPromptStartEvents,
  toAcpSessionReadyEvents,
} from "./acp-session-events";

export interface AcpTurnEventStateInput {
  readonly messageId: string;
  readonly runId: SessionRunId;
  readonly sessionId: string;
}

export class AcpTurnEventState {
  #messageCompleted = false;
  #messageId: string | null = null;
  #messageStarted = false;
  #runId: SessionRunId | null = null;
  #sequence = 0;
  #sessionId: string | null = null;
  #thoughtCompleted = false;
  #thoughtId: string | null = null;
  #thoughtStarted = false;
  readonly #tools = new AcpToolEventState();

  activeRunId(): SessionRunId | null {
    return this.#runId;
  }

  begin(input: AcpTurnEventStateInput): void {
    this.#messageCompleted = false;
    this.#messageId = input.messageId;
    this.#messageStarted = false;
    this.#runId = input.runId;
    this.#sequence = 0;
    this.#sessionId = input.sessionId;
    this.#thoughtCompleted = false;
    this.#thoughtId = `${input.messageId}:thought`;
    this.#thoughtStarted = false;
    this.#tools.clear();
  }

  clear(): void {
    this.#messageCompleted = false;
    this.#messageId = null;
    this.#messageStarted = false;
    this.#runId = null;
    this.#sequence = 0;
    this.#sessionId = null;
    this.#thoughtCompleted = false;
    this.#thoughtId = null;
    this.#thoughtStarted = false;
    this.#tools.clear();
  }

  completePrompt(stopReason: AcpPromptStopReason, usage: unknown): DriverEventInput[] {
    const events: DriverEventInput[] = [];
    const runId = this.#requireRunId();

    if (this.#messageStarted && !this.#messageCompleted) {
      this.#messageCompleted = true;
      events.push({
        kind: "message.completed",
        payload: {
          messageId: this.#requireMessageId(),
          role: "agent",
        },
        runId,
      });
    }

    if (this.#thoughtStarted && !this.#thoughtCompleted) {
      this.#thoughtCompleted = true;
      events.push({
        kind: "thought.completed",
        payload: {
          channel: "summary",
          thoughtId: this.#requireThoughtId(),
        },
        runId,
      });
    }

    const promptFailed = stopReason === "max_turn_requests";
    const toolStatus = stopReason === "cancelled" || promptFailed ? "failed" : "completed";
    const toolError =
      stopReason === "cancelled"
        ? "Turn cancelled before tool completion."
        : promptFailed
          ? "Turn failed after the maximum turn request limit."
          : undefined;
    events.push(
      ...this.#tools.completeOpen({
        runId,
        status: toolStatus,
        ...(toolError === undefined ? {} : { error: toolError }),
      }),
    );

    const usagePayload = normalizePromptUsage(usage);

    if (usagePayload !== null) {
      events.push({
        kind: "usage.updated",
        payload: usagePayload,
        runId,
      });
    }

    if (stopReason === "cancelled") {
      events.push({
        kind: "run.cancelled",
        payload: {
          requestedBy: "user",
          stopReason: "cancelled",
        },
        runId,
      });
    } else if (promptFailed) {
      events.push({
        kind: "run.failed",
        payload: {
          error: {
            code: "acp.max_turn_requests",
            message: "ACP prompt stopped after the maximum turn request limit.",
          },
          recoverable: false,
          stopReason,
        },
        runId,
      });
    } else {
      events.push({
        kind: "run.completed",
        payload: {
          stopReason,
        },
        runId,
      });
    }

    this.clear();
    return events;
  }

  failPrompt(error: { code: string; message: string; recoverable?: boolean }): DriverEventInput[] {
    const runId = this.#runId;

    if (runId === null) {
      this.clear();
      return [];
    }

    const events: DriverEventInput[] = [];
    const messageId = this.#messageId;
    const thoughtId = this.#thoughtId;

    if (this.#messageStarted && !this.#messageCompleted && messageId !== null) {
      events.push({
        kind: "message.completed",
        payload: {
          messageId,
          role: "agent",
        },
        runId,
      });
    }

    if (this.#thoughtStarted && !this.#thoughtCompleted && thoughtId !== null) {
      events.push({
        kind: "thought.completed",
        payload: {
          channel: "summary",
          thoughtId,
        },
        runId,
      });
    }

    events.push(
      ...this.#tools.completeOpen({
        error: error.message,
        runId,
        status: "failed",
      }),
    );

    events.push({
      kind: "run.failed",
      payload: {
        error: {
          code: error.code,
          message: error.message,
        },
        recoverable: error.recoverable ?? false,
      },
      runId,
    });

    this.clear();
    return events;
  }

  translateUpdate(params: unknown): DriverEventInput[] {
    const record = isRecord(params) ? params : {};
    const update = readRecord(record, "update");
    const sessionUpdate = readString(update, "sessionUpdate");

    switch (sessionUpdate) {
      case "agent_message_chunk": {
        return this.#translateAgentMessageChunk(update);
      }
      case "agent_thought_chunk": {
        return this.#translateThoughtChunk(update);
      }
      case "available_commands_update": {
        return toAvailableCommandsEvents(update);
      }
      case "config_option_update": {
        return toSessionConfigEvents(update);
      }
      case "current_mode_update": {
        return toSessionModeEvents(update);
      }
      case "plan": {
        return toPlanEvents(update);
      }
      case "session_info_update": {
        return toSessionInfoEvents(update);
      }
      case "tool_call": {
        return this.#translateToolCall(update);
      }
      case "tool_call_update": {
        return this.#translateToolCallUpdate(update);
      }
      case "usage_update": {
        return toUsageUpdateEvents(update);
      }
      case "user_message_chunk":
      case undefined:
      case null: {
        return [];
      }
      default: {
        return [
          {
            kind: "diagnostic.reported",
            payload: {
              message: `Unsupported ACP session update: ${sessionUpdate}.`,
              raw: update,
              severity: "info",
            },
            visibility: "owner_debug",
          },
        ];
      }
    }
  }

  translatePermissionRequest(input: {
    params: unknown;
    requestId: string;
  }): AcpPermissionTranslation {
    const runId = this.activeRunId();
    const translation = toAcpPermissionRequest({
      params: input.params,
      requestId: input.requestId,
      runId,
    });

    if (runId === null || translation.toolCall === null) {
      return translation;
    }

    return {
      ...translation,
      events: [
        ...this.#tools.ensureStarted({
          parentMessageId: this.#messageId ?? undefined,
          runId,
          title: translation.title,
          toolCallId: translation.targetItemId,
        }),
        ...translation.events,
      ],
    };
  }

  #nextSourceEventId(kind: string): string {
    this.#sequence += 1;
    return `acp:${this.#sessionId ?? "session"}:${this.#runId ?? "run"}:${kind}:${this.#sequence}`;
  }

  #translateAgentMessageChunk(update: JsonObject | null): DriverEventInput[] {
    const delta = summarizeContentBlock(update?.["content"]);
    if (delta === null) {
      return [];
    }

    return [
      ...this.#ensureMessageStarted(),
      {
        delivery: "best_effort",
        kind: "message.delta",
        payload: {
          contentBlock: update?.["content"],
          contentDelta: delta,
          messageId: this.#requireMessageId(),
          role: "agent",
        },
        runId: this.#requireRunId(),
        sourceEventId: this.#nextSourceEventId("agent-message"),
      },
    ];
  }

  #translateThoughtChunk(update: JsonObject | null): DriverEventInput[] {
    const delta = summarizeContentBlock(update?.["content"]);

    if (delta === null) {
      return [];
    }

    return [
      ...this.#ensureThoughtStarted(),
      {
        delivery: "best_effort",
        kind: "thought.delta",
        payload: {
          channel: "summary",
          contentBlock: update?.["content"],
          contentDelta: delta,
          thoughtId: this.#requireThoughtId(),
        },
        runId: this.#requireRunId(),
        sourceEventId: this.#nextSourceEventId("agent-thought"),
      },
    ];
  }

  #translateToolCall(update: JsonObject | null): DriverEventInput[] {
    const toolCallId = readNonEmptyString(update, "toolCallId");

    if (toolCallId === null) {
      return [];
    }

    const runId = this.#requireRunId();
    const status = toRuntimeToolStatus(readString(update, "status"));
    const title =
      readNonEmptyString(update, "title") ?? readNonEmptyString(update, "kind") ?? "tool";
    const events = this.#tools.ensureStarted({
      parentMessageId: this.#messageId ?? undefined,
      runId,
      title,
      toolCallId,
    });

    events.push({
      kind: "tool.call.updated",
      payload: toToolCallPayload(toolCallId, status, update),
      runId,
      sourceEventId: this.#nextSourceEventId("tool-call"),
    });

    if (isTerminalToolStatus(readString(update, "status"))) {
      const completion = this.#tools.complete({ runId, status, toolCallId, update });

      if (completion !== null) {
        events.push(completion);
      }
    }

    return events;
  }

  #translateToolCallUpdate(update: JsonObject | null): DriverEventInput[] {
    const toolCallId = readNonEmptyString(update, "toolCallId");

    if (toolCallId === null) {
      return [];
    }

    const runId = this.#requireRunId();
    const status = toRuntimeToolStatus(readString(update, "status"));
    const title =
      readNonEmptyString(update, "title") ?? readNonEmptyString(update, "kind") ?? "tool";
    const events = this.#tools.ensureStarted({
      parentMessageId: this.#messageId ?? undefined,
      runId,
      title,
      toolCallId,
    });

    events.push({
      delivery: status === "running" ? "best_effort" : "lossless",
      kind: "tool.call.updated",
      payload: toToolCallPayload(toolCallId, status, update),
      runId,
      sourceEventId: this.#nextSourceEventId("tool-call-update"),
    });

    if (isTerminalToolStatus(readString(update, "status"))) {
      const completion = this.#tools.complete({ runId, status, toolCallId, update });

      if (completion !== null) {
        events.push(completion);
      }
    }

    return events;
  }

  #ensureMessageStarted(): DriverEventInput[] {
    if (this.#messageStarted) {
      return [];
    }

    this.#messageStarted = true;
    return [
      {
        kind: "message.started",
        payload: {
          messageId: this.#requireMessageId(),
          role: "agent",
        },
        runId: this.#requireRunId(),
      },
    ];
  }

  #ensureThoughtStarted(): DriverEventInput[] {
    if (this.#thoughtStarted) {
      return [];
    }

    this.#thoughtStarted = true;
    return [
      {
        kind: "thought.started",
        payload: {
          channel: "summary",
          thoughtId: this.#requireThoughtId(),
        },
        runId: this.#requireRunId(),
      },
    ];
  }

  #requireMessageId(): string {
    if (this.#messageId === null) {
      throw new Error("ACP turn message id is not initialized.");
    }

    return this.#messageId;
  }

  #requireRunId(): SessionRunId {
    if (this.#runId === null) {
      throw new Error("ACP turn run id is not initialized.");
    }

    return this.#runId;
  }

  #requireThoughtId(): string {
    if (this.#thoughtId === null) {
      throw new Error("ACP turn thought id is not initialized.");
    }

    return this.#thoughtId;
  }
}
