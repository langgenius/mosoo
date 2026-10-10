import { describe, expect, test } from "bun:test";

import { EventType, MOSOO_CUSTOM_EVENT } from "@mosoo/ag-ui-session";
import { createPlatformId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import {
  createProcessDraftFromRuntimeEvent,
  createRuntimeEvent,
  parseRuntimeEventEnvelope,
  projectRuntimeEventToAgUiSessionEvents,
  RUNTIME_EVENT_SCHEMA_VERSION,
} from "@mosoo/runtime-events";

const OCCURRED_AT = "2026-05-26T00:00:00.000Z";

function driverEnvelope(input: Record<string, unknown>): Record<string, unknown> {
  return {
    actor: "driver",
    delivery: "lossless",
    driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
    id: createPlatformId(),
    occurredAt: OCCURRED_AT,
    origin: "driver",
    runId: PLATFORM_ID_FIXTURES.sessionRun,
    runtimeId: "openai-runtime",
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    sessionId: PLATFORM_ID_FIXTURES.session,
    visibility: "participant",
    ...input,
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];

  if (value === undefined) {
    throw new Error("Expected at least one value.");
  }

  return value;
}

describe("runtime event AG-UI adapter", () => {
  test("projects runtime run events through session run updates", () => {
    const started = first(
      projectRuntimeEventToAgUiSessionEvents(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "run.started",
          occurredAt: OCCURRED_AT,
          payload: {
            startedAt: OCCURRED_AT,
          },
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          sessionId: PLATFORM_ID_FIXTURES.session,
          traceId: "trace-1",
        }),
      ),
    );
    const failedAt = "2026-05-26T00:00:02.000Z";
    const failed = first(
      projectRuntimeEventToAgUiSessionEvents(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "run.failed",
          occurredAt: failedAt,
          payload: {
            error: {
              code: "runtime.failed",
              message: "Runtime failed.",
            },
          },
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          sessionId: PLATFORM_ID_FIXTURES.session,
          traceId: "trace-1",
        }),
      ),
    );

    expect(started).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
      type: EventType.CUSTOM,
      value: {
        lifecycle: "RUNNING",
        run: {
          id: PLATFORM_ID_FIXTURES.sessionRun,
          startedAt: OCCURRED_AT,
          status: "running",
          traceId: "trace-1",
        },
      },
    });
    expect(failed).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
      type: EventType.CUSTOM,
      value: {
        lifecycle: "IDLE",
        run: {
          completedAt: failedAt,
          error: {
            code: "runtime.failed",
            message: "Runtime failed.",
          },
          id: PLATFORM_ID_FIXTURES.sessionRun,
          status: "failed",
          traceId: "trace-1",
        },
      },
    });
  });

  test("projects nested run lifecycle payloads with envelope-owned identity", () => {
    const completedAt = "2026-05-26T00:00:03.000Z";
    const completed = first(
      projectRuntimeEventToAgUiSessionEvents(
        parseRuntimeEventEnvelope(
          createRuntimeEvent({
            id: createPlatformId(),
            kind: "run.completed",
            occurredAt: completedAt,
            payload: {
              checkpoint: {
                formatVersion: 1,
                nativeRef: {
                  kind: "openai_thread_id",
                  runtimeId: "openai-runtime",
                  value: "thread-1",
                },
                runId: PLATFORM_ID_FIXTURES.sessionRun,
              },
              lifecycle: "TERMINATED",
              run: {
                completedAt,
                error: null,
                id: "provider-run",
                startedAt: OCCURRED_AT,
                status: "completed",
                traceId: "provider-trace",
              },
            },
            runId: PLATFORM_ID_FIXTURES.sessionRun,
            runtimeId: "openai-runtime",
            sessionId: PLATFORM_ID_FIXTURES.session,
            traceId: "trace-envelope",
          }),
        ),
      ),
    );

    expect(completed).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
      type: EventType.CUSTOM,
      value: {
        lifecycle: "TERMINATED",
        run: {
          completedAt,
          id: PLATFORM_ID_FIXTURES.sessionRun,
          startedAt: OCCURRED_AT,
          status: "completed",
          traceId: "trace-envelope",
        },
      },
    });
  });

  test("rejects malformed failed run payloads before projection defaults", () => {
    const failed = createRuntimeEvent({
      id: createPlatformId(),
      kind: "run.failed",
      occurredAt: "2026-05-26T00:00:02.000Z",
      payload: {
        error: {
          code: "runtime.failed",
        },
      },
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => parseRuntimeEventEnvelope(failed)).toThrow();
  });

  test("rejects runtime events with unsupported canonical fields", () => {
    expect(() =>
      parseRuntimeEventEnvelope(
        driverEnvelope({
          kind: "message.unknown",
          payload: {},
        }),
      ),
    ).toThrow();

    expect(() =>
      parseRuntimeEventEnvelope(
        driverEnvelope({
          actor: "viewer",
          kind: "message.delta",
          payload: {
            contentDelta: "hello",
          },
        }),
      ),
    ).toThrow();
  });

  test("validates runtime envelope native refs and payload presence", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "diagnostic.reported",
      native: {
        provider: "openai",
        sequence: 1,
        threadId: "thread-1",
      },
      occurredAt: OCCURRED_AT,
      payload: {
        message: "ok",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(parseRuntimeEventEnvelope(event)).toMatchObject({
      kind: "diagnostic.reported",
      native: {
        provider: "openai",
        threadId: "thread-1",
      },
      payload: {
        message: "ok",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    const { payload: _payload, ...missingPayload } = event;

    expect(() => parseRuntimeEventEnvelope(missingPayload)).toThrow();
  });

  test("parses envelope IDs into canonical semantic IDs", () => {
    const event = {
      actor: "driver",
      delivery: "lossless",
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance.toLowerCase(),
      id: PLATFORM_ID_FIXTURES.runtimeEvent.toLowerCase(),
      kind: "diagnostic.reported",
      occurredAt: OCCURRED_AT,
      origin: "driver",
      payload: {
        message: "ok",
      },
      runId: PLATFORM_ID_FIXTURES.sessionRun.toLowerCase(),
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      sessionId: PLATFORM_ID_FIXTURES.session.toLowerCase(),
      visibility: "participant",
    };

    expect(parseRuntimeEventEnvelope(event)).toMatchObject({
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      id: PLATFORM_ID_FIXTURES.runtimeEvent,
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => parseRuntimeEventEnvelope({ ...event, runId: "run-1" })).toThrow();
  });

  test("rejects malformed public runtime event payloads at ingress", () => {
    const baseEvent = createRuntimeEvent({
      id: createPlatformId(),
      kind: "message.delta",
      occurredAt: OCCURRED_AT,
      payload: {
        messageId: "message-1",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => parseRuntimeEventEnvelope(baseEvent)).toThrow();

    expect(() =>
      parseRuntimeEventEnvelope(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "file.change.updated",
          occurredAt: OCCURRED_AT,
          payload: {
            change: "move",
            path: "notes.txt",
          },
          sessionId: PLATFORM_ID_FIXTURES.session,
        }),
      ),
    ).toThrow();

    expect(() =>
      parseRuntimeEventEnvelope(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "runtime.timing.recorded",
          occurredAt: OCCURRED_AT,
          payload: {
            completedAtMs: 100,
            path: "warm",
            phases: [],
            runId: null,
            sessionId: PLATFORM_ID_FIXTURES.session,
            source: "driver",
            stage: "driver_turn",
            startedAtMs: 110,
            totalMs: -10,
            traceId: null,
          },
          sessionId: PLATFORM_ID_FIXTURES.session,
        }),
      ),
    ).toThrow();
  });

  test("round-trips permission requests through canonical events and session delivery events", () => {
    const event = parseRuntimeEventEnvelope(
      driverEnvelope({
        kind: "permission.requested",
        payload: {
          details: '{"command":"pwd"}',
          options: [],
          requestId: "permission-1",
          targetItemId: "tool-1",
          title: "Approve command",
          toolCall: {
            kind: "bash",
            toolCallId: "tool-1",
          },
        },
      }),
    );

    expect(event.kind).toBe("permission.requested");
    expect(event.payload).toMatchObject({
      details: '{"command":"pwd"}',
      requestId: "permission-1",
      targetItemId: "tool-1",
      title: "Approve command",
      toolCall: {
        kind: "bash",
        toolCallId: "tool-1",
      },
    });

    const deliveryEvent = first(projectRuntimeEventToAgUiSessionEvents(event));

    if (deliveryEvent.type !== EventType.CUSTOM) {
      throw new Error("Expected a custom delivery event.");
    }

    expect(deliveryEvent.name).toBe(MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name);
    expect(deliveryEvent.value.permissionRequests).toHaveLength(1);
    expect(deliveryEvent.value.permissionRequests[0]).toMatchObject({
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      rawInput: '{"command":"pwd"}',
      requestId: "permission-1",
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      title: "Approve command",
      toolCallId: "tool-1",
      toolKind: "bash",
    });
  });

  test("projects failed tool output as a tool result before ending the call", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "tool.call.updated",
      occurredAt: OCCURRED_AT,
      payload: {
        rawOutput:
          "Tool failed before returning a result: Runtime driver control socket is not connected.",
        status: "failed",
        title: "Shell",
        toolCallId: "tool-1",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(projectRuntimeEventToAgUiSessionEvents(event)).toEqual([
      {
        content:
          "Tool failed before returning a result: Runtime driver control socket is not connected.",
        messageId: event.id,
        toolCallId: "tool-1",
        type: EventType.TOOL_CALL_RESULT,
      },
      {
        toolCallId: "tool-1",
        type: EventType.TOOL_CALL_END,
      },
    ]);
  });

  test("projects full tool input as a snapshot without fabricating a new start", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "tool.call.updated",
      occurredAt: OCCURRED_AT,
      payload: {
        rawInput: '{"command":"pwd"}',
        status: "running",
        toolCallId: "tool-1",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(projectRuntimeEventToAgUiSessionEvents(event)).toEqual([
      {
        name: MOSOO_CUSTOM_EVENT.sessionToolInputUpdated.name,
        type: EventType.CUSTOM,
        value: { rawInput: '{"command":"pwd"}', toolCallId: "tool-1" },
      },
    ]);
  });

  test("projects running tool start metadata before tool args", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "tool.call.updated",
      occurredAt: OCCURRED_AT,
      payload: {
        parentMessageId: "assistant-1",
        rawInput: '{"command":"pwd"}',
        status: "running",
        title: "Bash",
        toolCallId: "tool-1",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(projectRuntimeEventToAgUiSessionEvents(event)).toEqual([
      {
        parentMessageId: "assistant-1",
        toolCallId: "tool-1",
        toolCallName: "Bash",
        type: EventType.TOOL_CALL_START,
      },
      {
        name: MOSOO_CUSTOM_EVENT.sessionToolInputUpdated.name,
        type: EventType.CUSTOM,
        value: { rawInput: '{"command":"pwd"}', toolCallId: "tool-1" },
      },
    ]);
  });

  test("projects permission resolution through the same session permission event", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "permission.resolved",
      occurredAt: OCCURRED_AT,
      payload: {
        outcome: "allow_once",
        requestId: "permission-1",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    const [deliveryEvent] = projectRuntimeEventToAgUiSessionEvents(event);

    expect(deliveryEvent).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name,
      value: {
        permissionRequests: [],
      },
    });
  });

  test("rejects malformed tool call payloads at ingress", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "tool.call.updated",
      occurredAt: OCCURRED_AT,
      payload: {
        rawOutput: "success",
        status: "completed",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => parseRuntimeEventEnvelope(event)).toThrow();
  });

  test("does not project owner diagnostics into participant delivery by default", () => {
    const defaultDiagnostic = createRuntimeEvent({
      id: createPlatformId(),
      kind: "diagnostic.reported",
      occurredAt: OCCURRED_AT,
      payload: {
        message: "transport connected",
        severity: "info",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });
    const ownerDebugDiagnostic = createRuntimeEvent({
      id: createPlatformId(),
      kind: "diagnostic.reported",
      occurredAt: OCCURRED_AT,
      payload: {
        message: "transport connected",
        severity: "info",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
      visibility: "owner_debug",
    });

    expect(projectRuntimeEventToAgUiSessionEvents(defaultDiagnostic)).toEqual([]);
    expect(projectRuntimeEventToAgUiSessionEvents(ownerDebugDiagnostic)).toEqual([]);
  });

  test("creates process drafts directly from canonical runtime timing payloads", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "runtime.timing.recorded",
      occurredAt: "2026-05-26T00:00:01.050Z",
      payload: {
        completedAtMs: 1_050,
        path: "warm",
        phases: [],
        source: "driver",
        stage: "driver_turn",
        startedAtMs: 1_000,
        totalMs: 50,
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    const draft = createProcessDraftFromRuntimeEvent(event);

    expect(draft.type).toBe("session.status");
    expect(draft.content.includes("driver_turn")).toBe(true);
    expect(draft.content.includes("50")).toBe(true);
  });

  test("creates process drafts directly from canonical file change payloads", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "file.change.updated",
      occurredAt: OCCURRED_AT,
      payload: {
        changes: [
          {
            change: "upsert",
            path: "src/app.ts",
          },
        ],
        status: "completed",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(createProcessDraftFromRuntimeEvent(event)).toEqual({
      content: "src/app.ts",
      type: "file.changed",
    });
  });
});
