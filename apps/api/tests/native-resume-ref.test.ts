import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";

import {
  deleteNativeResumeRefsForSessions,
  getNativeResumeRefForRuntime,
  upsertNativeResumeRef,
} from "../src/modules/runtime/infrastructure/native-resume-ref.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SESSION_ID_1 = "01J000000000000000000000G1";
const SESSION_ID_2 = "01J000000000000000000000G2";
const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>(
  "01J000000000000000000000G4",
  "driver instance ID",
);
const SESSION_RUN_ID = parsePlatformId<SessionRunId>(
  "01J000000000000000000000G3",
  "session run ID",
);

describe("native resume refs", () => {
  test("uses only the cursor committed with a Cattle checkpoint", async () => {
    const database = new SqliteD1Database();
    database.execute(`
      CREATE TABLE session (
        id text PRIMARY KEY NOT NULL,
        kind text NOT NULL
      );
      CREATE TABLE native_resume_ref (
        committed_session_run_id text,
        committed_value text,
        created_at integer NOT NULL,
        kind text NOT NULL,
        observed_driver_instance_id text,
        observed_event_seq integer DEFAULT 0 NOT NULL,
        observed_session_run_id text,
        runtime_id text NOT NULL,
        session_id text PRIMARY KEY NOT NULL,
        updated_at integer NOT NULL,
        value text NOT NULL
      );
      INSERT INTO session (id, kind) VALUES
        ('${SESSION_ID_1}', 'cattle'),
        ('${SESSION_ID_2}', 'pet');
      INSERT INTO native_resume_ref (
        committed_session_run_id, committed_value, created_at, kind,
        runtime_id, session_id, updated_at, value
      ) VALUES
        ('01J000000000000000000000G3', 'thread-cattle-committed', 1,
         'openai_thread_id', 'openai-runtime', '${SESSION_ID_1}', 1,
         'thread-cattle-live'),
        (NULL, NULL, 1, 'openai_thread_id', 'openai-runtime',
         '${SESSION_ID_2}', 1, 'thread-pet-live');
    `);

    await expect(
      getNativeResumeRefForRuntime(database, {
        runtimeId: "openai-runtime",
        sessionId: SESSION_ID_1,
      }),
    ).resolves.toEqual({
      kind: "openai_thread_id",
      runtimeId: "openai-runtime",
      value: "thread-cattle-committed",
    });
    await expect(
      getNativeResumeRefForRuntime(database, {
        runtimeId: "openai-runtime",
        sessionId: SESSION_ID_2,
      }),
    ).resolves.toEqual({
      kind: "openai_thread_id",
      runtimeId: "openai-runtime",
      value: "thread-pet-live",
    });
  });

  test("deletes reset session refs without touching other sessions", async () => {
    const database = new SqliteD1Database();
    database.execute(`
      CREATE TABLE native_resume_ref (
        created_at integer NOT NULL,
        kind text NOT NULL,
        observed_driver_instance_id text,
        observed_event_seq integer DEFAULT 0 NOT NULL,
        observed_session_run_id text,
        runtime_id text NOT NULL,
        session_id text PRIMARY KEY NOT NULL,
        updated_at integer NOT NULL,
        value text NOT NULL
      );
      INSERT INTO native_resume_ref (
        created_at, kind, runtime_id, session_id, updated_at, value
      ) VALUES
        (1, 'openai_thread_id', 'openai-runtime', '${SESSION_ID_1}', 1, 'thread-1'),
        (1, 'openai_thread_id', 'openai-runtime', '${SESSION_ID_2}', 1, 'thread-2');
    `);

    await deleteNativeResumeRefsForSessions(database, [SESSION_ID_1]);

    const rows = await database
      .prepare("SELECT session_id, value FROM native_resume_ref ORDER BY session_id")
      .all<{ session_id: string; value: string }>();
    expect(rows.results).toEqual([{ session_id: SESSION_ID_2, value: "thread-2" }]);
  });

  test("only a higher durable event seq can replace an observed ref", async () => {
    const database = new SqliteD1Database({ foreignKeys: false });
    database.execute(`
      CREATE TABLE native_resume_ref (
        committed_session_run_id text,
        committed_value text,
        created_at integer NOT NULL,
        kind text NOT NULL,
        observed_driver_instance_id text,
        observed_event_seq integer DEFAULT 0 NOT NULL,
        observed_session_run_id text,
        runtime_id text NOT NULL,
        session_id text PRIMARY KEY NOT NULL,
        updated_at integer NOT NULL,
        value text NOT NULL
      );
    `);

    const observation = {
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeResumeRef: {
        kind: "openai_thread_id" as const,
        runtimeId: "openai-runtime" as const,
        value: "thread-5",
      },
      observedEventSeq: 5,
      sessionId: SESSION_ID_1 as SessionId,
      sessionRunId: SESSION_RUN_ID,
    };

    await upsertNativeResumeRef(database, observation);
    await upsertNativeResumeRef(database, {
      ...observation,
      nativeResumeRef: { ...observation.nativeResumeRef, value: "stale-thread" },
      observedEventSeq: 4,
    });
    await upsertNativeResumeRef(database, observation);
    await expect(
      upsertNativeResumeRef(database, {
        ...observation,
        nativeResumeRef: { ...observation.nativeResumeRef, value: "conflicting-thread" },
      }),
    ).rejects.toThrow("replayed with conflicting content");

    await upsertNativeResumeRef(database, {
      ...observation,
      nativeResumeRef: { ...observation.nativeResumeRef, value: "thread-6" },
      observedEventSeq: 6,
    });

    expect(
      await database
        .prepare("SELECT observed_event_seq, value FROM native_resume_ref WHERE session_id = ?")
        .bind(SESSION_ID_1)
        .first<{ observed_event_seq: number; value: string }>(),
    ).toEqual({ observed_event_seq: 6, value: "thread-6" });
  });
});
