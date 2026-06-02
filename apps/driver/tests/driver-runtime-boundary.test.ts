import { describe, expect, test } from "bun:test";

import { createPromiseDeferred } from "@mosoo/effects";

import { DriverRuntimeStateMachine } from "../src/core/driver-runtime-state";
import { createDriverRuntimeTimingEvent } from "../src/core/driver-runtime-timing";
import { toDriverEventEnvelopes } from "../src/infrastructure/runtime/driver-instance-socket";
import {
  DRIVER_TEST_IDS,
  FakeDriverInstanceSocket,
  accessSnapshot,
  bootPayload,
  createBackend,
  createDispatcher,
  waitForUpdate,
} from "./driver-runtime-boundary-fixtures";

describe("driver runtime boundary", () => {
  test("runtime timing events carry the completed timestamp", () => {
    const event = createDriverRuntimeTimingEvent({
      completedAtMs: 1_050,
      path: "warm",
      phases: [],
      runId: DRIVER_TEST_IDS.runId,
      sessionId: DRIVER_TEST_IDS.sessionId,
      stage: "driver_turn",
      startedAtMs: 1_000,
      traceId: "trace-1",
    });

    expect(event).toMatchObject({
      kind: "runtime.timing.recorded",
      occurredAt: new Date(1_050).toISOString(),
      payload: {
        completedAtMs: 1_050,
      },
    });
  });

  test("driver socket stamps warm turn events with the active run id", () => {
    const [event] = toDriverEventEnvelopes(
      bootPayload,
      {
        kind: "run.started",
        payload: {
          startedAt: new Date(1_000).toISOString(),
        },
        runId: "sdk-internal-run",
      },
      DRIVER_TEST_IDS.secondRunId,
    );

    expect(event?.event.runId).toBe(DRIVER_TEST_IDS.secondRunId);
  });

  test("driver socket rejects provider turn ids outside an active platform run", () => {
    expect(() =>
      toDriverEventEnvelopes(
        bootPayload,
        {
          kind: "run.started",
          payload: {
            startedAt: new Date(1_000).toISOString(),
          },
          runId: "provider-turn-1",
        },
        null,
      ),
    ).toThrow("Session run ID must be a valid ULID.");
  });

  test("driver socket preserves explicit event run ids outside active turns", () => {
    const [event] = toDriverEventEnvelopes(
      bootPayload,
      {
        kind: "run.started",
        payload: {
          startedAt: new Date(1_000).toISOString(),
        },
        runId: DRIVER_TEST_IDS.thirdRunId,
      },
      null,
    );

    expect(event?.event.runId).toBe(DRIVER_TEST_IDS.thirdRunId);
  });

  test("runs input commands through the backend and reports completion to API", async () => {
    const backend = createBackend();
    const runtimeState = new DriverRuntimeStateMachine();
    const socket = new FakeDriverInstanceSocket([
      {
        commandId: "input-1",
        input: {
          attachmentIds: ["file-1"],
          text: "hello",
        },
        kind: "input.start",
        organizationAccessSnapshot: accessSnapshot,
        requestId: "request-1",
        runId: DRIVER_TEST_IDS.runId,
      },
    ]);
    const { dispatcher, logger } = createDispatcher({
      backend,
      isShuttingDown: () => socket.isDrained(),
      runtimeState,
    });

    await dispatcher.run(socket, logger);
    await waitForUpdate(
      socket,
      (update) => update.commandId === "input-1" && update.status === "completed",
    );
    await logger.destroy();

    expect(runtimeState.status()).toBe("ready");
    expect(backend.refreshedSnapshots).toEqual([accessSnapshot]);
    expect(socket.updates).toEqual([
      {
        commandId: "input-1",
        status: "accepted",
      },
      {
        commandId: "input-1",
        result: {
          requestId: "request-1",
        },
        status: "completed",
      },
    ]);
  });

  test("lets a queued input wait for the previous turn command to settle", async () => {
    const firstInputStarted = createPromiseDeferred<void>();
    const firstInputCanFinish = createPromiseDeferred<void>();
    const backend = createBackend();
    let handledInputCount = 0;
    backend.handleInput = async (context) => {
      handledInputCount += 1;
      backend.handledInputs.push(context.payload.execution.session);

      if (handledInputCount === 1) {
        firstInputStarted.resolve();
        await firstInputCanFinish.promise;
      }
    };
    const runtimeState = new DriverRuntimeStateMachine();
    const socket = new FakeDriverInstanceSocket([
      {
        commandId: "input-1",
        input: {
          text: "first",
        },
        kind: "input.start",
        requestId: "request-1",
        runId: DRIVER_TEST_IDS.runId,
      },
      {
        commandId: "input-2",
        input: {
          text: "second",
        },
        kind: "input.start",
        requestId: "request-2",
        runId: DRIVER_TEST_IDS.secondRunId,
      },
    ]);
    const { dispatcher, logger } = createDispatcher({
      backend,
      isShuttingDown: () => socket.isDrained(),
      runtimeState,
    });
    const runTask = dispatcher.run(socket, logger);

    await firstInputStarted.promise;
    await waitForUpdate(
      socket,
      (update) => update.commandId === "input-1" && update.status === "accepted",
    );
    firstInputCanFinish.resolve();
    await runTask;
    await logger.destroy();

    expect(handledInputCount).toBe(2);
    expect(runtimeState.status()).toBe("ready");
    expect(socket.failedRuns).toEqual([]);
    expect(socket.updates).toEqual([
      {
        commandId: "input-1",
        status: "accepted",
      },
      {
        commandId: "input-2",
        status: "accepted",
      },
      {
        commandId: "input-1",
        result: {
          requestId: "request-1",
        },
        status: "completed",
      },
      {
        commandId: "input-2",
        result: {
          requestId: "request-2",
        },
        status: "completed",
      },
    ]);
  });

  test("keeps non-turn commands explicit at the API boundary", async () => {
    const backend = createBackend();
    const runtimeState = new DriverRuntimeStateMachine();
    const socket = new FakeDriverInstanceSocket([
      {
        commandId: "access-1",
        kind: "access.refresh",
        organizationAccessSnapshot: accessSnapshot,
      },
      {
        argumentsJson: '{"issue":"A-1"}',
        commandId: "mcp-1",
        kind: "mcp.execute",
        requestId: "mcp-request-1",
        serverId: "mcp-linear",
        toolName: "createIssue",
      },
    ]);
    const { dispatcher, logger } = createDispatcher({
      backend,
      isShuttingDown: () => socket.isDrained(),
      runtimeState,
    });

    await dispatcher.run(socket, logger);
    await logger.destroy();

    expect(runtimeState.status()).toBe("ready");
    expect(backend.refreshedSnapshots).toEqual([accessSnapshot]);
    expect(socket.updates).toEqual([
      {
        commandId: "access-1",
        status: "accepted",
      },
      {
        commandId: "access-1",
        result: {
          entryCount: 1,
        },
        status: "completed",
      },
      {
        commandId: "mcp-1",
        status: "accepted",
      },
      {
        commandId: "mcp-1",
        result: {
          outputText: "ran createIssue",
          requestId: "mcp-request-1",
          serverId: "mcp-linear",
          toolName: "createIssue",
        },
        status: "completed",
      },
    ]);
  });

  test("fails the run and shuts down when the backend rejects a turn", async () => {
    const backend = createBackend();
    backend.failInput = true;
    const runtimeState = new DriverRuntimeStateMachine();
    const socket = new FakeDriverInstanceSocket([
      {
        commandId: "input-1",
        input: {
          text: "hello",
        },
        kind: "input.start",
        requestId: "request-1",
        runId: DRIVER_TEST_IDS.runId,
      },
    ]);
    const { dispatcher, logger, shutdownCalls } = createDispatcher({
      backend,
      isShuttingDown: () => socket.isDrained(),
      runtimeState,
    });

    await dispatcher.run(socket, logger);
    await waitForUpdate(
      socket,
      (update) => update.commandId === "input-1" && update.status === "failed",
    );
    await logger.destroy();

    expect(runtimeState.status()).toBe("failed");
    expect(socket.failedRuns).toHaveLength(1);
    expect(socket.failedRuns[0]).toMatchObject({
      details: {
        commandId: "input-1",
        commandKind: "input.start",
      },
      retryable: false,
    });
    expect(shutdownCalls).toHaveLength(1);
  });

  test("cancels a turn that is still refreshing access", async () => {
    const refreshStarted = createPromiseDeferred<void>();
    const refreshCanFinish = createPromiseDeferred<void>();
    const backend = createBackend();
    backend.refreshOrganizationAccess = async (_context, snapshot) => {
      backend.refreshedSnapshots.push(snapshot);
      refreshStarted.resolve();
      await refreshCanFinish.promise;
    };
    const runtimeState = new DriverRuntimeStateMachine();
    const socket = new FakeDriverInstanceSocket([
      {
        commandId: "input-1",
        input: {
          text: "hello",
        },
        kind: "input.start",
        organizationAccessSnapshot: accessSnapshot,
        requestId: "request-1",
        runId: DRIVER_TEST_IDS.runId,
      },
      {
        commandId: "cancel-1",
        kind: "turn.cancel",
        reason: "viewer.cancelled",
      },
    ]);
    const { dispatcher, logger } = createDispatcher({
      backend,
      isShuttingDown: () => socket.isDrained(),
      runtimeState,
    });
    const runTask = dispatcher.run(socket, logger);

    await refreshStarted.promise;
    await waitForUpdate(
      socket,
      (update) => update.commandId === "cancel-1" && update.status === "completed",
    );
    refreshCanFinish.resolve();
    await waitForUpdate(
      socket,
      (update) => update.commandId === "input-1" && update.status === "cancelled",
    );
    await runTask;
    await logger.destroy();

    expect(backend.cancelledReasons).toEqual(["viewer.cancelled"]);
    expect(backend.handledInputs).toEqual([]);
    expect(runtimeState.status()).toBe("ready");
  });

  test("stops sessions as terminal commands and reports run completion", async () => {
    const backend = createBackend();
    const runtimeState = new DriverRuntimeStateMachine();
    const socket = new FakeDriverInstanceSocket([
      {
        commandId: "stop-1",
        kind: "session.stop",
        reason: "viewer.closed",
      },
    ]);
    const { dispatcher, logger, shutdownCalls } = createDispatcher({
      backend,
      isShuttingDown: () => socket.isDrained(),
      runtimeState,
    });

    await dispatcher.run(socket, logger);
    await logger.destroy();

    expect(runtimeState.status()).toBe("stopped");
    expect(socket.completedRunReasons).toEqual(["completed"]);
    expect(shutdownCalls).toHaveLength(1);
    expect(socket.updates).toEqual([
      {
        commandId: "stop-1",
        status: "accepted",
      },
      {
        commandId: "stop-1",
        status: "completed",
      },
    ]);
  });
});
