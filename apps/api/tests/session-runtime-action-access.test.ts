import { describe, expect, test } from "bun:test";

import {
  getActiveAppSessionParticipantAccess,
  getActiveAppSessionQueueAccess,
} from "../src/modules/sessions/domain/session-access.policy";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const APP_ID = "01J0000000000000000000000Q";
const WRONG_APP_ID = "01J0000000000000000000000R";

function createRuntimeActionAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      archived_at integer,
      attributed_user_id text,
      creator_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      model text NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      app_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text,
      type text NOT NULL
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    INSERT INTO session (
      id,
      agent_id,
      archived_at,
      attributed_user_id,
      creator_account_id,
      deployment_version_id,
      deployment_version_number,
      model,
      app_id,
      provider,
      runtime_id,
      status,
      title,
      type
    ) VALUES (
      'session-1',
      '01J00000000000000000000009',
      NULL,
      NULL,
      'viewer-1',
      '01J0000000000000000000000A',
      1,
      'gpt-5.4',
      '${APP_ID}',
      'openai',
      'openai-runtime',
      'IDLE',
      'Runtime session',
      'preview'
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
      '01J00000000000000000000006',
      'viewer-1',
      'Default App',
      NULL,
      1,
      1
    ), (
      '${WRONG_APP_ID}',
      '01J00000000000000000000006',
      'viewer-1',
      'Wrong App',
      NULL,
      1,
      1
    );
  `);

  return database;
}

describe("session runtime action access", () => {
  test("admits active session participants", async () => {
    const database = createRuntimeActionAccessDatabase();

    await expect(
      getActiveAppSessionParticipantAccess(database, "viewer-1", {
        appId: APP_ID,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      app_id: APP_ID,
    });
  });

  test("queue access returns the execution payload", async () => {
    const database = createRuntimeActionAccessDatabase();

    const access = await getActiveAppSessionQueueAccess(database, "viewer-1", {
      appId: APP_ID,
      sessionId: "session-1",
    });

    expect(access).toEqual({
      agent_id: "01J00000000000000000000009",
      deployment_version_id: "01J0000000000000000000000A",
      deployment_version_number: 1,
      id: "session-1",
      model: "gpt-5.4",
      app_id: APP_ID,
      provider: "openai",
      runtime_id: "openai-runtime",
    });
  });

  test("fails closed when the requested App does not own the session", async () => {
    const database = createRuntimeActionAccessDatabase();

    await expect(
      getActiveAppSessionParticipantAccess(database, "viewer-1", {
        appId: WRONG_APP_ID,
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  test("fails closed when the viewer does not own the App", async () => {
    const database = createRuntimeActionAccessDatabase();

    await expect(
      getActiveAppSessionQueueAccess(database, "outsider-1", {
        appId: APP_ID,
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
