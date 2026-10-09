import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import {
  acquireRuntimeRunLease,
  releaseRuntimeRunLease,
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
      subject_kind text NOT NULL DEFAULT 'session',
      sandbox_binding text NOT NULL DEFAULT 'Sandbox',
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
      created_by_key_id text,
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

    await expect(acquireRuntimeRunLease(database, leaseInput())).resolves.toEqual({ ok: true });
    await expect(
      releaseRuntimeRunLease(database, {
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

  test.each(["active", "closed"])(
    "historical kind cannot bypass conversation residency (%s)",
    async (status) => {
      const database = createRuntimeSubjectLeaseDatabase();
      database.execute(`UPDATE sandbox SET kind = 'pet' WHERE id = '${SANDBOX_ID}'`);

      await acquireRuntimeRunLease(database, leaseInput());
      database.execute(`UPDATE sandbox_session SET status = '${status}'`);
      const releasedAfter = Date.now();
      await expect(
        releaseRuntimeRunLease(database, {
          driverInstanceId: DRIVER_INSTANCE_ID,
          expectedSessionRunId: SESSION_RUN_ID,
        }),
      ).resolves.toBe(true);

      const deadline = await database
        .prepare("SELECT inactive_deadline_at FROM sandbox WHERE id = ?")
        .bind(SANDBOX_ID)
        .first<number>("inactive_deadline_at");

      if (status === "active") {
        expect(deadline).toBeNull();
      } else {
        expect(deadline).toBeGreaterThanOrEqual(releasedAfter + 5 * 60_000);
        expect(deadline).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
      }
    },
  );

  test("keeps terminal run history after lease release", async () => {
    const database = createRuntimeSubjectLeaseDatabase();

    await acquireRuntimeRunLease(database, leaseInput());
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
      releaseRuntimeRunLease(database, {
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

    await acquireRuntimeRunLease(database, leaseInput());

    await expect(acquireRuntimeRunLease(database, leaseInput())).resolves.toEqual({ ok: true });
  });

  test("retries while the run or the driver is leased elsewhere", async () => {
    const runLeased = createRuntimeSubjectLeaseDatabase();
    runLeased.execute(`
      UPDATE session_run
      SET driver_instance_id = '${OTHER_DRIVER_INSTANCE_ID}'
      WHERE id = '${SESSION_RUN_ID}'
    `);

    await expect(acquireRuntimeRunLease(runLeased, leaseInput())).resolves.toEqual({
      ok: false,
      reason: "run_already_leased",
      retryable: true,
    });
    const run = await runLeased
      .prepare(`SELECT driver_instance_id FROM session_run WHERE id = '${SESSION_RUN_ID}'`)
      .first<{ driver_instance_id: string | null }>();
    expect(run?.driver_instance_id).toBe(OTHER_DRIVER_INSTANCE_ID);

    const driverLeased = createRuntimeSubjectLeaseDatabase();
    driverLeased.execute(`
      INSERT INTO session_run (driver_instance_id, id, session_id, status, status_seq, updated_at)
      VALUES ('${DRIVER_INSTANCE_ID}', '${OTHER_SESSION_RUN_ID}', '${SESSION_ID}', 'running', 0, 1)
    `);

    await expect(acquireRuntimeRunLease(driverLeased, leaseInput())).resolves.toEqual({
      ok: false,
      reason: "driver_already_leased",
      retryable: true,
    });
  });

  test.each([
    ["a missing run", "", MISSING_SESSION_RUN_ID],
    [
      "a terminal run",
      `UPDATE session_run SET status = 'completed', status_seq = 1 WHERE id = '${SESSION_RUN_ID}'`,
      SESSION_RUN_ID,
    ],
    [
      "an inactive sandbox session",
      `UPDATE sandbox_session SET status = 'closed' WHERE session_id = '${SESSION_ID}'`,
      SESSION_RUN_ID,
    ],
    [
      "a terminal driver that already holds the run",
      `UPDATE driver_instance SET status = 'stopped' WHERE id = '${DRIVER_INSTANCE_ID}';
       UPDATE session_run SET driver_instance_id = '${DRIVER_INSTANCE_ID}' WHERE id = '${SESSION_RUN_ID}'`,
      SESSION_RUN_ID,
    ],
    [
      "a run of another Session",
      `INSERT INTO session_run (id, session_id, status, status_seq, updated_at)
       VALUES ('${OTHER_SESSION_RUN_ID}', '01J0000000000000000000000P', 'running', 0, 1)`,
      OTHER_SESSION_RUN_ID,
    ],
    [
      "a driver in another sandbox",
      `UPDATE driver_instance SET sandbox_id = '01J0000000000000000000000T' WHERE id = '${DRIVER_INSTANCE_ID}'`,
      SESSION_RUN_ID,
    ],
    [
      "a driver of another Session",
      `UPDATE driver_instance SET sandbox_session_id = '01J0000000000000000000000P' WHERE id = '${DRIVER_INSTANCE_ID}'`,
      SESSION_RUN_ID,
    ],
  ] as const)("fails without retry for %s", async (_name, change, sessionRunId) => {
    const database = createRuntimeSubjectLeaseDatabase();
    if (change) database.execute(change);

    await expect(
      acquireRuntimeRunLease(database, leaseInput({ sessionRunId })),
    ).resolves.toMatchObject({ ok: false, retryable: false });
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

    await acquireRuntimeRunLease(database, leaseInput());

    await expect(
      releaseRuntimeRunLease(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        expectedSessionRunId: UNLINKED_SESSION_RUN_ID,
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

    expect(run?.driver_instance_id).toBe(DRIVER_INSTANCE_ID);
  });
});
