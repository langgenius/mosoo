import { describe, expect, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import {
  createRuntimeEvent,
  getRuntimeEventSessionFamily,
  ingestRuntimeDiagnosticEvent,
  ingestRuntimeEventInput,
  isRuntimeEventRecord,
  readRuntimeEventPermissionRequest,
  toRuntimeEventInput,
} from "@mosoo/runtime-events";
import type { RuntimeEventBuildContext } from "@mosoo/runtime-events";

const OCCURRED_AT = "2026-05-26T00:00:00.000Z";

function createContext(): RuntimeEventBuildContext {
  return {
    createId: createPlatformId,
    occurredAt: OCCURRED_AT,
    runId: PLATFORM_ID_FIXTURES.sessionRun,
    runtimeId: "runtime-envelope",
    sessionId: PLATFORM_ID_FIXTURES.session,
    traceId: "trace-envelope",
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];

  if (value === undefined) {
    throw new Error("Expected at least one value.");
  }

  return value;
}

describe("runtime event ingress", () => {
  test("owns session family classification for projected runtime events", () => {
    expect(
      getRuntimeEventSessionFamily(
        createRuntimeEvent({
          actor: "system",
          id: PLATFORM_ID_FIXTURES.runtimeEvent,
          kind: "runtime.provisioning.updated",
          occurredAt: OCCURRED_AT,
          origin: "system",
          payload: { phase: "start", status: "running" },
          sessionId: PLATFORM_ID_FIXTURES.session,
        }),
      ),
    ).toBe("provisioning");
    expect(
      getRuntimeEventSessionFamily(
        createRuntimeEvent({
          actor: "driver",
          id: PLATFORM_ID_FIXTURES.runtimeEvent,
          kind: "tool.call.updated",
          occurredAt: OCCURRED_AT,
          origin: "driver",
          payload: { status: "running", toolCallId: "tool-1" },
          sessionId: PLATFORM_ID_FIXTURES.session,
        }),
      ),
    ).toBe("tool");
  });

  test("returns typed rejections for unsupported event kinds", () => {
    const outcome = ingestRuntimeEventInput(createContext(), {
      kind: "message.unknown",
      payload: {},
    });

    expect(outcome).toMatchObject({
      rejection: {
        code: "unsupported_kind",
        kind: "message.unknown",
      },
      status: "rejected",
    });
  });

  test("rejects malformed public payloads before projection can repair them", () => {
    const outcome = ingestRuntimeEventInput(createContext(), {
      kind: "tool.call.updated",
      payload: {
        status: "done",
        toolCallId: "tool-1",
      },
    });

    expect(outcome.status).toBe("rejected");

    if (outcome.status !== "rejected") {
      throw new Error("Expected a rejected runtime event.");
    }

    expect(outcome.rejection.code).toBe("malformed_event");
    expect(outcome.rejection.kind).toBe("tool.call.updated");
  });

  test("rejects malformed run lifecycle payloads before projection can repair them", () => {
    const missingRunId = ingestRuntimeEventInput(
      {
        ...createContext(),
        driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
        runId: undefined,
      },
      {
        kind: "run.completed",
        payload: {
          stopReason: "end_turn",
        },
      },
    );
    const missingStartTime = ingestRuntimeEventInput(createContext(), {
      kind: "run.started",
      payload: {},
    });
    const missingErrorMessage = ingestRuntimeEventInput(createContext(), {
      kind: "run.failed",
      payload: {
        error: {
          code: "runtime.failed",
        },
      },
    });

    expect(missingRunId).toMatchObject({
      rejection: {
        code: "malformed_event",
        kind: "run.completed",
      },
      status: "rejected",
    });
    expect(missingStartTime).toMatchObject({
      rejection: {
        code: "malformed_event",
        kind: "run.started",
      },
      status: "rejected",
    });
    expect(missingErrorMessage).toMatchObject({
      rejection: {
        code: "malformed_event",
        kind: "run.failed",
      },
      status: "rejected",
    });
  });

  test("rejects permission requests without a canonical run owner", () => {
    const outcome = ingestRuntimeEventInput(
      {
        ...createContext(),
        driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
        runId: undefined,
      },
      {
        kind: "permission.requested",
        payload: {
          requestId: "permission-1",
          title: "Approve command",
        },
      },
    );

    expect(outcome).toMatchObject({
      rejection: {
        code: "malformed_event",
        kind: "permission.requested",
      },
      status: "rejected",
    });
  });

  test("owns canonical permission request payload projection", () => {
    const event = first(
      toRuntimeEventInput(
        {
          ...createContext(),
          driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
        },
        {
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
        },
      ),
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
    const outcome = ingestRuntimeEventInput(
      {
        ...createContext(),
        driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      },
      {
        kind: "permission.requested",
        payload: {
          requestId: "permission-1",
        },
      },
    );

    expect(outcome).toMatchObject({
      rejection: {
        code: "malformed_event",
        kind: "permission.requested",
      },
      status: "rejected",
    });
  });

  test("keeps envelope identity ahead of nested run view identity", () => {
    const event = first(
      toRuntimeEventInput(createContext(), {
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
    const event = first(
      toRuntimeEventInput(createContext(), {
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

    if (!isRuntimeEventRecord(event.payload)) {
      throw new Error("Expected a runtime timing payload.");
    }

    expect(event.payload).toMatchObject({
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
      traceId: "trace-envelope",
    });
  });

  test("removes envelope-owned fields from public payloads", () => {
    const event = first(
      toRuntimeEventInput(createContext(), {
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
    const malformedDraft = ingestRuntimeEventInput(createContext(), {
      id: "event-provider-ref",
      kind: "diagnostic.reported",
      native: {
        provider: "openai",
        threadId: "thread-provider-1",
        turnId: "turn-provider-1",
      },
      payload: {
        message: "ok",
      },
    });

    expect(malformedDraft).toMatchObject({
      rejection: {
        code: "malformed_event",
        kind: "diagnostic.reported",
      },
      status: "rejected",
    });

    const accepted = ingestRuntimeEventInput(createContext(), {
      actor: "driver",
      delivery: "lossless",
      id: PLATFORM_ID_FIXTURES.runtimeEvent,
      kind: "diagnostic.reported",
      native: {
        provider: "openai",
        threadId: "thread-provider-1",
        turnId: "turn-provider-1",
      },
      occurredAt: OCCURRED_AT,
      origin: "driver",
      payload: {
        message: "ok",
      },
      schemaVersion: "2026-05-26",
      sessionId: PLATFORM_ID_FIXTURES.session,
      visibility: "participant",
    });

    expect(accepted.status).toBe("accepted");

    if (accepted.status !== "accepted") {
      throw new Error("Expected accepted native provider refs.");
    }

    expect(accepted.event.native).toMatchObject({
      provider: "openai",
      threadId: "thread-provider-1",
      turnId: "turn-provider-1",
    });
  });

  test("admits API-authored diagnostics through the same ingress owner", () => {
    const outcome = ingestRuntimeDiagnosticEvent(createContext(), {
      eventName: "runtime.config.credential.missing",
      value: {
        agentId: PLATFORM_ID_FIXTURES.agent,
        provider: "openai",
        reason: "credential unavailable",
        sessionId: PLATFORM_ID_FIXTURES.session,
      },
    });

    expect(outcome.status).toBe("accepted");

    if (outcome.status !== "accepted") {
      throw new Error("Expected an accepted diagnostic event.");
    }

    expect(outcome.event).toMatchObject({
      actor: "system",
      kind: "runtime.config.updated",
      origin: "system",
      sessionId: PLATFORM_ID_FIXTURES.session,
    });
    expect(outcome.event.payload).toMatchObject({
      phase: "credential",
      status: "failed",
    });
  });
});
