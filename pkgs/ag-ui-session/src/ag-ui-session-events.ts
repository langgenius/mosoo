import { EventType } from "@ag-ui/core";
import type { AGUIEventOf, CustomEvent } from "@ag-ui/core";

import { MOSOO_CUSTOM_EVENT } from "./custom-event-registry";
import type {
  MOSOO_CUSTOM_EVENT as CUSTOM_EVENT_REGISTRY,
  MosooServerEventName,
  MosooViewerEventName,
} from "./custom-event-registry";
import type {
  MosooAgentReadyValue,
  MosooAgentUpdatingValue,
  MosooSessionCommandsUpdatedValue,
  MosooSessionConfigTraceValue,
  MosooSessionConfigUpdatedValue,
  MosooSessionFilesUpdatedValue,
  MosooSessionInfoUpdatedValue,
  MosooSessionInfraReschedulingValue,
  MosooSessionInfraRunningValue,
  MosooSessionModeUpdatedValue,
  MosooSessionPermissionsUpdatedValue,
  MosooSessionPlanUpdatedValue,
  MosooSessionReadinessValue,
  MosooSessionRuntimeTimingValue,
  MosooSessionRuntimeTimelineValue,
  MosooSessionRunUpdatedValue,
  MosooSessionStoppedValue,
  MosooSessionSyncRequestValue,
  MosooSessionUsageUpdatedValue,
  MosooSpaceLockEventValue,
  MosooSpaceWriteStaleEventValue,
} from "./custom-event-values";

export type * from "./custom-event-values";
export {
  MOSOO_CUSTOM_EVENT,
  OWNER_DEBUG_CUSTOM_EVENT_NAMES,
  REPLACEABLE_CUSTOM_EVENT_NAMES,
  getMosooCustomEventVisibility,
} from "./custom-event-registry";
export type {
  MosooCustomEventName,
  MosooServerEventName,
  MosooViewerEventName,
  OwnerDebugCustomEventName,
  ReplaceableCustomEventName,
} from "./custom-event-registry";

export const AG_UI_SESSION_EVENT_PAYLOAD_FIELDS = {
  ACTIVITY_DELTA: ["messageId", "activityType", "patch"],
  ACTIVITY_SNAPSHOT: ["messageId", "activityType", "content", "replace"],
  CUSTOM: ["name", "value"],
  MESSAGES_SNAPSHOT: ["messages"],
  RAW: ["event", "source"],
  REASONING_ENCRYPTED_VALUE: ["subtype", "entityId", "encryptedValue"],
  REASONING_END: ["messageId"],
  REASONING_MESSAGE_CHUNK: ["messageId", "delta"],
  REASONING_MESSAGE_CONTENT: ["messageId", "delta"],
  REASONING_MESSAGE_END: ["messageId"],
  REASONING_MESSAGE_START: ["messageId", "role"],
  REASONING_START: ["messageId"],
  RUN_ERROR: ["message", "code"],
  RUN_FINISHED: ["threadId", "runId", "result"],
  RUN_STARTED: ["threadId", "runId", "input", "parentRunId"],
  STATE_DELTA: ["delta"],
  STATE_SNAPSHOT: ["snapshot"],
  STEP_FINISHED: ["stepName"],
  STEP_STARTED: ["stepName"],
  TEXT_MESSAGE_CHUNK: ["messageId", "role", "delta", "name"],
  TEXT_MESSAGE_CONTENT: ["messageId", "delta"],
  TEXT_MESSAGE_END: ["messageId"],
  TEXT_MESSAGE_START: ["messageId", "role", "name"],
  THINKING_END: [],
  THINKING_START: ["title"],
  THINKING_TEXT_MESSAGE_CONTENT: ["delta"],
  THINKING_TEXT_MESSAGE_END: [],
  THINKING_TEXT_MESSAGE_START: [],
  TOOL_CALL_ARGS: ["toolCallId", "delta"],
  TOOL_CALL_CHUNK: ["toolCallId", "toolCallName", "parentMessageId", "delta"],
  TOOL_CALL_END: ["toolCallId"],
  TOOL_CALL_RESULT: ["messageId", "toolCallId", "content", "role"],
  TOOL_CALL_START: ["toolCallId", "toolCallName", "parentMessageId"],
} as const satisfies Record<EventType, readonly string[]>;

export const SUPPORTED_AG_UI_STANDARD_EVENT_TYPES = Object.values(EventType).filter(
  (eventType) => eventType !== EventType.CUSTOM,
);

export type SupportedAgUiStandardEvent =
  | AGUIEventOf<EventType.ACTIVITY_DELTA>
  | AGUIEventOf<EventType.ACTIVITY_SNAPSHOT>
  | AGUIEventOf<EventType.MESSAGES_SNAPSHOT>
  | AGUIEventOf<EventType.RAW>
  | AGUIEventOf<EventType.REASONING_ENCRYPTED_VALUE>
  | AGUIEventOf<EventType.REASONING_END>
  | AGUIEventOf<EventType.REASONING_MESSAGE_CHUNK>
  | AGUIEventOf<EventType.REASONING_MESSAGE_CONTENT>
  | AGUIEventOf<EventType.REASONING_MESSAGE_END>
  | AGUIEventOf<EventType.REASONING_MESSAGE_START>
  | AGUIEventOf<EventType.REASONING_START>
  | AGUIEventOf<EventType.RUN_ERROR>
  | AGUIEventOf<EventType.RUN_FINISHED>
  | AGUIEventOf<EventType.RUN_STARTED>
  | AGUIEventOf<EventType.STATE_DELTA>
  | AGUIEventOf<EventType.STATE_SNAPSHOT>
  | AGUIEventOf<EventType.STEP_FINISHED>
  | AGUIEventOf<EventType.STEP_STARTED>
  | AGUIEventOf<EventType.TEXT_MESSAGE_CHUNK>
  | AGUIEventOf<EventType.TEXT_MESSAGE_CONTENT>
  | AGUIEventOf<EventType.TEXT_MESSAGE_END>
  | AGUIEventOf<EventType.TEXT_MESSAGE_START>
  | AGUIEventOf<EventType.TOOL_CALL_ARGS>
  | AGUIEventOf<EventType.TOOL_CALL_CHUNK>
  | AGUIEventOf<EventType.TOOL_CALL_END>
  | AGUIEventOf<EventType.TOOL_CALL_RESULT>
  | AGUIEventOf<EventType.TOOL_CALL_START>
  | AGUIEventOf<EventType.THINKING_END>
  | AGUIEventOf<EventType.THINKING_START>
  | AGUIEventOf<EventType.THINKING_TEXT_MESSAGE_CONTENT>
  | AGUIEventOf<EventType.THINKING_TEXT_MESSAGE_END>
  | AGUIEventOf<EventType.THINKING_TEXT_MESSAGE_START>;

type AgUiCustomEvent<TName extends string, TValue> = Omit<
  CustomEvent,
  "name" | "type" | "value"
> & {
  name: TName;
  type: EventType.CUSTOM;
  value: TValue;
};

export interface MosooCustomEventValueByName {
  [CUSTOM_EVENT_REGISTRY.agentReady.name]: MosooAgentReadyValue;
  [CUSTOM_EVENT_REGISTRY.agentUpdating.name]: MosooAgentUpdatingValue;
  [CUSTOM_EVENT_REGISTRY.sessionCommandsUpdated.name]: MosooSessionCommandsUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionConfigTrace.name]: MosooSessionConfigTraceValue;
  [CUSTOM_EVENT_REGISTRY.sessionConfigUpdated.name]: MosooSessionConfigUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionFilesUpdated.name]: MosooSessionFilesUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionInfoUpdated.name]: MosooSessionInfoUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionInfraRescheduling.name]: MosooSessionInfraReschedulingValue;
  [CUSTOM_EVENT_REGISTRY.sessionInfraRunning.name]: MosooSessionInfraRunningValue;
  [CUSTOM_EVENT_REGISTRY.sessionModeUpdated.name]: MosooSessionModeUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionPermissionsUpdated.name]: MosooSessionPermissionsUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionPlanUpdated.name]: MosooSessionPlanUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionReadiness.name]: MosooSessionReadinessValue;
  [CUSTOM_EVENT_REGISTRY.sessionRuntimeTiming.name]: MosooSessionRuntimeTimingValue;
  [CUSTOM_EVENT_REGISTRY.sessionRuntimeTimelineUpdated.name]: MosooSessionRuntimeTimelineValue;
  [CUSTOM_EVENT_REGISTRY.sessionRunUpdated.name]: MosooSessionRunUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionStopped.name]: MosooSessionStoppedValue;
  [CUSTOM_EVENT_REGISTRY.sessionSyncRequest.name]: MosooSessionSyncRequestValue;
  [CUSTOM_EVENT_REGISTRY.sessionUsageUpdated.name]: MosooSessionUsageUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.spaceLockAcquired.name]: MosooSpaceLockEventValue;
  [CUSTOM_EVENT_REGISTRY.spaceLockReleased.name]: MosooSpaceLockEventValue;
  [CUSTOM_EVENT_REGISTRY.spaceWriteStale.name]: MosooSpaceWriteStaleEventValue;
}

type MosooCustomEventByName<TName extends keyof MosooCustomEventValueByName> = AgUiCustomEvent<
  TName,
  MosooCustomEventValueByName[TName]
>;

export type MosooViewerCustomEvent = {
  [TName in MosooViewerEventName]: MosooCustomEventByName<TName>;
}[MosooViewerEventName];

export type MosooServerCustomEvent = {
  [TName in MosooServerEventName]: MosooCustomEventByName<TName>;
}[MosooServerEventName];

export type MosooCustomEvent = MosooViewerCustomEvent | MosooServerCustomEvent;

export type AgUiSessionEvent = SupportedAgUiStandardEvent | MosooCustomEvent;
export type AgUiEvent = AgUiSessionEvent;

export type SessionAgUiEventSource = "api" | "driver" | "file" | "system" | "viewer";

export interface AgUiSessionEventReceipt {
  eventId?: string;
  seq: number;
  type: string;
}

const terminalSessionRunStatuses = new Set(["completed", "failed", "cancelled", "expired"]);

function isTerminalSessionRunStatus(value: unknown): boolean {
  return typeof value === "string" && terminalSessionRunStatuses.has(value);
}

export function isAgUiSessionRunTerminalEvent(event: AgUiSessionEvent): boolean {
  if (event.type === EventType.RUN_ERROR || event.type === EventType.RUN_FINISHED) {
    return true;
  }

  return (
    event.type === EventType.CUSTOM &&
    event.name === MOSOO_CUSTOM_EVENT.sessionRunUpdated.name &&
    isTerminalSessionRunStatus(event.value.run.status)
  );
}
