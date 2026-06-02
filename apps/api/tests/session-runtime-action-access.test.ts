import { describe, expect, test } from "bun:test";

import {
  ensureActiveSessionParticipantAccess,
  getActiveSessionQueueAccess,
} from "../src/modules/sessions/domain/session-access.policy";
import { SqliteD1Database } from "./helpers/sqlite-d1";

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
      organization_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text,
      type text NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
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
      organization_id,
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
      '01J00000000000000000000006',
      'openai',
      'openai-runtime',
      'IDLE',
      'Runtime session',
      'preview'
    );

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    ) VALUES (
      '01J00000000000000000000006',
      'viewer-1',
      'member',
      NULL
    );
  `);

  return database;
}

describe("session runtime action access", () => {
  test("admits active session participants", async () => {
    const database = createRuntimeActionAccessDatabase();

    await expect(
      ensureActiveSessionParticipantAccess(database, "viewer-1", "session-1"),
    ).resolves.toBeUndefined();
  });

  test("queue access returns the execution payload", async () => {
    const database = createRuntimeActionAccessDatabase();

    const access = await getActiveSessionQueueAccess(database, "viewer-1", "session-1");

    expect(access).toEqual({
      agent_id: "01J00000000000000000000009",
      deployment_version_id: "01J0000000000000000000000A",
      deployment_version_number: 1,
      id: "session-1",
      model: "gpt-5.4",
      organization_id: "01J00000000000000000000006",
      provider: "openai",
      runtime_id: "openai-runtime",
    });
  });

  test("denies historical participants after membership is disabled or removed", async () => {
    const database = createRuntimeActionAccessDatabase();

    await database
      .prepare(
        `
          UPDATE organization_member
             SET disabled_at = 2
           WHERE organization_id = ?
             AND account_id = ?
        `,
      )
      .bind("01J00000000000000000000006", "viewer-1")
      .run();

    await expect(
      ensureActiveSessionParticipantAccess(database, "viewer-1", "session-1"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    await database
      .prepare(
        `
          DELETE FROM organization_member
           WHERE organization_id = ?
             AND account_id = ?
        `,
      )
      .bind("01J00000000000000000000006", "viewer-1")
      .run();

    await expect(
      ensureActiveSessionParticipantAccess(database, "viewer-1", "session-1"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
