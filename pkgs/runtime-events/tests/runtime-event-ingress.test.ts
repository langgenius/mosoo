import { describe, expect, test } from "bun:test";

import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import {
  isRuntimeEventRecord,
  parseRuntimeEventEnvelope,
  readRuntimeEventPermissionRequest,
  RUNTIME_EVENT_SCHEMA_VERSION,
} from "@mosoo/runtime-events";

const OCCURRED_AT = "2026-05-26T00:00:00.000Z";

function envelope(input: Record<string, unknown>): Record<string, unknown> {
  return {
    actor: "driver",
    delivery: "lossless",
    id: PLATFORM_ID_FIXTURES.runtimeEvent,
    occurredAt: OCCURRED_AT,
    origin: "driver",
    runId: PLATFORM_ID_FIXTURES.sessionRun,
    runtimeId: "runtime-envelope",
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    sessionId: PLATFORM_ID_FIXTURES.session,
    traceId: "trace-envelope",
    visibility: "participant",
    ...input,
  };
}

describe("runtime event ingress", () => {
  test("rejects malformed public payloads before projection can repair them", () => {
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope({
          kind: "tool.call.updated",
          payload: {
            status: "done",
            toolCallId: "tool-1",
          },
        }),
      ),
    ).toThrow();
  });

  test("rejects malformed run lifecycle payloads before projection can repair them", () => {
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope({
          driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
          kind: "run.completed",
          payload: {
            stopReason: "end_turn",
          },
          runId: undefined,
        }),
      ),
    ).toThrow();
    expect(() =>
      parseRuntimeEventEnvelope(envelope({ kind: "run.started", payload: {} })),
    ).toThrow();
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope({
          kind: "run.failed",
          payload: {
            error: {
              code: "runtime.failed",
            },
          },
        }),
      ),
    ).toThrow();
  });

  test("rejects usage figures the cost ledger cannot store", () => {
    // Driver frames are JSON, where 1e999 parses to Infinity.
    const usage = (inputTokens: string) =>
      parseRuntimeEventEnvelope(
        envelope({
          kind: "usage.updated",
          payload: JSON.parse(`{"inputTokens":${inputTokens},"source":"session_update"}`),
        }),
      );

    expect(() => usage("1e999")).toThrow();
    expect(() => usage("1e303")).toThrow();
    expect(usage("12345").payload).toEqual({ inputTokens: 12345, source: "session_update" });
  });

  test("rejects permission requests without a canonical run owner", () => {
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope({
          driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
          kind: "permission.requested",
          payload: {
            requestId: "permission-1",
            title: "Approve command",
          },
          runId: undefined,
        }),
      ),
    ).toThrow();
  });

  test("owns canonical permission request payload projection", () => {
    const event = parseRuntimeEventEnvelope(
      envelope({
        driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
        kind: "permission.requested",
        payload: {
          details: '{"command":"pwd"}',
          options: [],
          requestId: "permission-1",
          targetItemId: "tool-1",
          title: "Approve command",
          toolCall: {
            kind: "shell",
            toolCallId: "tool-1",
          },
        },
      }),
    );

    expect(readRuntimeEventPermissionRequest(event)).toMatchObject({
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      rawInput: '{"command":"pwd"}',
      requestId: "permission-1",
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      title: "Approve command",
      toolCallId: "tool-1",
      toolKind: "shell",
    });
  });

  test("rejects malformed permission request payloads before projection can repair them", () => {
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope({
          driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
          kind: "permission.requested",
          payload: {
            requestId: "permission-1",
          },
        }),
      ),
    ).toThrow();
  });

  test("keeps envelope identity ahead of nested run view identity", () => {
    const event = parseRuntimeEventEnvelope(
      envelope({
        kind: "run.completed",
        payload: {
          lifecycle: "IDLE",
          run: {
            completedAt: OCCURRED_AT,
            error: null,
            id: "provider-run",
            startedAt: OCCURRED_AT,
            status: "completed",
            traceId: "provider-trace",
          },
        },
      }),
    );

    expect(event.runId).toBe(PLATFORM_ID_FIXTURES.sessionRun);
    expect(event.traceId).toBe("trace-envelope");

    if (!isRuntimeEventRecord(event.payload) || !isRuntimeEventRecord(event.payload["run"])) {
      throw new Error("Expected an admitted run view payload.");
    }

    expect(event.payload["run"]).toMatchObject({
      id: PLATFORM_ID_FIXTURES.sessionRun,
      traceId: "trace-envelope",
    });
  });

  test("keeps envelope identity ahead of payload identity", () => {
    const event = parseRuntimeEventEnvelope(
      envelope({
        kind: "runtime.timing.recorded",
        payload: {
          completedAtMs: 1_100,
          path: "warm",
          phases: [],
          runId: "run-payload",
          sessionId: "session-payload",
          source: "driver",
          stage: "driver_turn",
          startedAtMs: 1_000,
          totalMs: 100,
          traceId: "trace-payload",
        },
      }),
    );

    expect(event.runId).toBe(PLATFORM_ID_FIXTURES.sessionRun);
    expect(event.sessionId).toBe(PLATFORM_ID_FIXTURES.session);
    expect(event.traceId).toBe("trace-envelope");
    expect(event.payload).toMatchObject({
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
      traceId: "trace-envelope",
    });
  });

  test("admits Driver Contract v2 timing payloads with ISO timestamps", () => {
    const event = parseRuntimeEventEnvelope(
      envelope({
        kind: "runtime.timing.recorded",
        payload: {
          completedAt: "1970-01-01T00:00:01.100Z",
          path: "cold",
          phases: [{ durationMs: 100, name: "config_bootstrap" }],
          runId: "run-payload",
          sessionId: "session-payload",
          source: "driver",
          stage: "driver_backend",
          startedAt: "1970-01-01T00:00:01.000Z",
          totalMs: 100,
          traceId: null,
        },
      }),
    );

    expect(event.payload).toMatchObject({
      completedAtMs: 1_100,
      startedAtMs: 1_000,
      totalMs: 100,
    });
  });

  test("removes envelope-owned fields from public payloads", () => {
    const event = parseRuntimeEventEnvelope(
      envelope({
        kind: "message.delta",
        payload: {
          contentDelta: "hello",
          messageId: "message-1",
          role: "agent",
          runId: "run-payload",
          sessionId: "session-payload",
          traceId: "trace-payload",
        },
      }),
    );

    expect(event.payload).toEqual({
      contentDelta: "hello",
      messageId: "message-1",
      role: "agent",
    });
  });

  test("rejects malformed envelope-owned platform IDs while preserving native IDs as provider refs", () => {
    const native = {
      provider: "openai",
      threadId: "thread-provider-1",
      turnId: "turn-provider-1",
    };

    expect(() =>
      parseRuntimeEventEnvelope(
        envelope({
          id: "event-provider-ref",
          kind: "diagnostic.reported",
          native,
          payload: {
            message: "ok",
          },
        }),
      ),
    ).toThrow();

    const accepted = parseRuntimeEventEnvelope(
      envelope({
        kind: "diagnostic.reported",
        native,
        payload: {
          message: "ok",
        },
      }),
    );

    expect(accepted.native).toMatchObject(native);
  });
});
