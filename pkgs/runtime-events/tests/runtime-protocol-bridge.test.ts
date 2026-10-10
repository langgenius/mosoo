import { describe, expect, test } from "bun:test";

import {
  applyAgUiEventsToSessionLiveState,
  createInitialSessionLiveState,
  EventType,
} from "@mosoo/ag-ui-session";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import {
  createProcessDraftFromRuntimeEvent,
  getRuntimeEventParticipantVisibility,
  parseRuntimeEventEnvelope,
  projectRuntimeEventToAgUiSessionEvents,
  RUNTIME_EVENT_SCHEMA_VERSION,
} from "@mosoo/runtime-events";

const nativeRef = { kind: "openai_thread_id", runtimeId: "openai-runtime", value: "thread-1" };
const checkpoint = { formatVersion: 1, nativeRef, runId: PLATFORM_ID_FIXTURES.sessionRun };

function envelope(kind: string, payload: unknown, fields: Record<string, unknown> = {}) {
  return {
    actor: "driver",
    delivery: "lossless",
    driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
    id: PLATFORM_ID_FIXTURES.runtimeEvent,
    kind,
    occurredAt: "2026-10-10T00:00:00.000Z",
    origin: "driver",
    payload,
    runId: PLATFORM_ID_FIXTURES.sessionRun,
    runtimeId: "openai-runtime",
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    sessionId: PLATFORM_ID_FIXTURES.session,
    visibility: "participant",
    ...fields,
  };
}

describe("Driver protocol projection bridge", () => {
  test.each(["2026-05-26", "2026-08-29"])("rejects %s as live traffic", (schemaVersion) => {
    expect(() =>
      parseRuntimeEventEnvelope(envelope("run.completed", { checkpoint }, { schemaVersion })),
    ).toThrow("schema version");
  });

  test("requires the completed checkpoint to match the event run and runtime", () => {
    const event = parseRuntimeEventEnvelope(envelope("run.completed", { checkpoint }));
    expect(event.payload).toEqual({ checkpoint });
    expect(projectRuntimeEventToAgUiSessionEvents(event)[0]).toMatchObject({
      value: { run: { id: PLATFORM_ID_FIXTURES.sessionRun, status: "completed" } },
    });
    for (const payload of [
      {},
      { checkpoint: { ...checkpoint, runId: PLATFORM_ID_FIXTURES.runtimeEvent } },
      { checkpoint: { ...checkpoint, nativeRef: { ...nativeRef, runtimeId: "pi" } } },
    ]) {
      expect(() => parseRuntimeEventEnvelope(envelope("run.completed", payload))).toThrow();
    }
  });

  test("admits only lossless session resets with matching native identities", () => {
    const payload = {
      previousCheckpoint: checkpoint,
      previousNativeRef: nativeRef,
      newNativeRef: { ...nativeRef, value: "thread-2" },
    };
    const reset = envelope("runtime.session.reset", payload, { runId: undefined });
    const event = parseRuntimeEventEnvelope(reset);
    expect(event.payload).toEqual(payload);
    expect(projectRuntimeEventToAgUiSessionEvents(event)).toEqual([]);
    for (const fields of [
      { runId: PLATFORM_ID_FIXTURES.sessionRun },
      { delivery: "best_effort" },
      { payload: { ...payload, previousNativeRef: { ...nativeRef, value: "another-thread" } } },
    ]) {
      expect(() => parseRuntimeEventEnvelope({ ...reset, ...fields })).toThrow();
    }
  });

  test.each(["message.cancelled", "message.failed", "thought.cancelled"])(
    "closes the correct visible stream for %s",
    (kind) => {
      const payload = kind.startsWith("thought.")
        ? { thoughtId: "thought-1" }
        : {
            messageId: "message-1",
            ...(kind === "message.failed"
              ? {
                  error: { code: "provider.failed", message: "Provider failed.", retryable: false },
                }
              : {}),
          };
      const events = projectRuntimeEventToAgUiSessionEvents(
        parseRuntimeEventEnvelope(envelope(kind, payload)),
      );
      expect(events).toEqual([
        {
          messageId: kind.startsWith("thought.") ? "thought-1" : "message-1",
          type: kind.startsWith("thought.")
            ? EventType.REASONING_MESSAGE_END
            : EventType.TEXT_MESSAGE_END,
        },
      ]);
    },
  );

  test("projects tool input deltas and cancellation without leaving the tool running", () => {
    const delta = parseRuntimeEventEnvelope(
      envelope("tool.call.updated", {
        status: "running",
        toolCallId: "tool-1",
        rawInputDelta: "{}",
      }),
    );
    expect(projectRuntimeEventToAgUiSessionEvents(delta)).toEqual([
      { delta: "{}", toolCallId: "tool-1", type: EventType.TOOL_CALL_ARGS },
    ]);
    const cancelled = parseRuntimeEventEnvelope(
      envelope("tool.call.updated", { status: "cancelled", toolCallId: "tool-1", title: "Shell" }),
    );
    expect(projectRuntimeEventToAgUiSessionEvents(cancelled)).toContainEqual({
      content: "Shell cancelled.",
      messageId: PLATFORM_ID_FIXTURES.runtimeEvent,
      toolCallId: "tool-1",
      type: EventType.TOOL_CALL_RESULT,
    });
    expect(createProcessDraftFromRuntimeEvent(cancelled).type).toBe("tool.use.completed");
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope("tool.call.updated", {
          status: "running",
          toolCallId: "tool-1",
          rawInput: "{}",
          rawInputDelta: "{}",
        }),
      ),
    ).toThrow("both rawInput and rawInputDelta");
  });

  test("applies a streamed tool snapshot once before subsequent input deltas", () => {
    const payloads = [
      { parentMessageId: "assistant-1", title: "Shell" },
      { rawInputDelta: '{"cmd":"' },
      { rawInput: '{"cmd":"pwd' },
      { rawInputDelta: '"}' },
    ];
    const projected = payloads.flatMap((payload) =>
      projectRuntimeEventToAgUiSessionEvents(
        parseRuntimeEventEnvelope(
          envelope("tool.call.updated", {
            ...payload,
            status: "running",
            toolCallId: "tool-1",
          }),
        ),
      ),
    );
    const initial = createInitialSessionLiveState({
      sessionId: PLATFORM_ID_FIXTURES.session,
      title: null,
      viewerId: "viewer-1",
    });
    const state = applyAgUiEventsToSessionLiveState(initial, projected);
    expect(state.messages[0]?.segments).toMatchObject([
      { argsText: '{"cmd":"pwd"}', toolCallId: "tool-1" },
    ]);
  });

  test("keeps task snapshots strict and context occupancy out of usage projection", () => {
    expect(
      parseRuntimeEventEnvelope(envelope("agent.tasks.replaced", { tasks: [{ taskId: "task-1" }] }))
        .payload,
    ).toEqual({ tasks: [{ taskId: "task-1" }] });
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope("agent.tasks.replaced", {
          tasks: [{ taskId: "task-1" }, { taskId: "task-1" }],
        }),
      ),
    ).toThrow();
    const occupancy = parseRuntimeEventEnvelope(
      envelope("context.usage.updated", { used: 12, size: 10 }),
    );
    expect(projectRuntimeEventToAgUiSessionEvents(occupancy)).toEqual([]);
    expect(createProcessDraftFromRuntimeEvent(occupancy).tokens).toBeUndefined();
    expect(() =>
      parseRuntimeEventEnvelope(envelope("context.usage.updated", { used: 12, size: 10, cost: 1 })),
    ).toThrow();
  });

  test("does not expose internal driver events to participants", () => {
    const event = parseRuntimeEventEnvelope(
      envelope(
        "message.delta",
        {
          contentDelta: "internal",
          messageId: "message-1",
        },
        { visibility: "system_internal" },
      ),
    );
    expect(getRuntimeEventParticipantVisibility(event)).toBe("owner_debug");
    expect(projectRuntimeEventToAgUiSessionEvents(event)).toEqual([]);
  });

  test("preserves host timing and permission snapshot constraints", () => {
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope("runtime.timing.recorded", {
          completedAt: "1969-12-31T23:59:59.500Z",
          path: "warm",
          phases: [],
          source: "driver",
          stage: "driver_turn",
          startedAt: "1969-12-31T23:59:59.000Z",
          totalMs: 500,
        }),
      ),
    ).toThrow("Unix epoch");
    expect(() =>
      parseRuntimeEventEnvelope(
        envelope("permission.resolved", {
          requestId: "permission-1",
          outcome: "allow_once",
          permissionRequests: {},
        }),
      ),
    ).toThrow("permissionRequests");
  });
});
