import { describe, expect, test } from "bun:test";

import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import { finalizeDriverInstance } from "../src/modules/runtime/infrastructure/driver-instance/lifecycle";
import type { RuntimeSessionViewCache } from "../src/modules/runtime/infrastructure/driver-instance/runtime-session-view-cache";
import { DriverInstanceRuntimeState } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state";
import { DRIVER_INSTANCE_STATE_STORAGE_KEY } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state-store";
import type { DriverInstanceStoredState } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state-store";
import type { SessionViewerEventDeliveryBuffer } from "../src/modules/runtime/infrastructure/driver-instance/session-viewer-event-delivery-buffer";
import type { repairFinalizedTerminalDriverRunState } from "../src/modules/runtime/infrastructure/driver-instance/terminal-run-release";
import { DriverInstanceTerminalStateCoordinator } from "../src/modules/runtime/infrastructure/driver-instance/terminal-state-coordinator";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_INSTANCE_ID = PLATFORM_ID_FIXTURES.driverInstance;
const TERMINAL_REPAIR_RESULT = { link: null, released: false } as const;

class MemoryDriverInstanceStorage {
  cleanupWriteFailures = 0;
  readonly values = new Map<string, unknown>();

  async deleteAll(): Promise<void> {
    this.values.clear();
  }

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    if (
      this.cleanupWriteFailures > 0 &&
      typeof value === "object" &&
      value !== null &&
      "terminalCleanupComplete" in value &&
      value.terminalCleanupComplete === true
    ) {
      this.cleanupWriteFailures -= 1;
      throw new Error("terminal snapshot write failed");
    }

    this.values.set(key, structuredClone(value));
  }

  storedState(): DriverInstanceStoredState {
    const value = this.values.get(DRIVER_INSTANCE_STATE_STORAGE_KEY);

    if (value === undefined) {
      throw new Error("Driver instance state was not persisted.");
    }

    return value as DriverInstanceStoredState;
  }
}

type FinalizeDriver = typeof finalizeDriverInstance;
type RepairFinalizedRunState = typeof repairFinalizedTerminalDriverRunState;

async function createConnectedState(
  storage: MemoryDriverInstanceStorage,
): Promise<DriverInstanceRuntimeState> {
  const state = new DriverInstanceRuntimeState({ storage });
  await state.load();

  if (state.driverInstanceId === null) {
    await state.initializeDriverInstance(DRIVER_INSTANCE_ID, 1);
    await state.recordAcceptedConnection({
      connectedAt: 1,
      connectionId: "connection-1",
      driverGeneration: 1,
      traceId: null,
    });
  }

  state.setRuntimeSessionLink({
    agentId: null,
    appId: null,
    callerId: null,
    creatorId: null,
    executionOwnerId: null,
    sandboxId: null,
    sandboxKind: null,
    sandboxSubjectKind: null,
    runtimeId: null,
    sessionId: PLATFORM_ID_FIXTURES.session,
    sessionRunId: PLATFORM_ID_FIXTURES.sessionRun,
    sessionRunStatus: "running",
    sessionType: null,
    traceId: null,
  });

  return state;
}

function createCoordinator(
  storage: MemoryDriverInstanceStorage,
  state: DriverInstanceRuntimeState,
  input: {
    finalizeDriver: FinalizeDriver;
    flush?: () => Promise<void>;
    repairFinalizedRunState: RepairFinalizedRunState;
    requestStateSync?: (sessionId: string | null) => void;
  },
): DriverInstanceTerminalStateCoordinator {
  return new DriverInstanceTerminalStateCoordinator({
    clearStorage: async () => storage.deleteAll(),
    env: {} as ApiBindings,
    finalizeDriver: input.finalizeDriver,
    repairFinalizedRunState: input.repairFinalizedRunState,
    state,
    viewCache: { reset: () => {} } as unknown as RuntimeSessionViewCache,
    viewerEventDelivery: {
      flush: input.flush ?? (async () => {}),
      requestStateSync: input.requestStateSync ?? (() => {}),
      resetAfterFlush: () => {},
    } as unknown as SessionViewerEventDeliveryBuffer,
    withRuntimeLogContext: (fn) => fn(),
  });
}

function createDriverInstanceDatabase(status: "failed" | "ready"): SqliteD1Database {
  const database = new SqliteD1Database();
  database.execute(`
    CREATE TABLE driver_instance (
      close_code integer,
      close_reason text,
      connection_id text,
      driver_pid integer,
      driver_started_at integer,
      error_message text,
      expires_at integer NOT NULL,
      generation integer NOT NULL,
      heartbeat_count integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      last_heartbeat_at integer,
      status text NOT NULL,
      status_changed_at integer NOT NULL,
      status_event text NOT NULL,
      status_seq integer NOT NULL,
      status_source text NOT NULL,
      updated_at integer NOT NULL
    );
    INSERT INTO driver_instance (
      connection_id, expires_at, generation, heartbeat_count, id, status,
      status_changed_at, status_event, status_seq, status_source, updated_at
    ) VALUES (
      'connection-1', 1, 1, 0, '${DRIVER_INSTANCE_ID}', '${status}',
      1, 'driver.${status}', 1, 'driver', 1
    );
  `);
  return database;
}

describe("driver terminal state coordinator", () => {
  test("joins concurrent finalization callers onto one in-flight transition", async () => {
    const storage = new MemoryDriverInstanceStorage();
    const state = await createConnectedState(storage);
    let finalizeCalls = 0;
    let markStarted: () => void = () => {};
    let releaseFinalization: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const finalizationGate = new Promise<void>((resolve) => {
      releaseFinalization = resolve;
    });
    const coordinator = createCoordinator(storage, state, {
      finalizeDriver: async () => {
        finalizeCalls += 1;
        markStarted();
        await finalizationGate;
        return "stopped";
      },
      repairFinalizedRunState: async () => TERMINAL_REPAIR_RESULT,
    });

    const epoch = state.requireConnectionEpoch();
    const first = coordinator.finalize(epoch);
    const second = coordinator.finalize(epoch);
    await started;

    expect(finalizeCalls).toBe(1);
    releaseFinalization();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(state.terminalCleanupComplete).toBe(true);
  });

  test("an old finalizer cannot settle a successor connection after its await", async () => {
    const storage = new MemoryDriverInstanceStorage();
    const state = await createConnectedState(storage);
    const oldEpoch = state.requireConnectionEpoch();
    let markStarted: () => void = () => {};
    let resume: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let repairCalls = 0;
    const coordinator = createCoordinator(storage, state, {
      finalizeDriver: async () => {
        markStarted();
        await gate;
        return "stopped";
      },
      repairFinalizedRunState: async () => {
        repairCalls += 1;
        return TERMINAL_REPAIR_RESULT;
      },
    });

    const oldFinalizer = coordinator.finalize(oldEpoch);
    await started;
    state.connectionId = "connection-2";
    state.close = null;
    state.terminalized = false;
    const successorWait = state.waitForReady(1, 10_000).catch((error: unknown) => error);
    resume();
    await oldFinalizer;

    expect(repairCalls).toBe(0);
    expect(state.connectionId).toBe("connection-2");
    expect(state.close).toBeNull();
    expect(state.terminalCleanupComplete).toBe(false);
    expect(state.readyWaiters).toHaveLength(1);
    state.resetAfterDestroy("test cleanup");
    await successorWait;
  });

  test("retries driver finalization in the same object after close intent is durable", async () => {
    const storage = new MemoryDriverInstanceStorage();
    const state = await createConnectedState(storage);
    let finalizeCalls = 0;
    let repairCalls = 0;
    const coordinator = createCoordinator(storage, state, {
      finalizeDriver: async () => {
        finalizeCalls += 1;

        if (finalizeCalls === 1) {
          throw new Error("driver finalization failed");
        }

        return "stopped";
      },
      repairFinalizedRunState: async () => {
        repairCalls += 1;
        return TERMINAL_REPAIR_RESULT;
      },
    });

    const epoch = state.requireConnectionEpoch();
    await expect(coordinator.finalize(epoch)).rejects.toThrow("driver finalization failed");
    expect(state.close).not.toBeNull();
    expect(state.terminalized).toBe(true);
    expect(state.terminalCleanupComplete).toBe(false);

    await expect(coordinator.finalize(epoch)).resolves.toBeUndefined();
    expect(finalizeCalls).toBe(2);
    expect(repairCalls).toBe(1);
    expect(state.terminalCleanupComplete).toBe(true);
  });

  test("finalizes without waiting for derived viewer event delivery", async () => {
    const storage = new MemoryDriverInstanceStorage();
    const state = await createConnectedState(storage);
    let flushCalls = 0;
    let finalizeCalls = 0;
    const syncSessionIds: Array<string | null> = [];
    const coordinator = createCoordinator(storage, state, {
      finalizeDriver: async () => {
        finalizeCalls += 1;
        return "stopped";
      },
      flush: async () => {
        flushCalls += 1;
      },
      repairFinalizedRunState: async () => TERMINAL_REPAIR_RESULT,
      requestStateSync: (sessionId) => syncSessionIds.push(sessionId),
    });

    await expect(coordinator.finalize(state.requireConnectionEpoch())).resolves.toBeUndefined();
    expect(flushCalls).toBe(0);
    expect(finalizeCalls).toBe(1);
    expect(syncSessionIds).toEqual([PLATFORM_ID_FIXTURES.session]);
    expect(state.terminalCleanupComplete).toBe(true);
  });

  test("restarts repair after the terminal driver CAS was already committed", async () => {
    const storage = new MemoryDriverInstanceStorage();
    const firstState = await createConnectedState(storage);
    let casCommitted = false;
    let casWrites = 0;
    let finalizeCalls = 0;
    let repairCalls = 0;
    const finalizeDriver: FinalizeDriver = async () => {
      finalizeCalls += 1;

      if (!casCommitted) {
        casCommitted = true;
        casWrites += 1;
      }

      return "stopped";
    };
    const repairFinalizedRunState: RepairFinalizedRunState = async () => {
      repairCalls += 1;

      if (repairCalls === 1) {
        throw new Error("run repair failed");
      }

      return TERMINAL_REPAIR_RESULT;
    };
    const firstCoordinator = createCoordinator(storage, firstState, {
      finalizeDriver,
      repairFinalizedRunState,
    });

    await expect(firstCoordinator.finalize(firstState.requireConnectionEpoch())).rejects.toThrow(
      "run repair failed",
    );
    expect(firstState.terminalCleanupComplete).toBe(false);
    expect(casWrites).toBe(1);

    const restartedState = await createConnectedState(storage);
    expect(restartedState.terminalized).toBe(true);
    expect(restartedState.terminalCleanupComplete).toBe(false);
    await expect(
      createCoordinator(storage, restartedState, {
        finalizeDriver,
        repairFinalizedRunState,
      }).finalize(restartedState.requireConnectionEpoch()),
    ).resolves.toBeUndefined();

    expect(casWrites).toBe(1);
    expect(finalizeCalls).toBe(2);
    expect(repairCalls).toBe(2);
    expect(storage.storedState().terminalCleanupComplete).toBe(true);

    const completedState = await createConnectedState(storage);
    await expect(
      createCoordinator(storage, completedState, {
        finalizeDriver: async () => {
          throw new Error("completed finalization must not run again");
        },
        repairFinalizedRunState,
      }).finalize(completedState.requireConnectionEpoch()),
    ).resolves.toBeUndefined();
  });

  test("restarts after terminal snapshot persistence fails without duplicating side effects", async () => {
    const storage = new MemoryDriverInstanceStorage();
    const firstState = await createConnectedState(storage);
    storage.cleanupWriteFailures = 1;
    let finalizeCalls = 0;
    let finalizeWrites = 0;
    let finalized = false;
    let repairCalls = 0;
    let repairWrites = 0;
    let repaired = false;
    const finalizeDriver: FinalizeDriver = async () => {
      finalizeCalls += 1;

      if (!finalized) {
        finalized = true;
        finalizeWrites += 1;
      }

      return "stopped";
    };
    const repairFinalizedRunState: RepairFinalizedRunState = async () => {
      repairCalls += 1;

      if (!repaired) {
        repaired = true;
        repairWrites += 1;
      }

      return TERMINAL_REPAIR_RESULT;
    };
    const firstCoordinator = createCoordinator(storage, firstState, {
      finalizeDriver,
      repairFinalizedRunState,
    });

    await expect(firstCoordinator.finalize(firstState.requireConnectionEpoch())).rejects.toThrow(
      "terminal snapshot write failed",
    );
    expect(firstState.terminalCleanupComplete).toBe(false);
    expect(storage.storedState().terminalCleanupComplete).toBe(false);

    const restartedState = await createConnectedState(storage);
    await expect(
      createCoordinator(storage, restartedState, {
        finalizeDriver,
        repairFinalizedRunState,
      }).finalize(restartedState.requireConnectionEpoch()),
    ).resolves.toBeUndefined();

    expect(finalizeCalls).toBe(2);
    expect(finalizeWrites).toBe(1);
    expect(repairCalls).toBe(2);
    expect(repairWrites).toBe(1);
    expect(restartedState.terminalCleanupComplete).toBe(true);
  });

  test("repairs the canonical failed state when maintenance wins a clean-close race", async () => {
    const storage = new MemoryDriverInstanceStorage();
    const state = await createConnectedState(storage);
    let repairedStatus: "failed" | "stopped" | null = null;
    const coordinator = createCoordinator(storage, state, {
      finalizeDriver: async () => "failed",
      repairFinalizedRunState: async (_bindings, input) => {
        repairedStatus = input.status;
        return TERMINAL_REPAIR_RESULT;
      },
    });

    await coordinator.finalize(state.requireConnectionEpoch());

    expect(state.close?.code).toBe(1000);
    expect(repairedStatus).toBe("failed");
    expect(state.terminalCleanupComplete).toBe(true);
  });
});

describe("driver terminal finalization CAS", () => {
  test("recognizes an exact replay without advancing the terminal transition twice", async () => {
    const database = createDriverInstanceDatabase("ready");
    const bindings = { DB: database } as ApiBindings;
    const input = {
      connectionId: "connection-1",
      generation: 1,
      heartbeatCount: 2,
      status: "stopped" as const,
    };

    await expect(finalizeDriverInstance(bindings, DRIVER_INSTANCE_ID, input)).resolves.toBe(
      "stopped",
    );
    await expect(finalizeDriverInstance(bindings, DRIVER_INSTANCE_ID, input)).resolves.toBe(
      "stopped",
    );
    await expect(
      finalizeDriverInstance(bindings, DRIVER_INSTANCE_ID, {
        ...input,
        connectionId: "stale-connection",
      }),
    ).resolves.toBeNull();
    await expect(
      database
        .prepare("SELECT status, status_seq AS statusSeq FROM driver_instance WHERE id = ?")
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ status: "stopped", statusSeq: 2 });
  });

  test("returns a prior canonical failed status for the same connection generation", async () => {
    const database = createDriverInstanceDatabase("failed");
    const bindings = { DB: database } as ApiBindings;

    await expect(
      finalizeDriverInstance(bindings, DRIVER_INSTANCE_ID, {
        connectionId: "connection-1",
        generation: 1,
        heartbeatCount: 2,
        status: "stopped",
      }),
    ).resolves.toBe("failed");
    await expect(
      database
        .prepare("SELECT status, status_seq AS statusSeq FROM driver_instance WHERE id = ?")
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ status: "failed", statusSeq: 1 });
  });
});
