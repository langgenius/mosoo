import { beforeEach, describe, expect, mock, test } from "bun:test";

const prepareRunCalls: string[] = [];
const dispatchTurnCalls: string[] = [];
const cleanupCalls: string[] = [];
let prepareRunFailures: Error[] = [];
let dispatchTurnFailures: Error[] = [];
let nextDriverIndex = 0;

void mock.module(
  "../src/modules/runtime/infrastructure/execution-plane/sandbox-execution-plane-adapter",
  () => ({
    createSandboxExecutionPlaneAdapter: () => ({
      dispatchTurn: async (_bindings: unknown, input: { driverInstanceId: string }) => {
        const failure = dispatchTurnFailures.shift();
        if (failure) {
          throw failure;
        }
        dispatchTurnCalls.push(input.driverInstanceId);
      },
      prepareRun: async () => {
        const failure = prepareRunFailures.shift();
        if (failure) {
          throw failure;
        }
        nextDriverIndex += 1;
        const driverInstanceId = `driver-${nextDriverIndex}`;
        prepareRunCalls.push(driverInstanceId);
        return {
          driverInstanceId,
          release: () => undefined,
          timing: { path: "cold", phases: [] },
        };
      },
    }),
  }),
);

void mock.module(
  "../src/modules/runtime/application/session-runs/session-run-state.repository",
  () => ({
    SessionRunNoLongerActiveError: class SessionRunNoLongerActiveError extends Error {},
    acquireSessionRunDispatch: async () => ({
      id: "run-1",
      status: "booting",
    }),
    ensureSessionRunIsActive: async () => undefined,
    getSessionRunState: async () => ({ driverInstanceId: null, status: "booting" }),
    updateSessionRunStatusIfActive: async () => ({ id: "run-1", status: "failed" }),
  }),
);

void mock.module(
  "../src/modules/runtime/application/session-runs/session-run-skill-snapshot.repository",
  () => ({
    persistSessionRunSkills: async () => undefined,
  }),
);

void mock.module("../src/modules/sessions/application/session-event-write.service", () => ({
  appendOneSessionRuntimeEventPerSession: async () => ({ appended: [] }),
  appendSessionRuntimeEvents: async () => undefined,
  createSessionRuntimeEvent: (input: Record<string, unknown>) => input,
}));

void mock.module(
  "../src/modules/runtime/application/session-runs/session-run-view-events.service",
  () => ({
    createFailedSessionRunRuntimeEvent: (input: Record<string, unknown>) => input,
    createSessionRunUpdatedEvent: (run: unknown, sessionId: unknown) => ({ run, sessionId }),
  }),
);

void mock.module("../src/modules/runtime/application/session-runs/session-runtime-timing", () => ({
  appendSessionRuntimeTimingEventBestEffort: async () => undefined,
  createRuntimeTimingRecorder: () => ({
    addPhase: () => undefined,
    measure: async <T>(_name: string, fn: () => Promise<T>) => fn(),
    snapshot: () => ({ path: "cold", phases: [] }),
  }),
}));

void mock.module(
  "../src/modules/runtime/application/session-runs/dispatch-run-cleanup.service",
  () => ({
    cleanupDispatchedDriver: async (_bindings: unknown, input: { driverInstanceId: string }) => {
      cleanupCalls.push(input.driverInstanceId);
    },
  }),
);

const { dispatchSessionRun } =
  await import("../src/modules/runtime/application/session-runs/dispatch-run.service");

function dispatchInput() {
  return {
    attachmentIds: [],
    builtInTools: [],
    profile: {
      configRevision: { agentId: "01J00000000000000000000009" },
      runtimeId: "acp-fallback",
      sandbox: { id: "sandbox-1" },
    },
    prompt: "hello",
    resolvedMcpServers: [],
    resolvedSkillCatalog: [],
    resolvedSkills: [],
    sessionId: "session-1",
    sessionRunId: "run-1",
    traceId: "trace-1",
  } as never;
}

function closedBeforeReadyError(): Error {
  return new Error("Driver instance driver-x closed before ready.");
}

beforeEach(() => {
  prepareRunCalls.length = 0;
  dispatchTurnCalls.length = 0;
  cleanupCalls.length = 0;
  prepareRunFailures = [];
  dispatchTurnFailures = [];
  nextDriverIndex = 0;
});

describe("dispatchSessionRun pre-ready retry", () => {
  test("retries once with a fresh driver when prepareRun dies before ready", async () => {
    prepareRunFailures = [closedBeforeReadyError()];

    await dispatchSessionRun({ DB: {} } as never, "https://example.test", dispatchInput());

    expect(prepareRunCalls).toEqual(["driver-1"]);
    expect(dispatchTurnCalls).toEqual(["driver-1"]);
  });

  test("retries once when dispatchTurn hits a driver that closed before ready", async () => {
    dispatchTurnFailures = [closedBeforeReadyError()];

    await dispatchSessionRun({ DB: {} } as never, "https://example.test", dispatchInput());

    expect(prepareRunCalls).toEqual(["driver-1", "driver-2"]);
    expect(cleanupCalls).toEqual(["driver-1"]);
    expect(dispatchTurnCalls).toEqual(["driver-2"]);
  });

  test("gives up after the retry budget and fails the run", async () => {
    prepareRunFailures = [closedBeforeReadyError(), closedBeforeReadyError()];

    await expect(
      dispatchSessionRun({ DB: {} } as never, "https://example.test", dispatchInput()),
    ).rejects.toThrow("closed before ready");

    expect(dispatchTurnCalls).toEqual([]);
  });

  test("does not retry other provisioning errors", async () => {
    prepareRunFailures = [new Error("Runtime subject is busy with lifecycle maintenance.")];

    await expect(
      dispatchSessionRun({ DB: {} } as never, "https://example.test", dispatchInput()),
    ).rejects.toThrow("busy with lifecycle maintenance");

    expect(prepareRunCalls).toEqual([]);
    expect(dispatchTurnCalls).toEqual([]);
  });
});
