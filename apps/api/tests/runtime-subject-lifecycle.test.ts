import { describe, expect, test } from "bun:test";

import { decideRuntimeSubjectTransition } from "../src/modules/runtime/domain/runtime-subject-lifecycle.machine";
import { createRuntimeSubjectLifecycleService } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import {
  advanceRuntimeSubjectOperationStatus,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const RUNTIME_SUBJECT_ID = "01J0000000000000000000000D";

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

    CREATE TABLE sandbox_backup (
      created_at integer NOT NULL,
      dir text NOT NULL,
      error_message text,
      id text PRIMARY KEY NOT NULL,
      keep integer NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL,
      ttl_seconds integer NOT NULL,
      updated_at integer NOT NULL
    );
  `);

  return database;
}

async function insertRuntimeSubject(
  database: D1Database,
  input: {
    readonly lastError?: string | null;
    readonly lastErrorCode?: string | null;
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
      RUNTIME_SUBJECT_ID,
      1,
      "cattle",
      null,
      input.lastError ?? null,
      input.lastErrorCode ?? null,
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
        WHERE id = '${RUNTIME_SUBJECT_ID}'
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

function createSandboxHandle(): SandboxHandle {
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    createBackup: unavailable,
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: unavailable,
    exec: unavailable,
    getSession: unavailable,
    mkdir: async () => {},
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: async () => {},
    startProcess: unavailable,
    terminal: unavailable,
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
  } as SandboxHandle;
}

function createBindings(database: D1Database): ApiBindings {
  return {
    DB: database,
    SANDBOX_FILE_BUCKET_LOCAL: "true",
    runtimeSubjectHandleFactory: () => createSandboxHandle(),
  } as unknown as ApiBindings;
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

  test("lets interactive activation preempt best-effort prewarm activation claims", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold" });
    await database
      .prepare(
        `
          UPDATE sandbox
          SET claim_owner = ?, claim_expires_at = ?
          WHERE id = ?
        `,
      )
      .bind("prewarm-activation-stalled", Date.now() + 60_000, RUNTIME_SUBJECT_ID)
      .run();

    const activation = await createRuntimeSubjectLifecycleService(
      createBindings(database),
    ).activate({
      executionOwnerUserId: "01J00000000000000000000002",
      kind: "cattle",
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      subjectId: "01J00000000000000000000009",
      subjectKind: "session",
    });

    expect(activation.subject).toBeTruthy();
    const row = await database
      .prepare(
        `
          SELECT claim_expires_at, claim_owner, status
          FROM sandbox
          WHERE id = ?
        `,
      )
      .bind(RUNTIME_SUBJECT_ID)
      .first<{
        claim_expires_at: number | null;
        claim_owner: string | null;
        status: string;
      }>();

    expect(row).toEqual({
      claim_expires_at: null,
      claim_owner: null,
      status: "active",
    });
  });

  test("lets interactive activation retry after activation failures", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, {
      lastError: "Runtime subject filesystem prepare timed out after 15000ms.",
      lastErrorCode: "runtime.subject_activation_failed",
      status: "error",
      statusSeq: 7,
    });

    const activation = await createRuntimeSubjectLifecycleService(
      createBindings(database),
    ).activate({
      executionOwnerUserId: "01J00000000000000000000002",
      kind: "cattle",
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      subjectId: "01J00000000000000000000009",
      subjectKind: "session",
    });

    expect(activation.subject).toBeTruthy();
    const row = await database
      .prepare(
        `
          SELECT claim_expires_at, claim_owner, last_error, last_error_code, status
          FROM sandbox
          WHERE id = ?
        `,
      )
      .bind(RUNTIME_SUBJECT_ID)
      .first<{
        claim_expires_at: number | null;
        claim_owner: string | null;
        last_error: string | null;
        last_error_code: string | null;
        status: string;
      }>();

    expect(row).toEqual({
      claim_expires_at: null,
      claim_owner: null,
      last_error: null,
      last_error_code: null,
      status: "active",
    });
  });
});
