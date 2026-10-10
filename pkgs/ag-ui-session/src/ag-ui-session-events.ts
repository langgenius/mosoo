import { EventType } from "@ag-ui/core";
import type { AGUIEventOf, CustomEvent } from "@ag-ui/core";

import { MOSOO_CUSTOM_EVENT } from "./custom-event-registry";
import type {
  MOSOO_CUSTOM_EVENT as CUSTOM_EVENT_REGISTRY,
  MosooServerEventName,
} from "./custom-event-registry";
import type {
  MosooAgentReadyValue,
  MosooAgentUpdatingValue,
  MosooSessionCommandsUpdatedValue,
  MosooSessionConfigUpdatedValue,
  MosooSessionFilesUpdatedValue,
  MosooSessionInfoUpdatedValue,
  MosooSessionInfraReschedulingValue,
  MosooSessionInfraRunningValue,
  MosooSessionModeUpdatedValue,
  MosooSessionPermissionsUpdatedValue,
  MosooSessionPlanUpdatedValue,
  MosooSessionRunUpdatedValue,
  MosooSessionStoppedValue,
  MosooSessionToolInputUpdatedValue,
  MosooSessionUsageUpdatedValue,
} from "./custom-event-values";

export type * from "./custom-event-values";
export { MOSOO_CUSTOM_EVENT, REPLACEABLE_CUSTOM_EVENT_NAMES } from "./custom-event-registry";
export type {
  MosooCustomEventName,
  MosooServerEventName,
  ReplaceableCustomEventName,
} from "./custom-event-registry";

export type SupportedAgUiStandardEvent =
  | AGUIEventOf<EventType.REASONING_MESSAGE_CONTENT>
  | AGUIEventOf<EventType.REASONING_MESSAGE_END>
  | AGUIEventOf<EventType.REASONING_MESSAGE_START>
  | AGUIEventOf<EventType.STATE_SNAPSHOT>
  | AGUIEventOf<EventType.TEXT_MESSAGE_CHUNK>
  | AGUIEventOf<EventType.TEXT_MESSAGE_CONTENT>
  | AGUIEventOf<EventType.TEXT_MESSAGE_END>
  | AGUIEventOf<EventType.TEXT_MESSAGE_START>
  | AGUIEventOf<EventType.TOOL_CALL_ARGS>
  | AGUIEventOf<EventType.TOOL_CALL_END>
  | AGUIEventOf<EventType.TOOL_CALL_RESULT>
  | AGUIEventOf<EventType.TOOL_CALL_START>;

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
  [CUSTOM_EVENT_REGISTRY.sessionConfigUpdated.name]: MosooSessionConfigUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionFilesUpdated.name]: MosooSessionFilesUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionInfoUpdated.name]: MosooSessionInfoUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionInfraRescheduling.name]: MosooSessionInfraReschedulingValue;
  [CUSTOM_EVENT_REGISTRY.sessionInfraRunning.name]: MosooSessionInfraRunningValue;
  [CUSTOM_EVENT_REGISTRY.sessionModeUpdated.name]: MosooSessionModeUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionPermissionsUpdated.name]: MosooSessionPermissionsUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionPlanUpdated.name]: MosooSessionPlanUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionRunUpdated.name]: MosooSessionRunUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionStopped.name]: MosooSessionStoppedValue;
  [CUSTOM_EVENT_REGISTRY.sessionToolInputUpdated.name]: MosooSessionToolInputUpdatedValue;
  [CUSTOM_EVENT_REGISTRY.sessionUsageUpdated.name]: MosooSessionUsageUpdatedValue;
}

type MosooCustomEventByName<TName extends keyof MosooCustomEventValueByName> = AgUiCustomEvent<
  TName,
  MosooCustomEventValueByName[TName]
>;

export type MosooServerCustomEvent = {
  [TName in MosooServerEventName]: MosooCustomEventByName<TName>;
}[MosooServerEventName];

export type MosooCustomEvent = MosooServerCustomEvent;

export type AgUiSessionEvent = SupportedAgUiStandardEvent | MosooCustomEvent;

const terminalSessionRunStatuses = new Set(["completed", "failed", "cancelled", "expired"]);

export function isAgUiSessionRunTerminalEvent(event: AgUiSessionEvent): boolean {
  return (
    event.type === EventType.CUSTOM &&
    event.name === MOSOO_CUSTOM_EVENT.sessionRunUpdated.name &&
    terminalSessionRunStatuses.has(event.value.run.status)
  );
}
