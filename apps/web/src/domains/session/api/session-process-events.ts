import type { RuntimeEventId } from "@mosoo/contracts/id";
import type { SessionProcessEvent, SessionProcessEventType } from "@mosoo/contracts/session";
import { SESSION_PROCESS_EVENT_TYPE_BY_CODE } from "@mosoo/contracts/session";

export const SESSION_PROCESS_EVENT_QUERY_LIMIT = 1000;

interface SessionProcessEventPayload {
  content: string;
  durationMs: number | null;
  id: string;
  occurredAt: string;
  status: SessionProcessEvent["status"];
  tokens: number | null;
  type: string;
}

function toRuntimeEventId(id: string): RuntimeEventId {
  return id as RuntimeEventId;
}

const SESSION_PROCESS_EVENT_TYPE_CODE_SET = new Set<string>(
  Object.keys(SESSION_PROCESS_EVENT_TYPE_BY_CODE),
);

function isSessionProcessEventTypeCode(
  code: string,
): code is keyof typeof SESSION_PROCESS_EVENT_TYPE_BY_CODE {
  return SESSION_PROCESS_EVENT_TYPE_CODE_SET.has(code);
}

function mapSessionProcessEventTypeCode(code: string): SessionProcessEventType {
  if (!isSessionProcessEventTypeCode(code)) {
    throw new Error(`Unsupported session process event type code: ${code}`);
  }

  return SESSION_PROCESS_EVENT_TYPE_BY_CODE[code];
}

export function toSessionProcessEvent(event: SessionProcessEventPayload): SessionProcessEvent {
  return {
    content: event.content,
    durationMs: event.durationMs,
    id: toRuntimeEventId(event.id),
    occurredAt: event.occurredAt,
    status: event.status,
    tokens: event.tokens,
    type: mapSessionProcessEventTypeCode(event.type),
  };
}
