import { describe, expect, test } from "bun:test";

import { decideRuntimeSubjectTransition } from "../src/modules/runtime/domain/runtime-subject-lifecycle.machine";
import {
  advanceRuntimeSubjectOperationStatus,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createRuntimeSubjectLifecycleDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox (
      claim_expires_at integer,
      claim_owner text,
      global_mounts_json text DEFAULT '[]' NOT NULL,
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      kind text NOT NULL,
      last_backup_id text,
      last_error text,
      last_error_code text,
      last_restore_backup_id text,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'runtime_subject.cold' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );
  `);

  return database;
}

async function insertRuntimeSubject(
  database: D1Database,
  input: {
    readonly status: string;
    readonly statusSeq?: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox (
          claim_expires_at,
          claim_owner,
          id,
          inactive_deadline_at,
          kind,
          last_backup_id,
          last_error,
          last_error_code,
          last_restore_backup_id,
          status,
          status_event,
          status_seq,
          status_source,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      null,
      null,
      "01J0000000000000000000000D",
      1,
      "cattle",
      null,
      null,
      null,
      null,
      input.status,
      `runtime_subject.${input.status === "backing_up" ? "back_up" : input.status}`,
      input.statusSeq ?? 0,
      "test",
      1,
    )
    .run();
}

async function readRuntimeSubject(database: D1Database): Promise<{
  status: string;
  status_event: string;
  status_seq: number;
  status_source: string;
}> {
  const row = await database
    .prepare(
      `
        SELECT status, status_event, status_seq, status_source
        FROM sandbox
        WHERE id = '01J0000000000000000000000D'
      `,
    )
    .first<{
      status: string;
      status_event: string;
      status_seq: number;
      status_source: string;
    }>();

  if (!row) {
    throw new Error("Runtime subject test row was not found.");
  }

  return row;
}

describe("runtime subject lifecycle machine", () => {
  test("keeps subject operation transitions explicit", () => {
    expect(
      decideRuntimeSubjectTransition({
        currentStatus: "cold",
        targetStatus: "restoring",
      }),
    ).toMatchObject({ kind: "accepted", nextStatus: "restoring" });
    expect(
      decideRuntimeSubjectTransition({
        currentStatus: "restoring",
        targetStatus: "backing_up",
      }),
    ).toMatchObject({ kind: "rejected", reason: "illegal_transition" });
    expect(
      decideRuntimeSubjectTransition({
        currentStatus: "backing_up",
        targetStatus: "destroying",
      }),
    ).toMatchObject({ kind: "accepted", nextStatus: "destroying" });
  });

  test("records operation transitions with monotonic status metadata", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active" });

    await expect(
      markRuntimeSubjectOperationStarted(database, {
        now: 10,
        runtimeSubjectId: "01J0000000000000000000000D",
        status: "backing_up",
      }),
    ).resolves.toBe(true);
    await expect(
      advanceRuntimeSubjectOperationStatus(database, {
        expectedStatus: "backing_up",
        runtimeSubjectId: "01J0000000000000000000000D",
        status: "destroying",
      }),
    ).resolves.toBe(true);
    await markRuntimeSubjectCold(database, {
      clearBackups: false,
      expectedStatus: "destroying",
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    await expect(readRuntimeSubject(database)).resolves.toEqual({
      status: "cold",
      status_event: "runtime_subject.cold",
      status_seq: 3,
      status_source: "api",
    });
  });

  test("does not let a stale operation completion overwrite a newer subject status", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active", statusSeq: 7 });

    await markRuntimeSubjectCold(database, {
      clearBackups: false,
      expectedStatus: "backing_up",
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    await expect(readRuntimeSubject(database)).resolves.toEqual({
      status: "active",
      status_event: "runtime_subject.active",
      status_seq: 7,
      status_source: "test",
    });
  });
});
