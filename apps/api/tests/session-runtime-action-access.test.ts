import { describe, expect, test } from "bun:test";

import {
  getActiveProjectSessionParticipantAccess,
  getActiveProjectSessionQueueAccess,
} from "../src/modules/sessions/domain/session-access.policy";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const PROJECT_ID = "01J0000000000000000000000Q";
const WRONG_PROJECT_ID = "01J0000000000000000000000R";

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
      project_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text,
      type text NOT NULL
    );

    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
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
      project_id,
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
      '${PROJECT_ID}',
      'openai',
      'openai-runtime',
      'IDLE',
      'Runtime session',
      'preview'
    );

    INSERT INTO project (
      id,
      organization_id,
      owner_account_id,
      name,
      default_environment_id,
      created_at,
      updated_at
    ) VALUES (
      '${PROJECT_ID}',
      '01J00000000000000000000006',
      'viewer-1',
      'Default Project',
      NULL,
      1,
      1
    ), (
      '${WRONG_PROJECT_ID}',
      '01J00000000000000000000006',
      'viewer-1',
      'Wrong Project',
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
      getActiveProjectSessionParticipantAccess(database, "viewer-1", {
        projectId: PROJECT_ID,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      project_id: PROJECT_ID,
    });
  });

  test("queue access returns the execution payload", async () => {
    const database = createRuntimeActionAccessDatabase();

    const access = await getActiveProjectSessionQueueAccess(database, "viewer-1", {
      projectId: PROJECT_ID,
      sessionId: "session-1",
    });

    expect(access).toEqual({
      agent_id: "01J00000000000000000000009",
      deployment_version_id: "01J0000000000000000000000A",
      deployment_version_number: 1,
      id: "session-1",
      model: "gpt-5.4",
      project_id: PROJECT_ID,
      provider: "openai",
      runtime_id: "openai-runtime",
    });
  });

  test("fails closed when the requested Project does not own the session", async () => {
    const database = createRuntimeActionAccessDatabase();

    await expect(
      getActiveProjectSessionParticipantAccess(database, "viewer-1", {
        projectId: WRONG_PROJECT_ID,
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  test("fails closed when the viewer does not own the Project", async () => {
    const database = createRuntimeActionAccessDatabase();

    await expect(
      getActiveProjectSessionQueueAccess(database, "outsider-1", {
        projectId: PROJECT_ID,
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
