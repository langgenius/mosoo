import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { SessionSummaryRow } from "../src/modules/sessions/application/session-summary-query.service";
import { hydrateSessionSummariesFromRows } from "../src/modules/sessions/application/session-summary-query.service";
import {
  autoTitleSession,
  renameSession,
} from "../src/modules/sessions/application/session-title.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Viewer",
};
const SESSION_ID = "01J0000000000000000000000B";
const OTHER_SESSION_ID = "01J0000000000000000000000C";

function createSessionTitleMutationDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      archived_at integer,
      attributed_user_id text,
      created_at integer NOT NULL,
      creator_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      kind text NOT NULL,
      last_message_at integer,
      last_run_id text,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      organization_id text NOT NULL,
      provider text NOT NULL,
      renamed integer DEFAULT false NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text,
      type text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE session_run (
      id text PRIMARY KEY NOT NULL,
      completed_at integer,
      created_at integer,
      deployment_version_id text,
      deployment_version_number integer,
      error_code text,
      error_details_json text,
      error_message text,
      model text,
      provider text,
      session_id text,
      started_at integer,
      status text,
      trace_id text,
      trigger text,
      updated_at integer
    );

    INSERT INTO session (
      id,
      agent_id,
      created_at,
      creator_account_id,
      deployment_version_id,
      deployment_version_number,
      kind,
      metadata_json,
      model,
      organization_id,
      provider,
      runtime_id,
      status,
      title,
      type,
      updated_at
    ) VALUES (
      '${SESSION_ID}',
      '01J00000000000000000000009',
      1,
      '${VIEWER.id}',
      '01J0000000000000000000000A',
      1,
      'pet',
      '{}',
      'gpt-5.4',
      '01J00000000000000000000006',
      'openai',
      'openai-runtime',
      'IDLE',
      NULL,
      'preview',
      1
    );

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    ) VALUES (
      '01J00000000000000000000006',
      '${VIEWER.id}',
      'member',
      NULL
    );
  `);

  return database;
}

function createSummaryRow(input: {
  id: string;
  lastRunId: string | null;
  title: string | null;
}): SessionSummaryRow {
  return {
    agent_id: "01J00000000000000000000009",
    archived_at: null,
    created_at: 1,
    deployment_version_id: "01J0000000000000000000000A",
    deployment_version_number: 1,
    id: input.id,
    kind: "pet",
    last_message_at: null,
    last_run_id: input.lastRunId,
    model: "gpt-5.4",
    organization_id: "01J00000000000000000000006",
    provider: "openai",
    runtime_id: "openai-runtime",
    status: "IDLE",
    title: input.title,
    type: "preview",
    updated_at: 1,
  };
}

describe("session title mutations", () => {
  test("renames and returns the updated title", async () => {
    const database = createSessionTitleMutationDatabase();

    const session = await renameSession({
      database,
      input: {
        sessionId: SESSION_ID,
        title: "Renamed session",
      },
      viewer: VIEWER,
    });

    expect(session.title).toBe("Renamed session");
  });

  test("auto-titles and returns the updated title", async () => {
    const database = createSessionTitleMutationDatabase();

    const session = await autoTitleSession(database, VIEWER, {
      sessionId: SESSION_ID,
      title: "Auto title",
    });

    expect(session.title).toBe("Auto title");
  });

  test("hydrates updated summary rows with their last runs", async () => {
    const database = createSessionTitleMutationDatabase();

    database.execute(`
      INSERT INTO session_run (
        id,
        created_at,
        model,
        provider,
        session_id,
        status,
        trace_id,
        trigger,
        updated_at
      ) VALUES
        ('run-1', 2, 'gpt-5.4', 'openai', '${SESSION_ID}', 'running', 'trace-1', 'user_message', 2),
        ('run-2', 3, 'gpt-5.4', 'openai', '${OTHER_SESSION_ID}', 'completed', 'trace-2', 'system', 3)
    `);

    const summaries = await hydrateSessionSummariesFromRows(database, [
      createSummaryRow({ id: SESSION_ID, lastRunId: "run-1", title: "First" }),
      createSummaryRow({ id: OTHER_SESSION_ID, lastRunId: "run-2", title: "Second" }),
    ]);

    expect(summaries.map((summary) => summary.lastRun?.id)).toEqual(["run-1", "run-2"]);
  });
});
