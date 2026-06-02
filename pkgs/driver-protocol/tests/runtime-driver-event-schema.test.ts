import { describe, expect, test } from "bun:test";

import {
  parseDriverCommandUpdateInput,
  parseDriverEventBatchInput,
  parseDriverEventEnvelope,
  parseDriverLogBatchInput,
  parseDriverNextCommandInput,
} from "@mosoo/driver-protocol";
import {
  RUNTIME_EVENT_SCHEMA_VERSION,
  createRuntimeEvent,
  parseRuntimeEventEnvelope,
} from "@mosoo/runtime-events";

const occurredAt = "2026-05-26T00:00:00.000Z";

const DRIVER_PROTOCOL_EVENT_IDS = {
  driverInstanceId: "01J0000000000000000000000F",
  eventId: "01J00000000000000000000016",
  messageId: "01J00000000000000000000017",
  runId: "01J00000000000000000000012",
  sessionId: "01J00000000000000000000008",
} as const;

function createCanonicalRuntimeEvent() {
  return createRuntimeEvent({
    id: DRIVER_PROTOCOL_EVENT_IDS.eventId,
    kind: "message.delta",
    occurredAt,
    payload: {
      contentDelta: "hello",
      messageId: DRIVER_PROTOCOL_EVENT_IDS.messageId,
      role: "agent",
    },
    runId: DRIVER_PROTOCOL_EVENT_IDS.runId,
    sessionId: DRIVER_PROTOCOL_EVENT_IDS.sessionId,
  });
}

function expectRuntimeEventOwnerRejection(event: unknown) {
  expect(() => parseRuntimeEventEnvelope(event)).toThrow();
  expect(() =>
    parseDriverEventEnvelope({
      event,
      eventId: "driver-event-1",
    }),
  ).toThrow();
}

describe("driver runtime event protocol", () => {
  test("normalizes driver instance IDs for non-event ORPC inputs", () => {
    expect(
      parseDriverNextCommandInput({
        driverInstanceId: "01j0000000000000000000000f",
      }).driverInstanceId,
    ).toBe(DRIVER_PROTOCOL_EVENT_IDS.driverInstanceId);
    expect(
      parseDriverCommandUpdateInput({
        commandId: "command-1",
        driverInstanceId: "01j0000000000000000000000f",
        status: "accepted",
      }).driverInstanceId,
    ).toBe(DRIVER_PROTOCOL_EVENT_IDS.driverInstanceId);
    expect(
      parseDriverLogBatchInput({
        driverInstanceId: "01j0000000000000000000000f",
        logs: [],
      }).driverInstanceId,
    ).toBe(DRIVER_PROTOCOL_EVENT_IDS.driverInstanceId);
  });

  test("rejects malformed driver instance IDs for non-event ORPC inputs", () => {
    expect(() =>
      parseDriverNextCommandInput({
        driverInstanceId: "driver-instance-1",
      }),
    ).toThrow();
  });

  test("normalizes driver event envelopes with the canonical runtime parser", () => {
    const event = createCanonicalRuntimeEvent();

    expect(
      parseDriverEventEnvelope({
        event,
        eventId: "driver-event-1",
        occurredAt: 1_717_000_000_000,
      }),
    ).toEqual({
      event,
      eventId: "driver-event-1",
      occurredAt: 1_717_000_000_000,
    });
  });

  test("rejects unsupported runtime event kinds at the driver protocol boundary", () => {
    expect(() =>
      parseDriverEventBatchInput({
        driverInstanceId: DRIVER_PROTOCOL_EVENT_IDS.driverInstanceId,
        events: [
          {
            event: {
              ...createCanonicalRuntimeEvent(),
              kind: "message.unknown",
            },
            eventId: "driver-event-1",
          },
        ],
      }),
    ).toThrow();
  });

  test("rejects owner-invalid envelope fields at the driver boundary", () => {
    const event = createCanonicalRuntimeEvent();

    const cases: readonly unknown[] = [
      {
        ...event,
        actor: "viewer",
      },
      {
        ...event,
        delivery: "eventual",
      },
      {
        ...event,
        origin: "browser",
      },
      {
        ...event,
        visibility: "everyone",
      },
      {
        ...event,
        context: {
          surface: {
            type: "desktop",
          },
        },
      },
      {
        ...event,
        native: {
          sequence: 1,
        },
      },
      {
        ...event,
        traceId: "",
      },
      {
        ...event,
        seq: "1",
      },
    ];

    for (const sample of cases) {
      expectRuntimeEventOwnerRejection(sample);
    }
  });

  test("rejects legacy AG-UI custom event shapes at the driver protocol boundary", () => {
    expect(() =>
      parseDriverEventBatchInput({
        driverInstanceId: DRIVER_PROTOCOL_EVENT_IDS.driverInstanceId,
        events: [
          {
            event: {
              name: "mosoo.session.sync.request",
              type: "CUSTOM",
              value: {
                reason: "manual",
              },
            },
            eventId: "driver-event-1",
          },
        ],
      }),
    ).toThrow();
  });

  test("rejects stale runtime event schema versions before API ingestion", () => {
    expect(() =>
      parseDriverEventBatchInput({
        driverInstanceId: DRIVER_PROTOCOL_EVENT_IDS.driverInstanceId,
        events: [
          {
            event: {
              ...createCanonicalRuntimeEvent(),
              schemaVersion: "2026-05-25",
            },
            eventId: "driver-event-1",
          },
        ],
      }),
    ).toThrow();

    expect(
      parseDriverEventBatchInput({
        driverInstanceId: DRIVER_PROTOCOL_EVENT_IDS.driverInstanceId,
        events: [
          {
            event: createCanonicalRuntimeEvent(),
            eventId: "driver-event-1",
          },
        ],
      }).events[0]?.event.schemaVersion,
    ).toBe(RUNTIME_EVENT_SCHEMA_VERSION);
  });
});
