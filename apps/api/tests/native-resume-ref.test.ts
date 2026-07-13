import { describe, expect, test } from "bun:test";

import { deleteNativeResumeRefsForSessions } from "../src/modules/runtime/infrastructure/native-resume-ref.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SESSION_ID_1 = "01J000000000000000000000G1";
const SESSION_ID_2 = "01J000000000000000000000G2";

describe("native resume refs", () => {
  test("deletes reset session refs without touching other sessions", async () => {
    const database = new SqliteD1Database();
    database.execute(`
      CREATE TABLE native_resume_ref (
        created_at integer NOT NULL,
        kind text NOT NULL,
        observed_driver_instance_id text,
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
});
