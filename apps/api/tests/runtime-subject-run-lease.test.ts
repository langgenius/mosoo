import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import {
  recordRuntimeRunLeaseAcquired,
  recordRuntimeRunLeaseAcquiredOutcome,
  recordRuntimeRunLeaseReleased,
  recordRuntimeRunLeaseReleasedOutcome,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-run-lease-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_INSTANCE_ID = PLATFORM_ID_FIXTURES.driverInstance;
const OTHER_DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>(
  "01J0000000000000000000000S",
  "other driver instance id",
);
const MISSING_SESSION_RUN_ID = parsePlatformId<SessionRunId>(
  "01J0000000000000000000000R",
  "missing session run id",
);
const OTHER_SANDBOX_ID = parsePlatformId<SandboxId>(
  "01J0000000000000000000000T",
  "other sandbox id",
);
const OTHER_SESSION_ID = parsePlatformId<SessionId>(
  "01J0000000000000000000000P",
  "other session id",
);
const OTHER_SESSION_RUN_ID = parsePlatformId<SessionRunId>(
  "01J0000000000000000000000Q",
  "other session run id",
);
const SANDBOX_ID = PLATFORM_ID_FIXTURES.sandbox;
const SESSION_ID = PLATFORM_ID_FIXTURES.session;
const SESSION_RUN_ID = PLATFORM_ID_FIXTURES.sessionRun;
const UNLINKED_SESSION_RUN_ID = parsePlatformId<SessionRunId>(
  "01J0000000000000000000000V",
  "unlinked session run id",
);

function createRuntimeSubjectLeaseDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      generation integer NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'driver.provision' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox (
      claim_owner text,
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      incarnation integer NOT NULL,
      kind text NOT NULL,
      operation_kind text,
      status text NOT NULL,
      status_operation_id text,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      sandbox_id text NOT NULL,
      sandbox_incarnation integer NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE session_run (
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      status text NOT NULL,
      status_seq integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX session_run_active_driver_lease_idx
      ON session_run (driver_instance_id)
      WHERE driver_instance_id IS NOT NULL
        AND status IN ('queued', 'booting', 'running', 'waiting_input');

    INSERT INTO sandbox (
      claim_owner, id, inactive_deadline_at, incarnation, kind, operation_kind,
      status, status_operation_id, updated_at
    )
    VALUES (NULL, '${SANDBOX_ID}', 1, 1, 'cattle', NULL, 'active', NULL, 1);

    INSERT INTO sandbox_session (sandbox_id, sandbox_incarnation, session_id, status)
    VALUES ('${SANDBOX_ID}', 1, '${SESSION_ID}', 'active');

    INSERT INTO driver_instance (
      id,
      generation,
      sandbox_id,
      sandbox_incarnation,
      sandbox_session_id,
      status,
      updated_at
    )
    VALUES ('${DRIVER_INSTANCE_ID}', 0, '${SANDBOX_ID}', 1, '${SESSION_ID}', 'ready', 1);

    INSERT INTO session_run (id, session_id, status, status_seq, updated_at)
    VALUES ('${SESSION_RUN_ID}', '${SESSION_ID}', 'running', 0, 1);
  `);

  return database;
}

function leaseInput(
  input: {
    driverInstanceId?: DriverInstanceId;
    sessionRunId?: SessionRunId;
  } = {},
) {
  return {
    driverGeneration: 0,
    driverInstanceId: input.driverInstanceId ?? DRIVER_INSTANCE_ID,
    runtimeSubjectId: SANDBOX_ID,
    runtimeSubjectIncarnation: 1,
    sessionId: SESSION_ID,
    sessionRunId: input.sessionRunId ?? SESSION_RUN_ID,
  };
}

describe("runtime subject run lease store", () => {
  test("acquires and releases a run lease with atomic driver transitions", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    await expect(
      recordRuntimeRunLeaseAcquired(database, {
        ...leaseInput(),
      }),
    ).resolves.toBe(true);
    await expect(
      recordRuntimeRunLeaseReleased(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        expectedDriverGeneration: 0,
        expectedSessionRunId: SESSION_RUN_ID,
      }),
    ).resolves.toBe(true);

    const run = await database
      .prepare(
        `
          SELECT driver_instance_id
          FROM session_run
          WHERE id = '${SESSION_RUN_ID}'
        `,
      )
      .first<{ driver_instance_id: string | null }>();
    const sandbox = await database
      .prepare(
        `
          SELECT inactive_deadline_at
          FROM sandbox
          WHERE id = '${SANDBOX_ID}'
        `,
      )
      .first<{ inactive_deadline_at: number | null }>();

    expect(run?.driver_instance_id).toBeNull();
    expect(sandbox?.inactive_deadline_at).toBeNull();
  });

  test("does not let an old Driver generation release the replacement generation's lease", async () => {
    const database = createRuntimeSubjectLeaseDatabase();
    await recordRuntimeRunLeaseAcquired(database, leaseInput());
    const originalBatch = database.batch.bind(database) as D1Database["batch"];
    let rotateBeforeRelease = true;
    database.batch = (async <T = unknown>(statements: D1PreparedStatement[]) => {
      if (rotateBeforeRelease) {
        rotateBeforeRelease = false;
        database.execute(
          `UPDATE driver_instance SET generation = 1 WHERE id = '${DRIVER_INSTANCE_ID}'`,
        );
      }
      return originalBatch<T>(statements);
    }) as D1Database["batch"];

    await expect(
      recordRuntimeRunLeaseReleasedOutcome(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        expectedDriverGeneration: 0,
        expectedSessionRunId: SESSION_RUN_ID,
      }),
    ).resolves.toEqual({
      reason: "driver_changed",
      status: "stale",
      transition: "release",
    });
    await expect(
      database
        .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
        .bind(SESSION_RUN_ID)
        .first("driver_instance_id"),
    ).resolves.toBe(DRIVER_INSTANCE_ID);
  });

  test("does not let an old Driver generation acquire a lease for its replacement", async () => {
    const database = createRuntimeSubjectLeaseDatabase();
    const originalBatch = database.batch.bind(database) as D1Database["batch"];
    let rotateBeforeAcquire = true;
    database.batch = (async <T = unknown>(statements: D1PreparedStatement[]) => {
      if (rotateBeforeAcquire) {
        rotateBeforeAcquire = false;
        database.execute(
          `UPDATE driver_instance SET generation = 1 WHERE id = '${DRIVER_INSTANCE_ID}'`,
        );
      }
      return originalBatch<T>(statements);
    }) as D1Database["batch"];

    await expect(recordRuntimeRunLeaseAcquiredOutcome(database, leaseInput())).resolves.toEqual({
      reason: "driver_changed",
      status: "stale",
      transition: "acquire",
    });
    await expect(
      database
        .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
        .bind(SESSION_RUN_ID)
        .first("driver_instance_id"),
    ).resolves.toBeNull();
  });

  test("rolls back the run link when clearing the inactive deadline fails", async () => {
    const database = createRuntimeSubjectLeaseDatabase();
    database.execute(`
      CREATE TRIGGER reject_inactive_deadline_clear
      BEFORE UPDATE OF inactive_deadline_at ON sandbox
      WHEN NEW.inactive_deadline_at IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'injected deadline failure');
      END;
    `);

    await expect(recordRuntimeRunLeaseAcquired(database, leaseInput())).rejects.toThrow(
      "injected deadline failure",
    );

    const run = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind(SESSION_RUN_ID)
      .first<{ driver_instance_id: string | null }>();
    const deadline = await database
      .prepare("SELECT inactive_deadline_at FROM sandbox WHERE id = ?")
      .bind(SANDBOX_ID)
      .first<number>("inactive_deadline_at");

    expect(run?.driver_instance_id).toBeNull();
    expect(deadline).toBe(1);
  });

  test("arms the pet idle deadline after the final run while its conversation stays active", async () => {
    const database = createRuntimeSubjectLeaseDatabase();
    database.execute(`UPDATE sandbox SET kind = 'pet' WHERE id = '${SANDBOX_ID}'`);

    await recordRuntimeRunLeaseAcquired(database, {
      ...leaseInput(),
    });
    const releasedAfter = Date.now();
    await expect(
      recordRuntimeRunLeaseReleased(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        expectedDriverGeneration: 0,
        expectedSessionRunId: SESSION_RUN_ID,
      }),
    ).resolves.toBe(true);

    const deadline = await database
      .prepare("SELECT inactive_deadline_at FROM sandbox WHERE id = ?")
      .bind(SANDBOX_ID)
      .first<number>("inactive_deadline_at");

    expect(deadline).toBeGreaterThanOrEqual(releasedAfter + 5 * 60_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });

  test("keeps terminal run history after lease release", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    await recordRuntimeRunLeaseAcquired(database, {
      ...leaseInput(),
    });
    database.execute(`
      INSERT INTO session_run (driver_instance_id, id, session_id, status, status_seq, updated_at)
      VALUES ('${OTHER_DRIVER_INSTANCE_ID}', '${UNLINKED_SESSION_RUN_ID}', '${SESSION_ID}', 'running', 0, 1)
    `);
    database.execute(`
      UPDATE session_run
      SET status = 'completed',
          status_seq = 1
      WHERE id = '${SESSION_RUN_ID}'
    `);

    await expect(
      recordRuntimeRunLeaseReleased(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        expectedDriverGeneration: 0,
        expectedSessionRunId: SESSION_RUN_ID,
      }),
    ).resolves.toBe(true);

    const run = await database
      .prepare(
        `
          SELECT driver_instance_id
          FROM session_run
          WHERE id = '${SESSION_RUN_ID}'
        `,
      )
      .first<{ driver_instance_id: string | null }>();

    expect(run?.driver_instance_id).toBe(DRIVER_INSTANCE_ID);
  });

  test("keeps a terminal Driver non-assignable until its physical close", async () => {
    const database = createRuntimeSubjectLeaseDatabase();
    await recordRuntimeRunLeaseAcquired(database, leaseInput());
    database.execute(`
      UPDATE session_run SET status = 'completed', status_seq = 1
      WHERE id = '${SESSION_RUN_ID}';
      UPDATE driver_instance SET status_operation_id = '${SESSION_RUN_ID}'
      WHERE id = '${DRIVER_INSTANCE_ID}';
      INSERT INTO session_run (id, session_id, status, status_seq, updated_at)
      VALUES ('${OTHER_SESSION_RUN_ID}', '${SESSION_ID}', 'running', 0, 2);
    `);

    const terminalRelease = await recordRuntimeRunLeaseReleasedOutcome(database, {
      driverInstanceId: DRIVER_INSTANCE_ID,
      expectedDriverGeneration: 0,
      expectedDriverOperationId: SESSION_RUN_ID,
      expectedSessionRunId: SESSION_RUN_ID,
      retainDriverOperationUntilTerminal: true,
    });
    expect(terminalRelease).toMatchObject({ status: "applied" });
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ status: "stopping", status_operation_id: SESSION_RUN_ID });
    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(
        database,
        leaseInput({ sessionRunId: OTHER_SESSION_RUN_ID }),
      ),
    ).resolves.toEqual({
      reason: "driver_not_assignable",
      status: "rejected",
      transition: "acquire",
    });

    database.execute(`
      UPDATE driver_instance SET status = 'stopped'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);
    await expect(
      recordRuntimeRunLeaseReleasedOutcome(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        expectedDriverGeneration: 0,
        expectedDriverOperationId: SESSION_RUN_ID,
        expectedSessionRunId: SESSION_RUN_ID,
        retainDriverOperationUntilTerminal: true,
      }),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ status: "stopped", status_operation_id: null });
  });

  test("treats acquiring the same run as idempotent", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    await recordRuntimeRunLeaseAcquired(database, {
      ...leaseInput(),
    });

    await expect(
      recordRuntimeRunLeaseAcquired(database, {
        ...leaseInput(),
      }),
    ).resolves.toBe(true);
    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(database, {
        ...leaseInput(),
      }),
    ).resolves.toEqual({
      status: "duplicate",
      transition: "acquire",
    });
  });

  test("does not acquire a lease for a missing run", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    await expect(
      recordRuntimeRunLeaseAcquired(database, {
        ...leaseInput({ sessionRunId: MISSING_SESSION_RUN_ID }),
      }),
    ).resolves.toBe(false);

    const run = await database
      .prepare(
        `
          SELECT driver_instance_id
          FROM session_run
          WHERE id = '${SESSION_RUN_ID}'
        `,
      )
      .first<{ driver_instance_id: string | null }>();

    expect(run?.driver_instance_id).toBeNull();
  });

  test("does not acquire while terminal cleanup owns the Driver", async () => {
    const database = createRuntimeSubjectLeaseDatabase();
    database.execute(`
      UPDATE driver_instance
      SET status_operation_id = '${SESSION_RUN_ID}'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    await expect(recordRuntimeRunLeaseAcquiredOutcome(database, leaseInput())).resolves.toEqual({
      reason: "driver_not_assignable",
      status: "rejected",
      transition: "acquire",
    });
  });

  test("does not steal a run linked to another driver", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    database.execute(`
      UPDATE session_run
      SET driver_instance_id = '${OTHER_DRIVER_INSTANCE_ID}'
      WHERE id = '${SESSION_RUN_ID}'
    `);

    await expect(
      recordRuntimeRunLeaseAcquired(database, {
        ...leaseInput(),
      }),
    ).resolves.toBe(false);
    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(database, {
        ...leaseInput(),
      }),
    ).resolves.toEqual({
      reason: "run_already_leased",
      status: "rejected",
      transition: "acquire",
    });

    const run = await database
      .prepare(
        `
          SELECT driver_instance_id
          FROM session_run
          WHERE id = '${SESSION_RUN_ID}'
        `,
      )
      .first<{ driver_instance_id: string | null }>();

    expect(run?.driver_instance_id).toBe(OTHER_DRIVER_INSTANCE_ID);
  });

  test("rejects a run outside the driver sandbox session scope", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    database.execute(`
      INSERT INTO session_run (id, session_id, status, status_seq, updated_at)
      VALUES ('${OTHER_SESSION_RUN_ID}', '${OTHER_SESSION_ID}', 'running', 0, 1)
    `);

    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(database, {
        ...leaseInput({ sessionRunId: OTHER_SESSION_RUN_ID }),
      }),
    ).resolves.toEqual({
      reason: "run_scope_mismatch",
      status: "rejected",
      transition: "acquire",
    });

    const run = await database
      .prepare(
        `
          SELECT driver_instance_id
          FROM session_run
          WHERE id = '${OTHER_SESSION_RUN_ID}'
        `,
      )
      .first<{ driver_instance_id: string | null }>();

    expect(run?.driver_instance_id).toBeNull();
  });

  test("rejects a driver outside the expected sandbox session scope", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(database, {
        ...leaseInput(),
        runtimeSubjectId: OTHER_SANDBOX_ID,
      }),
    ).resolves.toEqual({
      reason: "driver_scope_mismatch",
      status: "rejected",
      transition: "acquire",
    });
  });

  test("rejects inactive sandbox session leases", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    database.execute(`
      UPDATE sandbox_session
      SET status = 'closed'
      WHERE session_id = '${SESSION_ID}'
    `);

    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(database, {
        ...leaseInput(),
      }),
    ).resolves.toEqual({
      reason: "sandbox_session_not_active",
      status: "rejected",
      transition: "acquire",
    });
  });

  test("rejects terminal run leases", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    database.execute(`
      UPDATE session_run
      SET status = 'completed',
          status_seq = 1
      WHERE id = '${SESSION_RUN_ID}'
    `);

    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(database, {
        ...leaseInput(),
      }),
    ).resolves.toEqual({
      reason: "run_not_active",
      status: "rejected",
      transition: "acquire",
    });
  });

  test("rejects duplicate leases on terminal drivers", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    database.execute(`
      UPDATE driver_instance
      SET status = 'stopped'
      WHERE id = '${DRIVER_INSTANCE_ID}';

      UPDATE session_run
      SET driver_instance_id = '${DRIVER_INSTANCE_ID}'
      WHERE id = '${SESSION_RUN_ID}';
    `);

    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(database, {
        ...leaseInput(),
      }),
    ).resolves.toEqual({
      reason: "driver_not_assignable",
      status: "rejected",
      transition: "acquire",
    });
  });

  test("rejects leases on stopping drivers", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    database.execute(`
      UPDATE driver_instance
      SET status = 'stopping'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    await expect(
      recordRuntimeRunLeaseAcquiredOutcome(database, {
        ...leaseInput(),
      }),
    ).resolves.toEqual({
      reason: "driver_not_assignable",
      status: "rejected",
      transition: "acquire",
    });
  });

  test("active lease unique constraint rejects two active runs on the same driver", () => {
    const database = createRuntimeSubjectLeaseDatabase();

    database.execute(`
      INSERT INTO session_run (id, session_id, status, status_seq, updated_at)
      VALUES ('${OTHER_SESSION_RUN_ID}', '${SESSION_ID}', 'running', 0, 1);

      UPDATE session_run
      SET driver_instance_id = '${DRIVER_INSTANCE_ID}'
      WHERE id = '${SESSION_RUN_ID}';
    `);

    expect(() =>
      database.execute(`
        UPDATE session_run
        SET driver_instance_id = '${DRIVER_INSTANCE_ID}'
        WHERE id = '${OTHER_SESSION_RUN_ID}'
      `),
    ).toThrow();
  });

  test("does not release a lease for a different run", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    await recordRuntimeRunLeaseAcquired(database, {
      ...leaseInput(),
    });

    await expect(
      recordRuntimeRunLeaseReleased(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        expectedDriverGeneration: 0,
        expectedSessionRunId: UNLINKED_SESSION_RUN_ID,
      }),
    ).resolves.toBe(false);
    await expect(
      recordRuntimeRunLeaseReleasedOutcome(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        expectedDriverGeneration: 0,
        expectedSessionRunId: UNLINKED_SESSION_RUN_ID,
      }),
    ).resolves.toEqual({
      reason: "lease_mismatch",
      status: "stale",
      transition: "release",
    });

    const run = await database
      .prepare(
        `
          SELECT driver_instance_id
          FROM session_run
          WHERE id = '${SESSION_RUN_ID}'
        `,
      )
      .first<{ driver_instance_id: string | null }>();

    expect(run?.driver_instance_id).toBe(DRIVER_INSTANCE_ID);
  });
});
