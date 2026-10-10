import { readSessionUsageTokenTotal } from "@mosoo/ag-ui-session";
import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import type { SessionProcessEventStatus, SessionProcessEventType } from "@mosoo/contracts/session";

import type { RuntimeEventEnvelope } from "./runtime-event";
import {
  readRuntimeEventFileChangePath,
  readRuntimeEventMessageDelta,
  readRuntimeEventMessageRole,
  readRuntimeEventPayload,
  readRuntimeEventPermissionRequest,
  readRuntimeRunPayload,
  readRuntimeEventString,
  readRuntimeTimingPayload,
  readRuntimeEventToolCallUpdate,
  readRuntimeEventToolStatusFromEvent,
} from "./runtime-event-payload";

export type ProcessDraftType = SessionProcessEventType;

export interface ProcessDraft {
  content: string;
  status?: SessionProcessEventStatus;
  tokens?: number | null;
  type: ProcessDraftType;
}

export function createProcessDraftFromRuntimeEvent(event: RuntimeEventEnvelope): ProcessDraft {
  const payload = readRuntimeEventPayload(event);

  switch (event.kind) {
    case "message.added":
    case "message.delta":
    case "message.cancelled":
    case "message.failed":
    case "message.completed":
    case "message.started": {
      const content = readRuntimeEventMessageDelta(event) || "Message updated.";
      return {
        content,
        type:
          readRuntimeEventMessageRole(event) === "user" ? "user.message" : "agent.message.delta",
      };
    }
    case "thought.delta":
    case "thought.cancelled":
    case "thought.completed":
    case "thought.started":
    case "plan.updated": {
      return {
        content: readRuntimeEventMessageDelta(event) || "Agent thinking updated.",
        type: "agent.thinking.delta",
      };
    }
    case "run.started": {
      const run = readRuntimeRunPayload(event).run;
      return { content: run?.id ?? "Run started.", type: "run.started" };
    }
    case "run.completed":
    case "run.cancelled": {
      const run = readRuntimeRunPayload(event).run;
      return { content: run?.id ?? "Run completed.", type: "run.completed" };
    }
    case "run.failed": {
      const run = readRuntimeRunPayload(event).run;
      return {
        content: run?.error?.message ?? "Run failed.",
        status: "error",
        type: "run.failed",
      };
    }
    case "permission.requested": {
      const request = readRuntimeEventPermissionRequest(event);

      if (request === null) {
        throw new Error("Runtime event process draft requires a permission request event.");
      }

      return {
        content: request.title,
        type: "tool.confirmation.required",
      };
    }
    case "tool.call.updated": {
      const toolCall = readRuntimeEventToolCallUpdate(event);
      return {
        content: toolCall.title ?? toolCall.kind ?? "Tool updated.",
        type: toolCall.status !== "running" ? "tool.use.completed" : "tool.use.started",
      };
    }
    case "agent.task.updated": {
      const status = readRuntimeEventToolStatusFromEvent(event);
      return {
        content:
          readRuntimeEventString(payload, "title") ??
          readRuntimeEventString(payload, "kind") ??
          "Tool updated.",
        type: status !== "running" ? "tool.use.completed" : "tool.use.started",
      };
    }
    case "file.changed":
    case "file.change.updated": {
      return {
        content: readRuntimeEventFileChangePath(payload) ?? "Workspace file changed.",
        type: "file.changed",
      };
    }
    case "session.files.updated": {
      return { content: "Session files updated.", type: "session_files.updated" };
    }
    case "usage.updated": {
      return {
        content: "Usage updated.",
        tokens: readSessionUsageTokenTotal(event.payload as SessionUsageSummary | null),
        type: "usage.updated",
      };
    }
    case "runtime.timing.recorded": {
      const timing = readRuntimeTimingPayload(event);
      return {
        content: `Runtime timing ${timing.stage}: ${timing.totalMs} ms.`,
        type: "session.status",
      };
    }
    default: {
      return {
        content: event.kind,
        type: "session.status",
      };
    }
  }
}
