import { describe, expect, test } from "bun:test";

import { insertSessionMessage } from "../src/modules/sessions/infrastructure/session-message-store.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createSessionMessageStoreDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      last_message_at integer,
      message_seq_cursor integer DEFAULT 0 NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_message (
      content_text text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      plan_json text,
      role text NOT NULL,
      segments_json text,
      seq integer NOT NULL,
      session_id text NOT NULL,
      session_run_id text
    );

    CREATE UNIQUE INDEX session_message_session_seq_idx
      ON session_message (session_id, seq);

    INSERT INTO session (id, agent_id, updated_at)
    VALUES ('session-1', '01J00000000000000000000009', 1);
  `);

  return database;
}

describe("session message store", () => {
  test("allocates message sequence from existing messages", async () => {
    const database = createSessionMessageStoreDatabase();

    await insertSessionMessage(database, {
      content: "hello",
      createdByAccountId: "account-1",
      id: "message-1",
      role: "user",
      sessionId: "session-1",
    });
    await insertSessionMessage(database, {
      content: "hi",
      createdByAccountId: "account-1",
      id: "message-2",
      role: "assistant",
      sessionId: "session-1",
      sessionRunId: "run-1",
    });

    const messages = await database
      .prepare(
        `
          SELECT id, seq, session_run_id
          FROM session_message
          ORDER BY seq
        `,
      )
      .all<{ id: string; seq: number; session_run_id: string | null }>();
    const session = await database
      .prepare(
        `
          SELECT last_message_at, updated_at
          FROM session
          WHERE id = 'session-1'
        `,
      )
      .first<{ last_message_at: number; updated_at: number }>();

    expect(messages.results).toEqual([
      { id: "message-1", seq: 1, session_run_id: null },
      { id: "message-2", seq: 2, session_run_id: "run-1" },
    ]);
    expect(session?.last_message_at).toBeGreaterThan(0);
    expect(session?.updated_at).toBe(session?.last_message_at);
  });

  test("keeps monotonic message sequences with holes after insert failures", async () => {
    const database = createSessionMessageStoreDatabase();

    await insertSessionMessage(database, {
      content: "hello",
      createdByAccountId: "account-1",
      id: "message-1",
      role: "user",
      sessionId: "session-1",
    });

    await expect(
      insertSessionMessage(database, {
        content: "duplicate",
        createdByAccountId: "account-1",
        id: "message-1",
        role: "assistant",
        sessionId: "session-1",
      }),
    ).rejects.toThrow();

    await insertSessionMessage(database, {
      content: "hi",
      createdByAccountId: "account-1",
      id: "message-2",
      role: "assistant",
      sessionId: "session-1",
    });

    const messages = await database
      .prepare(
        `
          SELECT id, seq
          FROM session_message
          ORDER BY seq
        `,
      )
      .all<{ id: string; seq: number }>();
    const session = await database
      .prepare(
        `
          SELECT message_seq_cursor
          FROM session
          WHERE id = 'session-1'
        `,
      )
      .first<{ message_seq_cursor: number }>();

    expect(messages.results).toEqual([
      { id: "message-1", seq: 1 },
      { id: "message-2", seq: 3 },
    ]);
    expect(session?.message_seq_cursor).toBe(3);
  });
});
