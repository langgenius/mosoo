import { describe, expect, test } from "bun:test";

import { getNativeContinuationForRuntime } from "../src/modules/runtime/infrastructure/native-resume-ref.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SESSION_ID = "01J000000000000000000000G1";
const RUN_ID = "01J000000000000000000000G3";

function database() {
  const db = new SqliteD1Database();
  db.execute(`CREATE TABLE native_resume_ref (
    committed_format_version integer,
    committed_session_run_id text,
    committed_value text,
    created_at integer NOT NULL,
    invalidated_at integer,
    invalidated_source_event_id text,
    kind text NOT NULL,
    observed_driver_instance_id text,
    observed_session_run_id text,
    runtime_id text NOT NULL,
    session_id text PRIMARY KEY NOT NULL,
    updated_at integer NOT NULL,
    value text NOT NULL
  )`);
  return db;
}

function insertCommitted(db: SqliteD1Database) {
  db.execute(`INSERT INTO native_resume_ref (
    committed_format_version, committed_session_run_id, committed_value, created_at,
    kind, runtime_id, session_id, updated_at, value
  ) VALUES (1, '${RUN_ID}', 'thread-committed', 1, 'openai_thread_id',
    'openai-runtime', '${SESSION_ID}', 1, 'thread-observed')`);
}

const input = { runtimeId: "openai-runtime" as const, sessionId: SESSION_ID };

describe("native continuation", () => {
  test("distinguishes first use from the committed native boundary", async () => {
    const db = database();
    await expect(getNativeContinuationForRuntime(db, input)).resolves.toEqual({
      status: "first-use",
    });
    insertCommitted(db);
    await expect(getNativeContinuationForRuntime(db, input)).resolves.toEqual({
      status: "committed",
      checkpoint: {
        formatVersion: 1,
        nativeRef: {
          kind: "openai_thread_id",
          runtimeId: "openai-runtime",
          value: "thread-committed",
        },
        runId: RUN_ID,
      },
    });
  });

  test("keeps a reset tombstone distinct from a new session", async () => {
    const db = database();
    insertCommitted(db);
    db.execute(
      "UPDATE native_resume_ref SET invalidated_at = 2, invalidated_source_event_id = 'reset-1'",
    );
    await expect(getNativeContinuationForRuntime(db, input)).resolves.toEqual({
      status: "invalidated",
      sourceEventId: "reset-1",
    });
    expect(await db.prepare("SELECT committed_value FROM native_resume_ref").first()).toEqual({
      committed_value: "thread-committed",
    });
  });

  test("rejects unverified legacy commits and a different runtime", async () => {
    const db = database();
    insertCommitted(db);
    db.execute("UPDATE native_resume_ref SET committed_format_version = NULL");
    await expect(getNativeContinuationForRuntime(db, input)).rejects.toThrow(
      "verified checkpoint migration",
    );
    await expect(
      getNativeContinuationForRuntime(db, { ...input, runtimeId: "claude-agent-sdk" }),
    ).rejects.toThrow("different runtime");
  });
});
