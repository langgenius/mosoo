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
  readRuntimeAgentTaskSnapshot,
  readRuntimeEventMessageContent,
  readRuntimeEventPermissionRequest,
  readRuntimeEventMessageDelta,
  readRuntimeEventMessageKey,
  readRuntimeEventMessageRole,
  readRuntimeEventPayload,
  readRuntimeRunPayload,
  readRuntimeEventString,
  readRuntimeEventToolCallUpdate,
  readRuntimeEventToolOutputSnapshot,
  toRuntimeRunLifecycleStatus,
} from "./runtime-event-payload";
import { projectRuntimeStatus, projectRuntimeTimingRecorded } from "./session-runtime-timing";

function runtimeEventTimestamp(event: RuntimeEventEnvelope): number {
  return Date.parse(event.occurredAt);
}

function createValidatedSessionCustomEvent(
  name: string,
  value: unknown,
  timestamp?: number,
): AgUiSessionEvent {
  return parseAgUiSessionEvent({
    name,
    ...(timestamp === undefined ? {} : { timestamp }),
    type: EventType.CUSTOM,
    value,
  });
}

function requireRuntimeEventMessageKey(event: RuntimeEventEnvelope): string {
  const messageKey = readRuntimeEventMessageKey(event);

  if (messageKey === null) {
    throw new Error(`Runtime event ${event.kind} projection requires a stream ID.`);
  }

  return messageKey;
}

function projectPermissionRequest(event: RuntimeEventEnvelope): AgUiSessionEvent {
  const request = readRuntimeEventPermissionRequest(event);

  if (request === null) {
    throw new Error("Runtime event permission projection requires a permission request event.");
  }

  const permissionRequest = {
    driverInstanceId: request.driverInstanceId,
    rawInput: request.rawInput,
    requestId: request.requestId,
    runId: request.runId,
    title: request.title,
    toolCallId: request.toolCallId,
    toolKind: request.toolKind,
  };
  return createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name, {
    permissionRequest,
    permissionRequests: [],
  });
}

function projectMessageAdded(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const content = readRuntimeEventMessageContent(event);

  if (content === null) {
    return [];
  }

  return [
    {
      delta: content,
      messageId: requireRuntimeEventMessageKey(event),
      role: readRuntimeEventMessageRole(event) === "user" ? "user" : "assistant",
      timestamp: runtimeEventTimestamp(event),
      type: EventType.TEXT_MESSAGE_CHUNK,
    },
  ];
}

function projectSessionRunUpdated(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const payload = readRuntimeRunPayload(event);
  const run = payload.run;

  if (run === null) {
    return [];
  }

  return [
    createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionRunUpdated.name, {
      driverInstanceId: event.driverInstanceId ?? null,
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

function projectSessionLifecycleUpdated(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
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

function projectAgentTaskUpdated(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
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

function projectPermissionResolved(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const payload = readRuntimeEventPayload(event);
  const requestId = readRuntimeEventString(payload, "requestId");
  if (requestId === null || event.runId === undefined) {
    throw new Error("A permission resolution requires exact request and run identities.");
  }

  return [
    createValidatedSessionCustomEvent(MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name, {
      permissionRequests: [],
      resolvedRequestId: requestId,
      runId: event.runId,
    }),
  ];
}

export function createRuntimeToolResultMessageId(input: {
  runId: string | null;
  toolCallId: string;
}): string {
  return input.runId ?? `tool-result:${JSON.stringify([null, input.toolCallId])}`;
}

export function projectRuntimeEventToAgUiSessionEvents(
  event: RuntimeEventEnvelope,
): AgUiSessionEvent[] {
  if (event.visibility === "owner_debug" || event.visibility === "system_internal") {
    return [];
  }

  switch (event.kind) {
    case "run.started": {
      return projectSessionRunUpdated(event);
    }
    case "run.queued":
    case "run.dispatched":
    case "run.cancel.requested": {
      return projectSessionRunUpdated(event);
    }
    case "run.completed":
    case "run.cancelled": {
      return projectSessionRunUpdated(event);
    }
    case "run.failed": {
      return projectSessionRunUpdated(event);
    }
    case "message.added": {
      return projectMessageAdded(event);
    }
    case "message.started": {
      return [
        {
          messageId: requireRuntimeEventMessageKey(event),
          role: readRuntimeEventMessageRole(event) === "user" ? "user" : "assistant",
          timestamp: runtimeEventTimestamp(event),
          type: EventType.TEXT_MESSAGE_START,
        },
      ];
    }
    case "message.delta": {
      return [
        {
          delta: readRuntimeEventMessageDelta(event),
          messageId: requireRuntimeEventMessageKey(event),
          timestamp: runtimeEventTimestamp(event),
          type: EventType.TEXT_MESSAGE_CONTENT,
        },
      ];
    }
    case "message.cancelled":
    case "message.completed":
    case "message.failed": {
      return [
        {
          messageId: requireRuntimeEventMessageKey(event),
          type: EventType.TEXT_MESSAGE_END,
        },
      ];
    }
    case "thought.started": {
      return [
        {
          messageId: requireRuntimeEventMessageKey(event),
          role: "reasoning",
          type: EventType.REASONING_MESSAGE_START,
        },
      ];
    }
    case "thought.delta": {
      return [
        {
          delta: readRuntimeEventMessageDelta(event),
          messageId: requireRuntimeEventMessageKey(event),
          type: EventType.REASONING_MESSAGE_CONTENT,
        },
      ];
    }
    case "thought.cancelled":
    case "thought.completed": {
      return [
        {
          messageId: requireRuntimeEventMessageKey(event),
          type: EventType.REASONING_MESSAGE_END,
        },
      ];
    }
    case "tool.call.updated": {
      const toolCall = readRuntimeEventToolCallUpdate(event);
      return [
        createValidatedSessionCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionToolUpdated.name,
          {
            inputDelta: toolCall.rawInputDelta,
            inputSnapshot: toolCall.rawInput,
            outputDelta: toolCall.rawOutputDelta,
            outputSnapshot: readRuntimeEventToolOutputSnapshot(toolCall),
            parentMessageId: toolCall.parentMessageId ?? toolCall.messageId,
            resultMessageId: createRuntimeToolResultMessageId({
              runId: event.runId ?? null,
              toolCallId: toolCall.toolCallId,
            }),
            runId: event.runId ?? null,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.title ?? toolCall.kind ?? "Tool",
          },
          runtimeEventTimestamp(event),
        ),
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
      return [projectPermissionRequest(event)];
    }
    case "permission.resolved": {
      return projectPermissionResolved(event);
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
      return projectSessionLifecycleUpdated(event);
    }
    case "agent.task.updated": {
      return projectAgentTaskUpdated(event);
    }
    case "agent.tasks.replaced": {
      return [
        createServerCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionTasksReplaced.name,
          readRuntimeAgentTaskSnapshot(event),
        ),
      ];
    }
    case "runtime.config.updated":
    case "runtime.driver.updated":
    case "runtime.provisioning.updated":
    case "runtime.sandbox.updated":
    case "runtime.transport.updated":
    case "diagnostic.reported": {
      return [projectRuntimeStatus(event)];
    }
    case "runtime.timing.recorded": {
      return projectRuntimeTimingRecorded(event);
    }
    default: {
      return [];
    }
  }
}
