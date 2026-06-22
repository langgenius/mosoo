import {
  EventType,
  MOSOO_CUSTOM_EVENT,
  createServerCustomEvent,
  parseAgUiSessionEvent,
  parseNullableSessionUsageSummary,
} from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import type { RuntimeEventEnvelope } from "./runtime-event";
import {
  readRuntimeEventPermissionRequest,
  readRuntimeEventMessageDelta,
  readRuntimeEventMessageKey,
  readRuntimeEventMessageRole,
  readRuntimeEventPayload,
  readRuntimeRunPayload,
  readRuntimeEventString,
  readRuntimeEventToolCallUpdate,
  toRuntimeRunLifecycleStatus,
} from "./runtime-event-payload";
import { appRuntimeStatus, appRuntimeTimingRecorded } from "./session-runtime-timing";

function createValidatedSessionCustomEvent(name: string, value: unknown): AgUiSessionEvent {
  return parseAgUiSessionEvent({
    name,
    type: EventType.CUSTOM,
    value,
  });
}

function appPermissionRequest(event: RuntimeEventEnvelope): AgUiSessionEvent {
  const request = readRuntimeEventPermissionRequest(event);

  if (request === null) {
    throw new Error("Runtime event permission projection requires a permission request event.");
  }

  return createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name, {
    permissionRequests: [
      {
        driverInstanceId: request.driverInstanceId,
        rawInput: request.rawInput,
        requestId: request.requestId,
        runId: request.runId,
        title: request.title,
        toolCallId: request.toolCallId,
        toolKind: request.toolKind,
      },
    ],
  });
}

function appMessageAdded(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const payload = readRuntimeEventPayload(event);
  const content = readRuntimeEventString(payload, "content");

  if (content === null) {
    return [];
  }

  return [
    {
      delta: content,
      messageId: readRuntimeEventString(payload, "messageId") ?? event.id,
      role: readRuntimeEventMessageRole(event) === "user" ? "user" : "assistant",
      type: EventType.TEXT_MESSAGE_CHUNK,
    },
  ];
}

function appSessionRunUpdated(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const payload = readRuntimeRunPayload(event);
  const run = payload.run;

  if (run === null) {
    return [];
  }

  return [
    createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionRunUpdated.name, {
      lifecycle: payload.lifecycle ?? toRuntimeRunLifecycleStatus(run.status),
      run,
    }),
  ];
}

type RuntimeStateOperationName = "recreateSandbox" | "resetAgentState" | "restartDriver";

function toRuntimeStateOperationName(value: string | null): RuntimeStateOperationName | null {
  switch (value) {
    case "recreateSandbox":
    case "resetAgentState":
    case "restartDriver": {
      return value;
    }
    default: {
      return null;
    }
  }
}

function appSessionLifecycleUpdated(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const payload = readRuntimeEventPayload(event);

  if (readRuntimeEventString(payload, "status") !== "TERMINATED") {
    return [];
  }

  return [
    createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionStopped.name, {
      lastSeen: readRuntimeEventString(payload, "lastSeen") ?? event.occurredAt,
      message: readRuntimeEventString(payload, "message") ?? "Session stopped.",
      reason: readRuntimeEventString(payload, "reason") ?? "session.stopped",
    }),
  ];
}

function appAgentTaskUpdated(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const payload = readRuntimeEventPayload(event);
  const operation = toRuntimeStateOperationName(readRuntimeEventString(payload, "operation"));
  const status = readRuntimeEventString(payload, "status");
  const agentId = readRuntimeEventString(payload, "agentId");

  if (operation === null || agentId === null) {
    return [];
  }

  if (status === "updating") {
    return [
      createServerCustomEvent(MOSOO_CUSTOM_EVENT.agentUpdating.name, {
        agentId,
        operation,
        startedAt: readRuntimeEventString(payload, "startedAt") ?? event.occurredAt,
      }),
    ];
  }

  if (status === "ready") {
    return [
      createServerCustomEvent(MOSOO_CUSTOM_EVENT.agentReady.name, {
        agentId,
        operation,
        readyAt: readRuntimeEventString(payload, "readyAt") ?? event.occurredAt,
      }),
    ];
  }

  return [];
}

function appPermissionResolved(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const payload = readRuntimeEventPayload(event);
  const permissionRequests = payload["permissionRequests"];

  return [
    createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name, {
      permissionRequests: Array.isArray(permissionRequests) ? permissionRequests : [],
    }),
  ];
}

export function appRuntimeEventToAgUiSessionEvents(
  event: RuntimeEventEnvelope,
): AgUiSessionEvent[] {
  if (event.visibility === "owner_debug" || event.visibility === "system_internal") {
    return [];
  }

  switch (event.kind) {
    case "run.started": {
      return appSessionRunUpdated(event);
    }
    case "run.queued":
    case "run.dispatched":
    case "run.cancel.requested": {
      return appSessionRunUpdated(event);
    }
    case "run.completed":
    case "run.cancelled": {
      return appSessionRunUpdated(event);
    }
    case "run.failed": {
      return appSessionRunUpdated(event);
    }
    case "message.added": {
      return appMessageAdded(event);
    }
    case "message.started": {
      return [
        {
          messageId: readRuntimeEventMessageKey(event) ?? event.id,
          role: readRuntimeEventMessageRole(event) === "user" ? "user" : "assistant",
          type: EventType.TEXT_MESSAGE_START,
        },
      ];
    }
    case "message.delta": {
      return [
        {
          delta: readRuntimeEventMessageDelta(event),
          messageId: readRuntimeEventMessageKey(event) ?? event.id,
          type: EventType.TEXT_MESSAGE_CONTENT,
        },
      ];
    }
    case "message.completed": {
      return [
        {
          messageId: readRuntimeEventMessageKey(event) ?? event.id,
          type: EventType.TEXT_MESSAGE_END,
        },
      ];
    }
    case "thought.started": {
      return [
        {
          messageId: readRuntimeEventMessageKey(event) ?? event.id,
          role: "reasoning",
          type: EventType.REASONING_MESSAGE_START,
        },
      ];
    }
    case "thought.delta": {
      return [
        {
          delta: readRuntimeEventMessageDelta(event),
          messageId: readRuntimeEventMessageKey(event) ?? event.id,
          type: EventType.REASONING_MESSAGE_CONTENT,
        },
      ];
    }
    case "thought.completed": {
      return [
        {
          messageId: readRuntimeEventMessageKey(event) ?? event.id,
          type: EventType.REASONING_MESSAGE_END,
        },
      ];
    }
    case "tool.call.updated": {
      const toolCall = readRuntimeEventToolCallUpdate(event);

      if (toolCall.status === "completed" || toolCall.status === "failed") {
        const rawOutput = toolCall.rawOutput ?? toolCall.content;
        const result =
          rawOutput ??
          (toolCall.status === "failed"
            ? `${toolCall.title ?? toolCall.kind ?? "Tool"} failed.`
            : null);

        return result === null
          ? [{ toolCallId: toolCall.toolCallId, type: EventType.TOOL_CALL_END }]
          : [
              {
                content: result,
                messageId: toolCall.messageId ?? event.id,
                toolCallId: toolCall.toolCallId,
                type: EventType.TOOL_CALL_RESULT,
              },
              { toolCallId: toolCall.toolCallId, type: EventType.TOOL_CALL_END },
            ];
      }

      return [
        {
          parentMessageId: toolCall.parentMessageId ?? event.id,
          toolCallId: toolCall.toolCallId,
          toolCallName: toolCall.title ?? toolCall.kind ?? "Tool",
          type: EventType.TOOL_CALL_START,
        },
      ];
    }
    case "plan.updated": {
      const payload = readRuntimeEventPayload(event);
      return [
        createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionPlanUpdated.name, {
          plan: Array.isArray(payload["entries"]) ? payload["entries"] : [],
        }),
      ];
    }
    case "usage.updated": {
      const usage = parseNullableSessionUsageSummary(event.payload);
      return [
        createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionUsageUpdated.name, {
          usage,
        }),
      ];
    }
    case "permission.requested": {
      return [appPermissionRequest(event)];
    }
    case "permission.resolved": {
      return appPermissionResolved(event);
    }
    case "session.files.updated": {
      return [
        createValidatedSessionCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionFilesUpdated.name,
          event.payload,
        ),
      ];
    }
    case "session.info.updated": {
      return [
        createValidatedSessionCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionInfoUpdated.name,
          event.payload,
        ),
      ];
    }
    case "session.config.updated": {
      const payload = readRuntimeEventPayload(event);
      return [
        createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionConfigUpdated.name, {
          configOptions: Array.isArray(payload["options"]) ? payload["options"] : [],
        }),
      ];
    }
    case "session.mode.updated": {
      const payload = readRuntimeEventPayload(event);
      return [
        createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionModeUpdated.name, {
          currentModeId: readRuntimeEventString(payload, "currentMode"),
          visibleModes: Array.isArray(payload["availableModes"]) ? payload["availableModes"] : [],
        }),
      ];
    }
    case "session.commands.updated": {
      const payload = readRuntimeEventPayload(event);
      return [
        createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionCommandsUpdated.name, {
          commands: Array.isArray(payload["commands"]) ? payload["commands"] : [],
        }),
      ];
    }
    case "session.readiness.updated": {
      return [
        createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionReadiness.name, {
          readiness: event.payload,
        }),
      ];
    }
    case "session.lifecycle.updated": {
      return appSessionLifecycleUpdated(event);
    }
    case "agent.task.updated": {
      return appAgentTaskUpdated(event);
    }
    case "runtime.config.updated":
    case "runtime.driver.updated":
    case "runtime.provisioning.updated":
    case "runtime.sandbox.updated":
    case "runtime.transport.updated":
    case "diagnostic.reported": {
      return [appRuntimeStatus(event)];
    }
    case "runtime.timing.recorded": {
      return appRuntimeTimingRecorded(event);
    }
    default: {
      return [];
    }
  }
}
