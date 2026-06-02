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
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      kind text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      sandbox_id text NOT NULL,
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

    INSERT INTO sandbox (id, inactive_deadline_at, kind, updated_at)
    VALUES ('${SANDBOX_ID}', 1, 'cattle', 1);

    INSERT INTO sandbox_session (sandbox_id, session_id, status)
    VALUES ('${SANDBOX_ID}', '${SESSION_ID}', 'active');

    INSERT INTO driver_instance (
      id,
      sandbox_id,
      sandbox_session_id,
      status,
      updated_at
    )
    VALUES ('${DRIVER_INSTANCE_ID}', '${SANDBOX_ID}', '${SESSION_ID}', 'ready', 1);

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
    driverInstanceId: input.driverInstanceId ?? DRIVER_INSTANCE_ID,
    runtimeSubjectId: SANDBOX_ID,
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
        expectedSessionRunId: UNLINKED_SESSION_RUN_ID,
      }),
    ).resolves.toBe(false);
    await expect(
      recordRuntimeRunLeaseReleasedOutcome(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
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
