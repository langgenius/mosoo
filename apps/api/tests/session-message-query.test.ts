import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getThreadSessionMessages } from "../src/modules/sessions/application/session-message-query.service";
import { loadStoredSessionMessages } from "../src/modules/sessions/infrastructure/session-message-snapshot.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const MESSAGE_ID_1 = "01J000000000000000000000G1";
const MESSAGE_ID_2 = "01J000000000000000000000G2";
const ORGANIZATION_ID = "01J00000000000000000000006";
const APP_ID = "01J0000000000000000000000Q";
const RUN_ID = "01J000000000000000000000G3";
const SESSION_ID = "01J000000000000000000000G4";
const VIEWER_ID = "01J000000000000000000000G5";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: VIEWER_ID,
  imageUrl: null,
  name: "Viewer",
};

function createSessionMessageQueryDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      creator_account_id text NOT NULL,
      attributed_user_id text,
      agent_id text NOT NULL,
      archived_at integer,
      deployment_version_id text,
      deployment_version_number integer,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      app_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_message (
      id text PRIMARY KEY NOT NULL,
      content_text text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      plan_json text,
      role text NOT NULL,
      segments_json text,
      seq integer NOT NULL,
      session_id text NOT NULL,
      session_run_id text
    );

    INSERT INTO session (
      id,
      creator_account_id,
      attributed_user_id,
      agent_id,
      archived_at,
      deployment_version_id,
      deployment_version_number,
      metadata_json,
      model,
      app_id,
      provider,
      runtime_id,
      status,
      title
    ) VALUES (
      '${SESSION_ID}',
      '${VIEWER_ID}',
      NULL,
      '01J00000000000000000000009',
      NULL,
      NULL,
      NULL,
      '{}',
      'model-1',
      '${APP_ID}',
      'openai',
      'openai-runtime',
      'IDLE',
      'Thread session'
    );

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      default_environment_id,
      created_at,
      updated_at
    ) VALUES (
      '${APP_ID}',
      '${ORGANIZATION_ID}',
      '${VIEWER_ID}',
      'Default App',
      NULL,
      1,
      1
    );

    INSERT INTO session_message (
      id,
      content_text,
      created_at,
      created_by_account_id,
      plan_json,
      role,
      segments_json,
      seq,
      session_id,
      session_run_id
    ) VALUES (
      '${MESSAGE_ID_1}',
      'Hello from the thread',
      1000,
      '${VIEWER_ID}',
      NULL,
      'user',
      NULL,
      1,
      '${SESSION_ID}',
      NULL
    ), (
      '${MESSAGE_ID_2}',
      'Earlier timestamp, later sequence',
      500,
      '${VIEWER_ID}',
      NULL,
      'assistant',
      NULL,
      2,
      '${SESSION_ID}',
      '${RUN_ID}'
    );
  `);

  return database;
}

describe("session message query", () => {
  test("admits thread transcript reads in message sequence order", async () => {
    const database = createSessionMessageQueryDatabase();

    const messages = await getThreadSessionMessages(database, VIEWER, {
      appId: APP_ID,
      sessionId: SESSION_ID,
    });

    expect(messages).toEqual([
      {
        content: "Hello from the thread",
        createdAt: "1970-01-01T00:00:01.000Z",
        createdBy: VIEWER_ID,
        id: MESSAGE_ID_1,
        plan: [],
        role: "user",
        segments: [],
      },
      {
        content: "Earlier timestamp, later sequence",
        createdAt: "1970-01-01T00:00:00.500Z",
        createdBy: VIEWER_ID,
        id: MESSAGE_ID_2,
        plan: [],
        role: "assistant",
        segments: [],
      },
    ]);
  });

  test("loads live-state transcript snapshots in message sequence order", async () => {
    const database = createSessionMessageQueryDatabase();

    const messages = await loadStoredSessionMessages(database, SESSION_ID);

    expect(messages.map((message) => message.id)).toEqual([MESSAGE_ID_1, MESSAGE_ID_2]);
  });
});
