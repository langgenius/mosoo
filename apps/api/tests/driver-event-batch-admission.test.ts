import { describe, expect, test } from "bun:test";

import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";
import type { RuntimeEventKind } from "@mosoo/runtime-events";

import { assertDriverEventBatchTerminalOrder } from "../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller";

const SESSION_ID = "01J00000000000000000000001" as SessionId;
const RUN_ID = "01J00000000000000000000002" as SessionRunId;

function driverEvent(kind: RuntimeEventKind, sourceEventId: string): DriverEventEnvelope {
  const event = createRuntimeEvent({
    id: createPlatformId<RuntimeEventId>(),
    kind,
    occurredAt: "2026-08-29T00:00:00.000Z",
    payload:
      kind === "run.failed"
        ? {
            error: { code: "driver.failed", message: "Driver failed.", retryable: false },
            recoverable: false,
          }
        : kind === "message.completed"
          ? { messageId: "message-1", role: "agent" }
          : {},
    runId: RUN_ID,
    sessionId: SESSION_ID,
    sourceEventId,
  });

  return { event, eventId: sourceEventId, occurredAt: event.occurredAt };
}

describe("Driver event batch terminal admission", () => {
  test("accepts one terminal event only when it is last", () => {
    expect(() =>
      assertDriverEventBatchTerminalOrder([
        driverEvent("message.completed", "message-completed"),
        driverEvent("run.completed", "run-completed"),
      ]),
    ).not.toThrow();
  });

  test("rejects multiple terminal events before persistence", () => {
    expect(() =>
      assertDriverEventBatchTerminalOrder([
        driverEvent("run.completed", "run-completed"),
        driverEvent("run.failed", "run-failed"),
      ]),
    ).toThrow("multiple run terminal events");
  });

  test("rejects any event after a run terminal", () => {
    expect(() =>
      assertDriverEventBatchTerminalOrder([
        driverEvent("run.completed", "run-completed"),
        driverEvent("message.completed", "late-message"),
      ]),
    ).toThrow("must be last");
  });
});
