import {
  parseNullableSessionUsageSummary,
  readSessionUsageTokenTotal as readAgUiSessionUsageTokenTotal,
} from "@mosoo/ag-ui-session";
import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
  SessionRuntimeEventFamily,
} from "@mosoo/contracts/session";

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

const sessionFamilyByDomain: Readonly<Record<string, SessionRuntimeEventFamily | undefined>> = {
  account: "diagnostics",
  agent: "tool",
  auth: "diagnostics",
  catalog: "diagnostics",
  context: "input",
  diagnostic: "diagnostics",
  driver: "driver",
  file: "file",
  hook: "diagnostics",
  image: "tool",
  item: "tool",
  mcp: "tool",
  message: "message",
  model: "diagnostics",
  oauth: "diagnostics",
  permission: "permission",
  plan: "diagnostics",
  process: "diagnostics",
  realtime: "diagnostics",
  remote: "transport",
  review: "tool",
  run: "run",
  runtime: "driver",
  search: "tool",
  session: "lifecycle",
  shell: "tool",
  space: "file",
  terminal: "diagnostics",
  thought: "message",
  tool: "tool",
  usage: "usage",
  user: "input",
  web: "tool",
  workspace: "file",
};

const sessionFamilyByKind: Readonly<Record<string, SessionRuntimeEventFamily | undefined>> = {
  "runtime.config.updated": "diagnostics",
  "runtime.provisioning.updated": "provisioning",
  "runtime.sandbox.released": "sandbox",
  "runtime.sandbox.updated": "sandbox",
  "runtime.timing.recorded": "diagnostics",
  "runtime.transport.updated": "transport",
};

export function getRuntimeEventSessionFamily(
  event: RuntimeEventEnvelope,
): SessionRuntimeEventFamily {
  const domain = event.kind.split(".")[0] ?? "diagnostic";
  return sessionFamilyByKind[event.kind] ?? sessionFamilyByDomain[domain] ?? "diagnostics";
}

export function createProcessDraftFromRuntimeEvent(event: RuntimeEventEnvelope): ProcessDraft {
  const payload = readRuntimeEventPayload(event);

  switch (event.kind) {
    case "message.added":
    case "message.delta":
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
        type:
          toolCall.status === "completed" || toolCall.status === "failed"
            ? "tool.use.completed"
            : "tool.use.started",
      };
    }
    case "mcp.tool.updated":
    case "tool.dynamic.updated":
    case "web.search.updated":
    case "image.updated":
    case "agent.task.updated":
    case "review.updated":
    case "shell.command.updated": {
      const status = readRuntimeEventToolStatusFromEvent(event);
      return {
        content:
          readRuntimeEventString(payload, "title") ??
          readRuntimeEventString(payload, "kind") ??
          "Tool updated.",
        type:
          status === "completed" || status === "failed" ? "tool.use.completed" : "tool.use.started",
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
      const usage = parseNullableSessionUsageSummary(event.payload);
      return {
        content: "Usage updated.",
        tokens: readAgUiSessionUsageTokenTotal(usage),
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
