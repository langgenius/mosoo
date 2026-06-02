import { EventType } from "@ag-ui/core";
import type { Message, MessagesSnapshotEvent, StateSnapshotEvent } from "@ag-ui/core";

import type {
  MosooCustomEventValueByName,
  MosooServerCustomEvent,
  MosooViewerCustomEvent,
} from "./ag-ui-session-events";
import { MOSOO_CUSTOM_EVENT } from "./custom-event-registry";
import type { MosooSessionRuntimeTimingValue } from "./custom-event-values";
import type { SessionLiveState } from "./live-state";
import type { SessionViewMessage } from "./live-state";

export function toAgUiMessage(message: SessionViewMessage): Message {
  return {
    content: message.content,
    id: message.id,
    role: message.role,
  };
}

export function toAgUiMessages(messages: SessionViewMessage[]): Message[] {
  return messages.map((message) => toAgUiMessage(message));
}

export function createMessagesSnapshotEvent(messages: Message[]): MessagesSnapshotEvent {
  return {
    messages,
    type: EventType.MESSAGES_SNAPSHOT,
  };
}

export function createStateSnapshotEvent(snapshot: SessionLiveState): StateSnapshotEvent {
  return {
    snapshot,
    type: EventType.STATE_SNAPSHOT,
  };
}

export function createServerCustomEvent<TName extends MosooServerCustomEvent["name"]>(
  name: TName,
  value: MosooCustomEventValueByName[TName],
): Extract<MosooServerCustomEvent, { name: TName }> {
  return {
    name,
    type: EventType.CUSTOM,
    value,
  } as Extract<MosooServerCustomEvent, { name: TName }>;
}

export function createViewerCustomEvent<TName extends MosooViewerCustomEvent["name"]>(
  name: TName,
  value: MosooCustomEventValueByName[TName],
): Extract<MosooViewerCustomEvent, { name: TName }> {
  return {
    name,
    type: EventType.CUSTOM,
    value,
  } as Extract<MosooViewerCustomEvent, { name: TName }>;
}

export function createSessionRuntimeTimelineEvent(timing: MosooSessionRuntimeTimingValue) {
  return createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionRuntimeTimelineUpdated.name, {
    completedAtMs: timing.completedAtMs,
    durationMs: timing.totalMs,
    path: timing.path,
    runId: timing.runId,
    sessionId: timing.sessionId,
    source: timing.source,
    stage: timing.stage,
    startedAtMs: timing.startedAtMs,
    traceId: timing.traceId,
  });
}
