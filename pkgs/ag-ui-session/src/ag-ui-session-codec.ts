import { EventSchemas, EventType } from "@ag-ui/core";
import type { AGUIEvent } from "@ag-ui/core";
import { parseSchemaValue } from "@mosoo/contracts/validation";

import { MOSOO_CUSTOM_EVENT, SUPPORTED_AG_UI_STANDARD_EVENT_TYPES } from "./ag-ui-session-events";
import type {
  AgUiSessionEvent,
  MosooCustomEvent,
  MosooViewerCustomEvent,
  SupportedAgUiStandardEvent,
} from "./ag-ui-session-events";
import { MosooCustomEventSchema } from "./custom-event-schema";
import { JsonPatchOperationSchema, SessionLiveStateSchema } from "./session-live-state-schema";

const strictMosooCustomEventSchema = MosooCustomEventSchema.onDeepUndeclaredKey("delete");
const strictJsonPatchOperationSchema = JsonPatchOperationSchema.onDeepUndeclaredKey("delete");
const strictSessionLiveStateSchema = SessionLiveStateSchema.onDeepUndeclaredKey("delete");
const supportedStandardEventTypes = new Set<string>(SUPPORTED_AG_UI_STANDARD_EVENT_TYPES);

function parseAgUiEvent(value: unknown): AGUIEvent {
  return EventSchemas.parse(value);
}

function parseSupportedStandardEvent(event: AGUIEvent): SupportedAgUiStandardEvent {
  if (event.type === EventType.CUSTOM || !supportedStandardEventTypes.has(event.type)) {
    throw new Error(`Unsupported AG-UI session event type: ${event.type}.`);
  }

  return event as SupportedAgUiStandardEvent;
}

function parseMosooCustomEvent(event: AGUIEvent): MosooCustomEvent {
  if (event.type !== EventType.CUSTOM) {
    throw new Error("Expected an AG-UI custom event.");
  }

  const parsed = parseSchemaValue(strictMosooCustomEventSchema, event);
  return {
    ...parsed,
    ...(event.rawEvent === undefined ? {} : { rawEvent: event.rawEvent }),
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    type: EventType.CUSTOM,
  } as MosooCustomEvent;
}

export function parseViewerCustomEvent(value: unknown): MosooViewerCustomEvent {
  const event = parseAgUiSessionEvent(value);

  if (
    event.type === EventType.CUSTOM &&
    event.name === MOSOO_CUSTOM_EVENT.sessionSyncRequest.name
  ) {
    return event;
  }

  throw new Error("Unsupported viewer AG-UI custom event.");
}

export function parseViewerCustomEventJson(raw: string): MosooViewerCustomEvent {
  return parseViewerCustomEvent(JSON.parse(raw));
}

export function parseAgUiSessionEvent(value: unknown): AgUiSessionEvent {
  const event = parseAgUiEvent(value);

  if (event.type === EventType.STATE_SNAPSHOT) {
    return {
      ...event,
      snapshot: parseSchemaValue(strictSessionLiveStateSchema, event.snapshot),
    };
  }

  if (event.type === EventType.STATE_DELTA) {
    return {
      ...event,
      delta: event.delta.map((operation) =>
        parseSchemaValue(strictJsonPatchOperationSchema, operation),
      ),
    };
  }

  if (event.type === EventType.CUSTOM) {
    return parseMosooCustomEvent(event);
  }

  return parseSupportedStandardEvent(event);
}

export function parseAgUiSessionEventJson(raw: string): AgUiSessionEvent {
  return parseAgUiSessionEvent(JSON.parse(raw));
}

export function serializeAgUiSessionEvent(event: AgUiSessionEvent): string {
  return JSON.stringify(event);
}

export function serializeAgUiSessionEvents(events: AgUiSessionEvent[]): string[] {
  return events.map((event) => serializeAgUiSessionEvent(event));
}

export function parseAgUiEventJson(raw: string): AgUiSessionEvent {
  return parseAgUiSessionEventJson(raw);
}
