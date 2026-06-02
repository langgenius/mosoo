import { NonEmptyString, parseSchemaValue } from "@mosoo/contracts/validation";
import { parseRuntimeEventEnvelope } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope, RuntimeEventInput } from "@mosoo/runtime-events";
import { type } from "arktype";

export type DriverEvent = RuntimeEventEnvelope;
export type DriverEventInput = RuntimeEventInput;

export const DriverEventEnvelope = type({
  event: "unknown",
  eventId: NonEmptyString,
  "occurredAt?": "number | null | undefined",
});
export interface DriverEventEnvelope {
  event: DriverEvent;
  eventId: string;
  occurredAt?: number | null;
}

export function parseDriverEventEnvelope(input: unknown): DriverEventEnvelope {
  const envelope = parseSchemaValue(DriverEventEnvelope, input);

  return {
    event: parseRuntimeEventEnvelope(envelope.event),
    eventId: envelope.eventId,
    ...(envelope.occurredAt === undefined ? {} : { occurredAt: envelope.occurredAt }),
  };
}
