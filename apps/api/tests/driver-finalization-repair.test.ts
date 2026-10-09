import { describe, expect, spyOn, test } from "bun:test";

import type { DriverInstanceId, SessionRunId } from "@mosoo/id";

import { recordCanonicalSessionRunFailure } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import { DriverInstanceRuntimeState } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state";
import type { DriverInstanceRuntimeStateContext } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state-store";
import { DRIVER_INSTANCE_STATE_STORAGE_KEY } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state-store";
import { repairFinalizedTerminalDriverRunState } from "../src/modules/runtime/infrastructure/driver-instance/terminal-run-release";
import { DriverInstanceTerminalStateCoordinator } from "../src/modules/runtime/infrastructure/driver-instance/terminal-state-coordinator";
import { setSessionRunStatus } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const FINALIZE_RUN_ID = "01J0000000000000000000000T" as SessionRunId;
const FINALIZE_CLOUDFLARE_SESSION_ID = "01J0000000000000000000000W";
const TURN_INTERRUPTED_MESSAGE =
  "This turn was interrupted before it completed. Please resend your last request.";
const PROVISION_ERROR = {
  code: "runtime.provision_failed",
  details: {},
  message: "Driver command dispatch failed.",
  retryable: false,
} as const;

interface TerminalEventRow {
  content_text: string;
  event_type: string;
  family: string;
  process_status: string;
  process_type: string;
  run_id: string | null;
  seq: number;
  source: string;
  source_event_id: string;
  trace_id: string | null;
  visibility: string;
}

async function insertFinalizedDriverLeaseFixture(database: SqliteD1Database): Promise<void> {
  await insertOwnerSession(database);
  await database
    .prepare(
      `
        INSERT INTO sandbox (
          id,
          kind,
          subject_kind,
          subject_id,
          status,
          bind_mount_ready,
          global_mounts_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.sandbox,
      "pet",
      "agent",
      PUBLIC_API_TEST_IDS.agent,
      "active",
      1,
      "[]",
      1,
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO sandbox_session (
          cloudflare_session_id,
          created_at,
          cwd,
          origin_json,
          sandbox_id,
          session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      FINALIZE_CLOUDFLARE_SESSION_ID,
      1,
      "/workspace",
      JSON.stringify({
        callerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
        entrypoint: "api",
        executionOwnerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
        type: "agent",
      }),
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      "active",
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          boot_token_expires_at,
          boot_token_hash,
          connection_id,
          created_at,
          expires_at,
          heartbeat_count,
          protocol,
          protocol_version,
          runtime,
          sandbox_id,
          sandbox_session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.driverOwner,
      1,
      new Uint8Array([1]),
      "connection-finalized",
      1,
      1,
      0,
      "orpc-ws",
      1,
      "openai-runtime",
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      "stopped",
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO session_run (
          id,
          session_id,
          agent_id,
          created_by_account_id,
          deployment_version_id,
          deployment_version_number,
          driver_instance_id,
          trigger,
          status,
          provider,
          model,
          runtime_id,
          trace_id,
          started_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      FINALIZE_RUN_ID,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.deployment,
      1,
      PUBLIC_API_TEST_IDS.driverOwner,
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-finalize",
      1,
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
    .bind(FINALIZE_RUN_ID, "RUNNING", PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

async function readTerminalEvents(database: SqliteD1Database): Promise<TerminalEventRow[]> {
  return database
    .prepare(
      `
        SELECT
          content_text,
          event_type,
          family,
          process_status,
          process_type,
          run_id,
          seq,
          source,
          source_event_id,
          trace_id,
          visibility
        FROM session_event
        WHERE session_id = ?
        ORDER BY seq
      `,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .all<TerminalEventRow>()
    .then((result) => result.results ?? []);
}

async function createSocketCloseFinalizationFixture() {
  const database = await createPublicHttpContractDatabase();
  await insertFinalizedDriverLeaseFixture(database);
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const driverInstanceId = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
  await database
    .prepare("UPDATE driver_instance SET status = 'ready' WHERE id = ?")
    .bind(driverInstanceId)
    .run();
  const stored = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage: DriverInstanceRuntimeStateContext["storage"] = {
    async deleteAlarm() {
      alarm = null;
    },
    async setAlarm(at: number) {
      alarm = at;
    },
    async deleteAll() {
      stored.clear();
    },
    async get<T>(key: string) {
      return structuredClone(stored.get(key)) as T | undefined;
    },
    async put(key: string, value: unknown) {
      stored.set(key, structuredClone(value));
    },
  };
  const beforeRestart = new DriverInstanceRuntimeState({ storage });
  await beforeRestart.setDriverInstanceId(driverInstanceId);
  await beforeRestart.recordAcceptedConnection({
    connectionId: "connection-finalized",
    driverGeneration: 0,
    traceId: null,
  });
  await beforeRestart.persistClose({
    at: new Date().toISOString(),
    code: 1006,
    reason: "WebSocket disconnected without sending Close frame.",
  });

  async function restore() {
    const state = new DriverInstanceRuntimeState({ storage });
    await state.load();
    const coordinator = new DriverInstanceTerminalStateCoordinator({
      env: bindings,
      state,
      withRuntimeLogContext: (fn) => fn(),
    });
    return { coordinator, state };
  }
  return { database, driverInstanceId, restore, stored, readAlarm: () => alarm };
}

describe("driver finalization repair", () => {
  test("resumes event and lease cleanup after the terminal Run was already committed", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await setSessionRunStatus(database, {
      error: PROVISION_ERROR,
      runId: FINALIZE_RUN_ID,
      source: "api",
      status: "failed",
    });
    const completedAt = Date.parse("2026-09-21T23:59:59.000Z");
    await database
      .prepare("UPDATE session_run SET completed_at = ?, updated_at = ? WHERE id = ?")
      .bind(completedAt, completedAt, FINALIZE_RUN_ID)
      .run();
    const before = await database
      .prepare("SELECT * FROM session_run WHERE id = ?")
      .bind(FINALIZE_RUN_ID)
      .first();
    expect(await readTerminalEvents(database)).toEqual([]);
    const output: string[] = [];
    const repairStartedAt = Date.now();
    const originalInfo = console.info;
    console.info = (...values: unknown[]) => output.push(values.map(String).join(" "));
    try {
      // Both callers can observe the same missing receipt before either writes it.
      const repair = () =>
        repairFinalizedTerminalDriverRunState(bindings, {
          driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
          status: "stopped",
        });
      const outcomes = await Promise.all([repair(), repair()]);
      expect(outcomes.every((outcome) => outcome.released)).toBe(true);
      const emittedAfterRace = output.length;
      await repair();
      expect(output).toHaveLength(emittedAfterRace);
    } finally {
      console.info = originalInfo;
    }
    const logs = output
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.message === "session.run.terminal");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.length).toBeLessThanOrEqual(2);
    expect(logs.every((entry) => entry.metadata.errorCode === PROVISION_ERROR.code)).toBe(true);
    expect(await readTerminalEvents(database)).toHaveLength(1);
    const eventTime = await database
      .prepare(
        "SELECT occurred_at, ended_at, created_at FROM session_event WHERE run_id = ? AND event_type = 'run.failed'",
      )
      .bind(FINALIZE_RUN_ID)
      .first<{ occurred_at: number; ended_at: number; created_at: number }>();
    expect(eventTime).toMatchObject({ occurred_at: completedAt, ended_at: completedAt });
    expect(eventTime?.created_at).toBeGreaterThanOrEqual(repairStartedAt);
    expect(logs.every((entry) => Date.parse(entry.timestamp) === eventTime?.occurred_at)).toBe(
      true,
    );
    expect(
      await database
        .prepare("SELECT * FROM session_run WHERE id = ?")
        .bind(FINALIZE_RUN_ID)
        .first(),
    ).toEqual(before);
    expect(
      await database
        .prepare("SELECT inactive_deadline_at FROM sandbox WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.sandbox)
        .first(),
      // A released Run is not permission to recycle a still-resident conversation.
    ).toMatchObject({ inactive_deadline_at: null });
  });

  test("repairs a persisted socket close after object reconstruction without replaying the run", async () => {
    const fixture = await createSocketCloseFinalizationFixture();
    const { database, driverInstanceId } = fixture;
    expect(fixture.readAlarm()).not.toBeNull();
    const { coordinator, state } = await fixture.restore();
    expect(state.terminalized).toBe(true);
    expect(state.finalizationCompleted).toBe(false);
    await Promise.all([coordinator.finalize(), coordinator.finalize()]);
    await state.persistClose({ at: new Date().toISOString(), code: 1000, reason: "duplicate" });
    await coordinator.finalize();

    expect(
      await database
        .prepare("SELECT status, close_code, status_seq FROM driver_instance WHERE id = ?")
        .bind(driverInstanceId)
        .first(),
    ).toEqual({ status: "failed", close_code: 1006, status_seq: 1 });
    expect(
      await database.prepare("SELECT id, status FROM session_run ORDER BY id").all(),
    ).toMatchObject({ results: [{ id: FINALIZE_RUN_ID, status: "failed" }] });
    expect(
      (await readTerminalEvents(database)).filter((event) => event.event_type === "run.failed"),
    ).toHaveLength(1);
    expect(fixture.readAlarm()).toBeNull();
    const restored = await fixture.restore();
    expect(restored.state.finalizationCompleted).toBe(true);
    await restored.coordinator.finalize();
    expect(
      (await readTerminalEvents(database)).filter((event) => event.event_type === "run.failed"),
    ).toHaveLength(1);
  });

  test("retries after driver finalization commits but run repair fails", async () => {
    const fixture = await createSocketCloseFinalizationFixture();
    const { database, driverInstanceId } = fixture;
    database.execute(`CREATE TRIGGER fail_run_terminal BEFORE UPDATE OF status ON session_run
      BEGIN SELECT RAISE(ABORT, 'injected run write failure'); END;`);
    const { coordinator, state } = await fixture.restore();
    await expect(coordinator.finalize()).rejects.toThrow();
    expect(state.finalizationCompleted).toBe(false);
    expect(fixture.readAlarm()).not.toBeNull();
    expect(
      await database
        .prepare("SELECT status FROM driver_instance WHERE id = ?")
        .bind(driverInstanceId)
        .first(),
    ).toEqual({ status: "failed" });
    database.execute("DROP TRIGGER fail_run_terminal");
    const restored = await fixture.restore();
    await restored.coordinator.finalize();
    expect(
      await database
        .prepare("SELECT status FROM session_run WHERE id = ?")
        .bind(FINALIZE_RUN_ID)
        .first(),
    ).toEqual({ status: "failed" });
    expect(
      (await readTerminalEvents(database)).filter((event) => event.event_type === "run.failed"),
    ).toHaveLength(1);
    expect(fixture.readAlarm()).toBeNull();
  });

  test("retries a failed driver write in the same object", async () => {
    const fixture = await createSocketCloseFinalizationFixture();
    const { database } = fixture;
    database.execute(`CREATE TRIGGER fail_driver_terminal BEFORE UPDATE OF status ON driver_instance
      BEGIN SELECT RAISE(ABORT, 'injected driver write failure'); END;`);
    const { coordinator } = await fixture.restore();
    await expect(coordinator.finalize()).rejects.toThrow();
    database.execute("DROP TRIGGER fail_driver_terminal");
    await coordinator.finalize();
    expect(
      (await readTerminalEvents(database)).filter((event) => event.event_type === "run.failed"),
    ).toHaveLength(1);
    expect(fixture.readAlarm()).toBeNull();
  });

  test("retries after canonical completion without duplicating the terminal event", async () => {
    const fixture = await createSocketCloseFinalizationFixture();
    const { coordinator, state } = await fixture.restore();
    const persist = spyOn(state, "persistTerminalSnapshot").mockRejectedValueOnce(
      new Error("injected finalization snapshot failure"),
    );
    try {
      await expect(coordinator.finalize()).rejects.toThrow(
        "injected finalization snapshot failure",
      );
    } finally {
      persist.mockRestore();
    }
    expect(state.finalizationCompleted).toBe(false);
    const restored = await fixture.restore();
    await restored.coordinator.finalize();
    expect(restored.state.finalizationCompleted).toBe(true);
    expect(
      (await readTerminalEvents(fixture.database)).filter(
        (event) => event.event_type === "run.failed",
      ),
    ).toHaveLength(1);
    expect(fixture.readAlarm()).toBeNull();
  });

  test("treats a legacy close snapshot as pending finalization", async () => {
    const fixture = await createSocketCloseFinalizationFixture();
    const snapshot = fixture.stored.get(DRIVER_INSTANCE_STATE_STORAGE_KEY);
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      !("finalizationCompleted" in snapshot)
    ) {
      throw new Error("Expected a persisted finalization snapshot.");
    }
    delete snapshot.finalizationCompleted;
    const { coordinator, state } = await fixture.restore();
    expect(state.finalizationCompleted).toBe(false);
    await coordinator.finalize();
    expect(
      (await readTerminalEvents(fixture.database)).filter(
        (event) => event.event_type === "run.failed",
      ),
    ).toHaveLength(1);
  });

  test.each([
    { connectionId: "successor-connection", generation: 0 },
    { connectionId: "connection-finalized", generation: 1 },
  ])(
    "never repairs a successor connection or generation: %j",
    async ({ connectionId, generation }) => {
      const fixture = await createSocketCloseFinalizationFixture();
      const { database, driverInstanceId } = fixture;
      await database
        .prepare("UPDATE driver_instance SET connection_id = ?, generation = ? WHERE id = ?")
        .bind(connectionId, generation, driverInstanceId)
        .run();
      const { coordinator } = await fixture.restore();
      await Promise.all([coordinator.finalize(), coordinator.finalize()]);
      expect(
        await database
          .prepare("SELECT status, close_code FROM driver_instance WHERE id = ?")
          .bind(driverInstanceId)
          .first(),
      ).toEqual({ status: "ready", close_code: null });
      expect(
        await database
          .prepare("SELECT status FROM session_run WHERE id = ?")
          .bind(FINALIZE_RUN_ID)
          .first(),
      ).toEqual({ status: "running" });
      expect(
        (await readTerminalEvents(database)).filter((event) => event.event_type === "run.failed"),
      ).toHaveLength(0);
      expect(fixture.readAlarm()).toBeNull();
    },
  );

  test("fails the active run lease and publishes a replayable terminal event", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "stopped",
    });
    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "stopped",
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(FINALIZE_RUN_ID)
      .first<{ error_code: string | null; status: string }>();
    const activeLease = await database
      .prepare(
        "SELECT id FROM session_run WHERE driver_instance_id = ? AND status IN ('queued', 'booting', 'running', 'waiting_input')",
      )
      .bind(PUBLIC_API_TEST_IDS.driverOwner)
      .first<{ id: string }>();
    const terminalEvents = await readTerminalEvents(database);

    expect(run).toEqual({
      error_code: "runtime.turn_interrupted",
      status: "failed",
    });
    expect(activeLease).toBeNull();
    expect(terminalEvents).toEqual([
      {
        content_text: TURN_INTERRUPTED_MESSAGE,
        event_type: "run.failed",
        family: "run",
        process_status: "error",
        process_type: "run.failed",
        run_id: FINALIZE_RUN_ID,
        seq: 1,
        source: "api",
        source_event_id: `session-run-terminal:${FINALIZE_RUN_ID}:run.failed`,
        trace_id: "trace-finalize",
        visibility: "all_consumers",
      },
    ]);
  });

  test("deduplicates dispatch repair after driver finalization", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "failed",
    });
    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: FINALIZE_RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });

    const failureEvents = (await readTerminalEvents(database)).filter(
      (event) => event.event_type === "run.failed",
    );
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0]?.source_event_id).toBe(
      `session-run-terminal:${FINALIZE_RUN_ID}:run.failed`,
    );
  });
});
