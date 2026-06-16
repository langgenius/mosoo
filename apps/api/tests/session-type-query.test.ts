import { describe, expect, test } from "bun:test";

import type { SessionType } from "@mosoo/contracts/session";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  SESSION_SUMMARY_LIST_LIMIT,
  listSessions,
} from "../src/modules/sessions/application/session-summary-query.service";
import { listThreadAgentSessions } from "../src/modules/sessions/application/thread-agent-session-list.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "account-1",
  imageUrl: null,
  name: "Viewer",
};

const ORGANIZATION_ID = "01J00000000000000000000006";
const APP_ID = "01J0000000000000000000000Q";
const PREVIEW_SESSION_ID = "01J0000000000000000000A900";
const UI_SESSION_ID = "01J0000000000000000000A901";
const ATTRIBUTED_SESSION_ID = "01J0000000000000000000A902";
const EXTRA_SESSION_ID_PREFIX = "01J0000000000000000000A";

function extraSessionId(index: number): string {
  return `${EXTRA_SESSION_ID_PREFIX}${String(index).padStart(3, "0")}`;
}

function createSessionTypeDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
	    CREATE TABLE organization (
	      id text PRIMARY KEY NOT NULL,
	      name text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
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

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      app_id text NOT NULL,
      creator_account_id text NOT NULL,
      attributed_user_id text,
      agent_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      kind text NOT NULL,
      last_message_at integer,
      last_run_id text,
      metadata_json text,
      model text NOT NULL,
      provider text NOT NULL,
      renamed integer DEFAULT 0 NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text,
      type text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      archived_at integer
    );

    CREATE TABLE session_run (
      id text PRIMARY KEY NOT NULL,
      session_id text,
      agent_id text,
      created_by_account_id text,
      deployment_version_id text,
      deployment_version_number integer,
      trigger text,
      status text,
      provider text,
      model text,
      trace_id text,
      error_code text,
      error_message text,
      error_details_json text,
      started_at integer,
      completed_at integer,
      created_at integer,
      updated_at integer
    );

	    INSERT INTO organization (
	      id,
	      name,
	      created_at,
      updated_at
	    ) VALUES (
	      '${ORGANIZATION_ID}',
	      'Test Org',
      1,
      1
    );

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      created_at,
      updated_at
    ) VALUES (
      '${APP_ID}',
      '${ORGANIZATION_ID}',
      'account-1',
      'Default App',
      1,
      1
    );
  `);

  insertSession(database, {
    id: PREVIEW_SESSION_ID,
    title: "Preview debug session",
    type: "preview",
    updatedAt: 3,
  });
  insertSession(database, {
    id: UI_SESSION_ID,
    title: "Published UI session",
    type: "ui",
    updatedAt: 2,
  });

  return database;
}

function insertSession(
  database: SqliteD1Database,
  input: {
    id: string;
    title: string;
    type: SessionType;
    updatedAt: number;
  },
): void {
  database.execute(`
    INSERT INTO session (
      id,
      app_id,
      creator_account_id,
      agent_id,
      kind,
      model,
      provider,
      renamed,
      runtime_id,
      status,
      title,
      type,
      created_at,
      updated_at
    ) VALUES (
      '${input.id}',
      '${APP_ID}',
      'account-1',
      '01J00000000000000000000009',
      'pet',
      'gpt-5.1',
      'openai',
      0,
      'openai-runtime',
      'IDLE',
      '${input.title}',
      '${input.type}',
      1,
      ${input.updatedAt}
    );
  `);
}

function findCapability(
  node: Awaited<ReturnType<typeof listThreadAgentSessions>>["nodes"][number],
  action: string,
) {
  return node.capabilities.find((capability) => capability.action === action) ?? null;
}

describe("session type queries", () => {
  test("lists only sessions with the requested type", async () => {
    const sessions = await listSessions(createSessionTypeDatabase(), VIEWER, {
      archived: false,
      appId: APP_ID,
      type: "preview",
    });

    expect(sessions.nodes.map((session) => [session.id, session.type])).toEqual([
      [PREVIEW_SESSION_ID, "preview"],
    ]);
  });

  test("lists all visible session summaries", async () => {
    const sessions = await listSessions(createSessionTypeDatabase(), VIEWER, {
      archived: false,
      appId: APP_ID,
      type: null,
    });

    expect(sessions.nodes.map((session) => session.id)).toEqual([
      PREVIEW_SESSION_ID,
      UI_SESSION_ID,
    ]);
  });

  test("lists thread sessions with row capability state", async () => {
    const database = createSessionTypeDatabase();
    insertSession(database, {
      id: ATTRIBUTED_SESSION_ID,
      title: "Attributed UI session",
      type: "ui",
      updatedAt: 4,
    });
    database.execute(`
      UPDATE session
         SET creator_account_id = 'owner-1',
             attributed_user_id = 'account-1'
       WHERE id = '${ATTRIBUTED_SESSION_ID}'
    `);

    const sessions = await listThreadAgentSessions(database, VIEWER, {
      archived: false,
      appId: APP_ID,
      type: "ui",
    });
    const attributed = sessions.nodes.find((node) => node.session.id === ATTRIBUTED_SESSION_ID);
    const creator = sessions.nodes.find((node) => node.session.id === UI_SESSION_ID);

    expect(sessions.nodes.map((node) => node.session.id)).toEqual([
      ATTRIBUTED_SESSION_ID,
      UI_SESSION_ID,
    ]);
    expect(creator && findCapability(creator, "archive_session")).toMatchObject({
      status: "available",
    });
    expect(creator && findCapability(creator, "delete_session")).toMatchObject({
      status: "available",
    });
    expect(attributed && findCapability(attributed, "archive_session")).toMatchObject({
      reason: "Only the session creator can mutate this session.",
      status: "unavailable",
    });
    expect(attributed && findCapability(attributed, "delete_session")).toMatchObject({
      reason: "Only the session creator can mutate this session.",
      status: "unavailable",
    });
  });

  test("bounds app session summaries on stable updated ordering", async () => {
    const database = createSessionTypeDatabase();

    for (let index = 0; index < SESSION_SUMMARY_LIST_LIMIT + 5; index += 1) {
      const suffix = String(index).padStart(3, "0");

      insertSession(database, {
        id: extraSessionId(index),
        title: `Extra session ${suffix}`,
        type: "ui",
        updatedAt: 10 + index,
      });
    }

    const sessions = await listSessions(database, VIEWER, {
      archived: false,
      appId: APP_ID,
      type: null,
    });

    expect(sessions.nodes).toHaveLength(SESSION_SUMMARY_LIST_LIMIT);
    expect(sessions.nodes[0]?.id).toBe(extraSessionId(104));
    expect(sessions.nodes.at(-1)?.id).toBe(extraSessionId(5));
    expect(sessions.pageInfo).toMatchObject({
      endCursor: `15:${extraSessionId(5)}`,
      hasMore: true,
      startCursor: `114:${extraSessionId(104)}`,
    });
  });

  test("pages app session summaries from the returned cursor", async () => {
    const database = createSessionTypeDatabase();

    for (let index = 0; index < 5; index += 1) {
      const suffix = String(index).padStart(3, "0");

      insertSession(database, {
        id: extraSessionId(index),
        title: `Extra session ${suffix}`,
        type: "ui",
        updatedAt: 10,
      });
    }

    const firstPage = await listSessions(database, VIEWER, {
      archived: false,
      limit: 2,
      appId: APP_ID,
      type: null,
    });
    const secondPage = await listSessions(database, VIEWER, {
      archived: false,
      beforeCursor: firstPage.pageInfo.endCursor,
      limit: 2,
      appId: APP_ID,
      type: null,
    });

    expect(firstPage.nodes.map((session) => session.id)).toEqual([
      extraSessionId(4),
      extraSessionId(3),
    ]);
    expect(firstPage.pageInfo).toMatchObject({
      endCursor: `10:${extraSessionId(3)}`,
      hasMore: true,
      startCursor: `10:${extraSessionId(4)}`,
    });
    expect(secondPage.nodes.map((session) => session.id)).toEqual([
      extraSessionId(2),
      extraSessionId(1),
    ]);
    expect(secondPage.pageInfo).toMatchObject({
      endCursor: `10:${extraSessionId(1)}`,
      hasMore: true,
      startCursor: `10:${extraSessionId(2)}`,
    });
  });

  test("rejects invalid session summary page inputs", async () => {
    await expect(
      listSessions(createSessionTypeDatabase(), VIEWER, {
        limit: 0,
        appId: APP_ID,
        type: null,
      }),
    ).rejects.toThrow("Session list limit must be a positive integer.");

    await expect(
      listSessions(createSessionTypeDatabase(), VIEWER, {
        beforeCursor: "10:not-a-ulid",
        appId: APP_ID,
        type: null,
      }),
    ).rejects.toThrow("Session list cursor ID must be a valid ULID.");
  });
});
