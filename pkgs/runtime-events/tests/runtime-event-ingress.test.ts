import { describe, expect, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import {
  createRuntimeEvent,
  createRuntimeEventSemanticHash,
  getRuntimeEventSessionFamily,
  ingestRuntimeDiagnosticEvent,
  ingestRuntimeEventInput,
  isRuntimeEventRecord,
  parseRuntimeEventEnvelope,
  readRuntimeEventPayload,
  readRuntimeEventPermissionRequest,
  readRuntimeEventToolCallId,
  readRuntimeEventToolCallUpdate,
  toRuntimeEventInput,
} from "@mosoo/runtime-events";
import type { RuntimeEventBuildContext } from "@mosoo/runtime-events";

const OCCURRED_AT = "2026-05-26T00:00:00.000Z";

declare const foreignRuntimeEventIdBrand: unique symbol;
interface ForeignRuntimeEvent {
  readonly id: string & { readonly [foreignRuntimeEventIdBrand]: "foreign" };
  readonly kind: "tool.call.updated";
  readonly payload: unknown;
}

const payloadReaderAcceptsForeignEvent: ForeignRuntimeEvent extends Parameters<
  typeof readRuntimeEventPayload
>[0]
  ? true
  : false = true;
const toolCallReaderAcceptsForeignEvent: ForeignRuntimeEvent extends Parameters<
  typeof readRuntimeEventToolCallId
>[0]
  ? true
  : false = true;

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
  test("keeps foreign ID brands out of pure event readers", () => {
    const event = {
      id: "foreign-event-1",
      kind: "tool.call.updated",
      payload: { toolCallId: "tool-1" },
    };

    expect(payloadReaderAcceptsForeignEvent).toBeTrue();
    expect(toolCallReaderAcceptsForeignEvent).toBeTrue();
    expect(readRuntimeEventPayload(event)).toEqual({ toolCallId: "tool-1" });
    expect(readRuntimeEventToolCallId(event)).toBe("tool-1");
  });

  test("rejects the previous runtime event schema", () => {
    expect(() =>
      parseRuntimeEventEnvelope({
        ...createRuntimeEvent({
          actor: "driver",
          id: PLATFORM_ID_FIXTURES.runtimeEvent,
          kind: "diagnostic.reported",
          occurredAt: OCCURRED_AT,
          origin: "driver",
          payload: { message: "ok" },
          sessionId: PLATFORM_ID_FIXTURES.session,
        }),
        schemaVersion: "2026-05-26",
      }),
    ).toThrow("Runtime event schema version is unsupported");
  });

  test.each([
    ["envelope", { extra: true }],
    ["context", { context: { extra: true } }],
    ["surface", { context: { surface: { extra: true, type: "web" } } }],
    ["native", { native: { extra: true, provider: "openai" } }],
  ] as const)("rejects undeclared canonical %s fields", (_label, override) => {
    const event = createRuntimeEvent({
      id: PLATFORM_ID_FIXTURES.runtimeEvent,
      kind: "diagnostic.reported",
      occurredAt: OCCURRED_AT,
      payload: { message: "ok" },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => parseRuntimeEventEnvelope({ ...event, ...override })).toThrow("unsupported");
  });

  test("preserves extension payload fields while parsing the exact envelope", () => {
    const event = parseRuntimeEventEnvelope(
      createRuntimeEvent({
        id: PLATFORM_ID_FIXTURES.runtimeEvent,
        kind: "diagnostic.reported",
        occurredAt: OCCURRED_AT,
        payload: { extension: { enabled: true }, message: "ok" },
        sessionId: PLATFORM_ID_FIXTURES.session,
      }),
    );

    expect(event.payload).toEqual({ extension: { enabled: true }, message: "ok" });
  });

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
    expect(
      getRuntimeEventSessionFamily(
        createRuntimeEvent({
          actor: "driver",
          driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
          id: PLATFORM_ID_FIXTURES.runtimeEvent,
          kind: "agent.tasks.replaced",
          occurredAt: OCCURRED_AT,
          origin: "driver",
          payload: { tasks: [] },
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          sessionId: PLATFORM_ID_FIXTURES.session,
        }),
      ),
    ).toBe("state");
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

  test.each([
    ["input snapshot", { rawInput: "" }, { rawInput: "", rawInputDelta: null }],
    ["input delta", { rawInputDelta: "" }, { rawInput: null, rawInputDelta: "" }],
    ["output snapshot", { rawOutput: "" }, { rawOutput: "", rawOutputDelta: null }],
    ["output delta", { rawOutputDelta: "" }, { rawOutput: null, rawOutputDelta: "" }],
  ] as const)("preserves an explicit empty tool %s", (_label, fields, expected) => {
    const outcome = ingestRuntimeEventInput(createContext(), {
      kind: "tool.call.updated",
      payload: { ...fields, status: "running", toolCallId: "tool-1" },
    });

    if (outcome.status !== "accepted") {
      throw new Error("Expected a canonical tool event.");
    }

    expect(readRuntimeEventToolCallUpdate(outcome.event)).toMatchObject(expected);
  });

  test.each([
    [{ rawInput: "{}", rawInputDelta: "{" }, "rawInput"],
    [{ rawOutput: "done", rawOutputDelta: "d" }, "rawOutput"],
  ] as const)("rejects mixed tool %s snapshot and delta fields", (fields, field) => {
    expect(
      ingestRuntimeEventInput(createContext(), {
        kind: "tool.call.updated",
        payload: { ...fields, status: "running", toolCallId: "tool-1" },
      }),
    ).toMatchObject({
      rejection: { code: "malformed_event", message: expect.stringContaining(field) },
    });
  });

  test.each([
    ["message.cancelled", { messageId: "message-1", role: "agent" }],
    [
      "message.failed",
      {
        error: { code: "runtime.failed", message: "Runtime failed." },
        messageId: "message-1",
        role: "agent",
      },
    ],
    ["thought.cancelled", { thoughtId: "thought-1" }],
    ["tool.call.updated", { status: "cancelled", toolCallId: "tool-1" }],
  ])("admits canonical terminal payloads for %s", (kind, payload) => {
    expect(ingestRuntimeEventInput(createContext(), { kind, payload })).toMatchObject({
      event: { kind },
      status: "accepted",
    });
  });

  test.each([
    "message.added",
    "message.cancelled",
    "message.completed",
    "message.delta",
    "message.failed",
    "message.started",
  ])("rejects %s without messageId", (kind) => {
    expect(
      ingestRuntimeEventInput(createContext(), {
        kind,
        payload:
          kind === "message.failed"
            ? { error: { code: "runtime.failed", message: "Runtime failed." } }
            : kind === "message.added" || kind === "message.delta"
              ? { content: "text" }
              : {},
      }),
    ).toMatchObject({
      rejection: { code: "malformed_event", kind },
      status: "rejected",
    });
  });

  test.each(["thought.cancelled", "thought.completed", "thought.delta", "thought.started"])(
    "rejects %s without thoughtId",
    (kind) => {
      expect(
        ingestRuntimeEventInput(createContext(), {
          kind,
          payload: kind === "thought.delta" ? { content: "text" } : {},
        }),
      ).toMatchObject({
        rejection: { code: "malformed_event", kind },
        status: "rejected",
      });
    },
  );

  test.each([
    {},
    { error: { code: "runtime.failed", message: "Runtime failed." } },
    { messageId: "message-1" },
    { error: { code: "runtime.failed" }, messageId: "message-1" },
    { error: { message: "Runtime failed." }, messageId: "message-1" },
  ])("rejects malformed message.failed payload %#", (payload) => {
    expect(
      ingestRuntimeEventInput(createContext(), {
        kind: "message.failed",
        payload,
      }),
    ).toMatchObject({
      rejection: {
        code: "malformed_event",
        kind: "message.failed",
      },
      status: "rejected",
    });
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

  test.each([
    ["run.completed", { status: "running" }],
    [
      "run.failed",
      {
        error: { code: "failed", message: "failed", retryable: false },
        recoverable: false,
        status: "running",
      },
    ],
    ["run.started", { startedAt: OCCURRED_AT, status: "completed" }],
    ["run.queued", { status: "failed" }],
  ] as const)("rejects a status owned by another run event kind for %s", (kind, payload) => {
    expect(ingestRuntimeEventInput(createContext(), { kind, payload })).toMatchObject({
      rejection: { code: "malformed_event", kind },
      status: "rejected",
    });
  });

  test.each([
    ["run.completed", { status: "completed" }],
    [
      "run.failed",
      {
        error: { code: "failed", message: "failed", retryable: false },
        recoverable: false,
        status: "failed",
      },
    ],
    ["run.started", { startedAt: OCCURRED_AT, status: "running" }],
    ["run.queued", { status: "queued" }],
  ] as const)("accepts the canonical top-level status for %s", (kind, payload) => {
    expect(ingestRuntimeEventInput(createContext(), { kind, payload })).toMatchObject({
      event: { kind },
      status: "accepted",
    });
  });

  test.each([
    [false, false, "accepted"],
    [true, true, "accepted"],
    [false, true, "rejected"],
    [true, false, "rejected"],
  ] as const)(
    "requires run.failed recoverable=%s to match error.retryable=%s",
    (recoverable, retryable, status) => {
      expect(
        ingestRuntimeEventInput(createContext(), {
          kind: "run.failed",
          payload: {
            error: { code: "runtime.failed", message: "Runtime failed.", retryable },
            recoverable,
          },
        }).status,
      ).toBe(status);
    },
  );

  test("owns the completed-run final message reference schema at the Mosoo ingress", () => {
    expect(
      ingestRuntimeEventInput(createContext(), {
        kind: "run.completed",
        payload: { finalMessageId: "message-1", stopReason: "end_turn" },
      }).status,
    ).toBe("accepted");
    expect(
      ingestRuntimeEventInput(createContext(), {
        kind: "run.completed",
        payload: { stopReason: "end_turn" },
      }).status,
    ).toBe("accepted");

    for (const payload of [
      { finalMessageId: "" },
      { finalMessageId: null },
      { finalMessageId: 1 },
      { finalMessageId: "message-1", finalMessageText: "answer" },
      { finalMessageText: "answer" },
    ]) {
      expect(
        ingestRuntimeEventInput(createContext(), { kind: "run.completed", payload }),
      ).toMatchObject({
        rejection: { code: "malformed_event", kind: "run.completed" },
        status: "rejected",
      });
    }
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

  test("admits strict bounded agent task snapshots", () => {
    const outcome = ingestRuntimeEventInput(
      {
        ...createContext(),
        driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      },
      {
        kind: "agent.tasks.replaced",
        payload: {
          tasks: [
            {
              taskId: "🦄".repeat(64),
              taskType: "review",
              title: "Review the repository",
            },
          ],
        },
      },
    );

    expect(outcome).toMatchObject({
      event: {
        delivery: "lossless",
        driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
        kind: "agent.tasks.replaced",
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        visibility: "participant",
      },
      status: "accepted",
    });
  });

  test.each([
    ["missing driver", { tasks: [] }, { driverInstanceId: undefined }],
    [
      "too many tasks",
      { tasks: Array.from({ length: 257 }, (_, index) => ({ taskId: `${index}` })) },
      {},
    ],
    ["duplicate IDs", { tasks: [{ taskId: "same" }, { taskId: "same" }] }, {}],
    ["oversized ID", { tasks: [{ taskId: "🦄".repeat(65) }] }, {}],
    ["empty metadata", { tasks: [{ taskId: "task-1", title: "" }] }, {}],
    ["oversized metadata", { tasks: [{ taskId: "task-1", title: "x".repeat(4097) }] }, {}],
    ["unknown payload field", { extra: true, tasks: [] }, {}],
    ["unknown task field", { tasks: [{ extra: true, taskId: "task-1" }] }, {}],
    [
      "oversized aggregate",
      {
        tasks: Array.from({ length: 256 }, (_, index) => ({
          taskId: `${index}`,
          taskType: "x".repeat(4096),
          title: "x".repeat(4096),
        })),
      },
      {},
    ],
  ])("rejects %s in agent task snapshots", (_label, payload, contextOverrides) => {
    const outcome = ingestRuntimeEventInput(
      {
        ...createContext(),
        driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
        ...contextOverrides,
      },
      {
        kind: "agent.tasks.replaced",
        payload,
      },
    );

    expect(outcome).toMatchObject({
      rejection: {
        code: "malformed_event",
        kind: "agent.tasks.replaced",
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

  test("admits Driver Contract v3 timing payloads with ISO timestamps", () => {
    const event = first(
      toRuntimeEventInput(createContext(), {
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

    if (!isRuntimeEventRecord(event.payload)) {
      throw new Error("Expected a runtime timing payload.");
    }

    expect(event.payload).toMatchObject({
      completedAtMs: 1_100,
      startedAtMs: 1_000,
      totalMs: 100,
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
      schemaVersion: "2026-08-29",
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

  test("hashes replay semantics independently of transport metadata and object key order", async () => {
    const firstEvent = createRuntimeEvent({
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      id: createPlatformId(),
      kind: "diagnostic.reported",
      occurredAt: "2026-08-29T00:00:00.000Z",
      payload: { nested: { a: 1, b: 2 }, z: true },
      runtimeId: "runtime-1",
      sessionId: PLATFORM_ID_FIXTURES.session,
      sourceEventId: "source-1",
    });
    const replay = createRuntimeEvent({
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      id: createPlatformId(),
      kind: "diagnostic.reported",
      occurredAt: "2026-08-30T00:00:00.000Z",
      payload: { z: true, nested: { b: 2, a: 1 } },
      runtimeId: "runtime-1",
      sessionId: PLATFORM_ID_FIXTURES.session,
      sourceEventId: "source-1",
    });
    const changedRuntime = { ...replay, runtimeId: "runtime-2" };

    expect(await createRuntimeEventSemanticHash(firstEvent)).toBe(
      await createRuntimeEventSemanticHash(replay),
    );
    expect(await createRuntimeEventSemanticHash(firstEvent)).not.toBe(
      await createRuntimeEventSemanticHash(changedRuntime),
    );
  });
});
