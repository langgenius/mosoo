import { createMcpExecuteFailedEventIdentity } from "@mosoo/agent-driver/events";
import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
  SessionRuntimeEventFamily,
  SessionRuntimeEventSource,
  SessionRuntimeEventVisibility,
} from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, SessionRunId } from "@mosoo/id";
import {
  createRuntimeToolResultMessageId,
  createProcessDraftFromRuntimeEvent,
  getRuntimeEventSessionFamily,
  getRuntimeEventParticipantVisibility,
  getRuntimeEventSource,
  readRuntimeEventMessageKey,
  readRuntimeEventPayload,
  readRuntimeEventPermissionRequest,
  readRuntimeEventString,
  readRuntimeEventToolCallUpdate,
  readRuntimeEventToolOutputSnapshot,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export interface SessionRuntimeEventProjection {
  contentText: string;
  eventType: string;
  family: SessionRuntimeEventFamily;
  mcpCommandId: DriverCommandId | null;
  processStatus: SessionProcessEventStatus;
  processType: SessionProcessEventType;
  runId: SessionRunId | null;
  source: SessionRuntimeEventSource;
  streamId: string | null;
  toolCallId: string | null;
  toolInputDeltaJson: string | null;
  toolInputJson: string | null;
  toolName: string | null;
  toolOutputDeltaText: string | null;
  toolOutputText: string | null;
  toolParentMessageId: string | null;
  toolResultMessageId: string | null;
  toolStatus: "cancelled" | "completed" | "failed" | "running" | null;
  traceId: string | null;
  tokens: number | null;
  visibility: SessionRuntimeEventVisibility;
}

const knownRuntimeEventSources = new Set<string>(["api", "driver", "file", "system", "viewer"]);

function isKnownRuntimeEventSource(value: unknown): value is SessionRuntimeEventSource {
  return typeof value === "string" && knownRuntimeEventSources.has(value);
}

function readProjectedToolCall(
  event: RuntimeEventEnvelope,
  provenMcpCommandId: DriverCommandId | null,
): {
  mcpCommandId: DriverCommandId | null;
  toolCallId: string | null;
  toolInputDeltaJson: string | null;
  toolInputJson: string | null;
  toolName: string | null;
  toolOutputDeltaText: string | null;
  toolOutputText: string | null;
  toolParentMessageId: string | null;
  toolResultMessageId: string | null;
  toolStatus: "cancelled" | "completed" | "failed" | "running" | null;
} {
  if (event.kind === "tool.call.updated") {
    const toolCall = readRuntimeEventToolCallUpdate(event);
    if (provenMcpCommandId !== null) {
      const commandId = parsePlatformId<DriverCommandId>(
        event.correlationId,
        "MCP command correlation ID",
      );
      const sourceEventId =
        toolCall.status === "failed" &&
        toolCall.kind === "mcp" &&
        toolCall.rawInput !== null &&
        toolCall.rawOutput !== null &&
        toolCall.title !== null
          ? createMcpExecuteFailedEventIdentity({
              commandId,
              rawInput: toolCall.rawInput,
              rawOutput: toolCall.rawOutput,
              title: toolCall.title,
              toolCallId: toolCall.toolCallId,
            }).sourceEventId
          : `mcp.execute.${toolCall.status}:${commandId}`;
      if (
        commandId !== provenMcpCommandId ||
        toolCall.kind !== "mcp" ||
        toolCall.status === "running" ||
        (toolCall.status === "failed" &&
          (toolCall.rawInput === null || toolCall.rawOutput === null || toolCall.title === null)) ||
        event.sourceEventId !== sourceEventId
      ) {
        throw new Error("Proven MCP command does not match its terminal tool event.");
      }
    }

    return {
      mcpCommandId: provenMcpCommandId,
      toolCallId: toolCall.toolCallId,
      toolInputDeltaJson: toolCall.rawInputDelta,
      toolInputJson: toolCall.rawInput,
      toolName: toolCall.title ?? toolCall.kind,
      toolOutputDeltaText: toolCall.rawOutputDelta,
      toolOutputText: readRuntimeEventToolOutputSnapshot(toolCall),
      toolParentMessageId: toolCall.parentMessageId ?? toolCall.messageId,
      toolResultMessageId: createRuntimeToolResultMessageId({
        runId: event.runId ?? null,
        toolCallId: toolCall.toolCallId,
      }),
      toolStatus: toolCall.status,
    };
  }

  const permission = readRuntimeEventPermissionRequest(event);

  return permission === null
    ? {
        toolCallId: null,
        mcpCommandId: null,
        toolInputDeltaJson: null,
        toolInputJson: null,
        toolName: null,
        toolOutputDeltaText: null,
        toolOutputText: null,
        toolParentMessageId: null,
        toolResultMessageId: null,
        toolStatus: null,
      }
    : {
        toolCallId: permission.toolCallId,
        mcpCommandId: null,
        toolInputDeltaJson: null,
        toolInputJson: null,
        toolName: null,
        toolOutputDeltaText: null,
        toolOutputText: null,
        toolParentMessageId: null,
        toolResultMessageId: null,
        toolStatus: null,
      };
}

function readProjectedContentText(
  event: RuntimeEventEnvelope,
  draft: ReturnType<typeof createProcessDraftFromRuntimeEvent>,
): string {
  if (event.kind !== "tool.call.updated") {
    const payload = readRuntimeEventPayload(event);
    if (event.kind === "plan.updated") {
      return JSON.stringify(Array.isArray(payload["entries"]) ? payload["entries"] : []);
    }
    if (event.kind === "session.commands.updated") {
      return JSON.stringify(Array.isArray(payload["commands"]) ? payload["commands"] : []);
    }
    if (event.kind === "session.config.updated") {
      return JSON.stringify({
        configOptions: Array.isArray(payload["options"]) ? payload["options"] : [],
      });
    }
    if (event.kind === "session.mode.updated") {
      return JSON.stringify({
        currentModeId: readRuntimeEventString(payload, "currentMode"),
        visibleModes: Array.isArray(payload["availableModes"]) ? payload["availableModes"] : [],
      });
    }
    if (event.kind === "usage.updated") {
      return JSON.stringify(payload);
    }

    return draft.content;
  }

  const toolCall = readRuntimeEventToolCallUpdate(event);
  return toolCall.rawOutput ?? toolCall.rawOutputDelta ?? toolCall.content ?? "";
}

function readProjectedProcessStatus(
  event: RuntimeEventEnvelope,
  draft: ReturnType<typeof createProcessDraftFromRuntimeEvent>,
): SessionProcessEventStatus {
  if (
    event.kind === "tool.call.updated" &&
    readRuntimeEventToolCallUpdate(event).status === "failed"
  ) {
    return "error";
  }

  return draft.status ?? "available";
}

function readProjectedVisibility(event: RuntimeEventEnvelope): SessionRuntimeEventVisibility {
  // The canonical participant event still drives live AG-UI delivery. Its
  // durable row is a state receipt, not a historical Process timeline entry.
  return event.kind === "agent.tasks.replaced"
    ? "owner_debug"
    : getRuntimeEventParticipantVisibility(event);
}

function readProjectedStreamId(event: RuntimeEventEnvelope): string | null {
  return event.kind === "run.completed"
    ? readRuntimeEventString(readRuntimeEventPayload(event), "finalMessageId")
    : readRuntimeEventMessageKey(event);
}

export function createSessionRuntimeEventProjection(
  event: RuntimeEventEnvelope,
  options?: { provenMcpCommandId: DriverCommandId | null },
): SessionRuntimeEventProjection {
  const draft = createProcessDraftFromRuntimeEvent(event);
  const source = getRuntimeEventSource(event);
  const toolCall = readProjectedToolCall(event, options?.provenMcpCommandId ?? null);

  return {
    contentText: readProjectedContentText(event, draft),
    eventType: event.kind,
    family: getRuntimeEventSessionFamily(event),
    processStatus: readProjectedProcessStatus(event, draft),
    processType: draft.type,
    runId: event.runId ?? null,
    source: isKnownRuntimeEventSource(source) ? source : "system",
    streamId: readProjectedStreamId(event),
    ...toolCall,
    traceId: event.traceId ?? null,
    tokens: draft.tokens ?? null,
    visibility: readProjectedVisibility(event),
  };
}
