import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  retrieveAgentSession,
  retrieveThreadAgentSession,
} from "../src/modules/sessions/application/agent-session-retrieve.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "viewer-1",
  imageUrl: null,
  name: "Viewer",
};

const APP_ID = "01J0000000000000000000000Q";

function createAgentSessionRetrieveDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE session (
      agent_id text NOT NULL,
      archived_at integer,
      attributed_user_id text,
      created_at integer NOT NULL,
      creator_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      last_message_at integer,
      last_run_id text,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      app_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text,
      type text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_run (
      completed_at integer,
      created_at integer,
      deployment_version_id text,
      deployment_version_number integer,
      error_code text,
      error_details_json text,
      error_message text,
      id text PRIMARY KEY NOT NULL,
      model text,
      provider text,
      started_at integer,
      status text,
      trace_id text,
      trigger text,
      updated_at integer
    );

    INSERT INTO session (
      agent_id,
      created_at,
      creator_account_id,
      id,
      kind,
      metadata_json,
      model,
      app_id,
      provider,
      runtime_id,
      status,
      title,
      type,
      updated_at
    )
    VALUES (
      '01J00000000000000000000009',
      1,
      'viewer-1',
      'session-1',
      'pet',
      '{}',
      'gpt-5.4',
      '${APP_ID}',
      'openai',
      'openai-runtime',
      'IDLE',
      'Session',
      'preview',
      1
    );

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      slug,
      created_at,
      updated_at
    ) VALUES (
      '${APP_ID}',
      '01J00000000000000000000006',
      'viewer-1',
      'Default App',
      'default',
      1,
      1
    );
  `);

  return database;
}

describe("agent session retrieve", () => {
  test("computes creator capabilities from the retrieved session", async () => {
    const database = createAgentSessionRetrieveDatabase();

    const result = await retrieveAgentSession(database, VIEWER, {
      appId: APP_ID,
      sessionId: "session-1",
    });

    expect(result.session.id).toBe("session-1");
    expect(
      result.capabilities.some((capability) => capability.action === "send_user_message"),
    ).toBe(true);
  });

  test("loads thread retrieve summaries for the creator", async () => {
    const database = createAgentSessionRetrieveDatabase();

    const result = await retrieveThreadAgentSession(database, VIEWER, {
      appId: APP_ID,
      sessionId: "session-1",
    });

    expect(result.session.id).toBe("session-1");
  });

  test("apps terminal cleanup rows as not recoverable even with archive marker", async () => {
    const database = createAgentSessionRetrieveDatabase();

    await database
      .prepare("UPDATE session SET archived_at = ?, status = ? WHERE id = ?")
      .bind(2, "TERMINATED", "session-1")
      .run();

    const result = await retrieveAgentSession(database, VIEWER, {
      appId: APP_ID,
      sessionId: "session-1",
    });
    const capabilities = new Map(
      result.capabilities.map((capability) => [capability.action, capability]),
    );

    expect(result.recoverability).toMatchObject({
      status: "not_recoverable",
    });
    expect(result.recoverability.reason).toBeString();
    expect(result.recoverability.reason.length).toBeGreaterThan(0);
    expect(capabilities.get("unarchive_session")).toMatchObject({
      status: "unavailable",
    });
    expect(capabilities.get("unarchive_session")?.reason).toBeString();
    expect(capabilities.get("delete_session")).toMatchObject({
      reason: null,
      status: "available",
    });
  });

  test("does not treat unsupported public API creator metadata as a human thread creator", async () => {
    const database = createAgentSessionRetrieveDatabase();

    await database
      .prepare("UPDATE session SET metadata_json = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          public_api: {
            client_external_ref: null,
            created_by: {
              id: "01J00000000000000000000067",
              kind: "machine",
              token_id: "01J00000000000000000000067",
              token_label: "Automation",
            },
            source: "public_api",
          },
        }),
        "session-1",
      )
      .run();

    await expect(
      retrieveThreadAgentSession(database, VIEWER, {
        appId: APP_ID,
        sessionId: "session-1",
      }),
    ).rejects.toThrow();
  });
});
