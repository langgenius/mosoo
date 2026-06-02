import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  SESSION_THREAD_UI_STATE_LIST_LIMIT,
  listSessionThreadUiStates,
  updateSessionThreadUiState,
} from "../src/modules/sessions/application/session-thread-ui-state.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "viewer-1",
  imageUrl: null,
  name: "Viewer",
};

const READ_AT = "1970-01-01T00:00:01.000Z";

function createSessionThreadUiStateDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL,
      join_policy text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      joined_at integer NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      archived_at integer,
      attributed_user_id text,
      creator_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      organization_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text
    );

    CREATE TABLE session_thread_ui_state (
      account_id text NOT NULL,
      pinned integer DEFAULT false NOT NULL,
      read_at integer,
      session_id text NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (account_id, session_id)
    );

    INSERT INTO organization (
      id,
      join_policy,
      name,
      slug,
      created_at,
      updated_at
    ) VALUES (
      '01J00000000000000000000006',
      'invite_only',
      'Test Org',
      'test-org',
      1,
      1
    );

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      joined_at
    ) VALUES (
      '01J00000000000000000000006',
      'viewer-1',
      'member',
      1
    );

    INSERT INTO session (
      id,
      agent_id,
      attributed_user_id,
      creator_account_id,
      metadata_json,
      model,
      organization_id,
      provider,
      runtime_id,
      status,
      title
    ) VALUES (
      'session-1',
      '01J00000000000000000000009',
      NULL,
      'viewer-1',
      '{}',
      'model-1',
      '01J00000000000000000000006',
      'openai',
      'openai-runtime',
      'IDLE',
      'Thread session'
    );
  `);

  return database;
}

function insertSessionThreadUiState(
  database: SqliteD1Database,
  input: {
    sessionId: string;
    updatedAt: number;
  },
): void {
  database.execute(`
    INSERT INTO session (
      id,
      agent_id,
      attributed_user_id,
      creator_account_id,
      metadata_json,
      model,
      organization_id,
      provider,
      runtime_id,
      status,
      title
    ) VALUES (
      '${input.sessionId}',
      '01J00000000000000000000009',
      NULL,
      'viewer-1',
      '{}',
      'model-1',
      '01J00000000000000000000006',
      'openai',
      'openai-runtime',
      'IDLE',
      'Thread session'
    );

    INSERT INTO session_thread_ui_state (
      account_id,
      pinned,
      read_at,
      session_id,
      updated_at
    ) VALUES (
      'viewer-1',
      0,
      NULL,
      '${input.sessionId}',
      ${input.updatedAt}
    );
  `);
}

describe("session thread UI state", () => {
  test("updates and preserves partial thread UI state", async () => {
    const database = createSessionThreadUiStateDatabase();

    const initial = await updateSessionThreadUiState({
      database,
      input: {
        pinned: true,
        readAt: READ_AT,
        sessionId: "session-1",
      },
      viewer: VIEWER,
    });
    const preserved = await updateSessionThreadUiState({
      database,
      input: {
        pinned: null,
        sessionId: "session-1",
      },
      viewer: VIEWER,
    });
    const cleared = await updateSessionThreadUiState({
      database,
      input: {
        pinned: false,
        readAt: null,
        sessionId: "session-1",
      },
      viewer: VIEWER,
    });

    expect(initial.pinned).toBe(true);
    expect(initial.readAt).toBe(READ_AT);
    expect(preserved.pinned).toBe(true);
    expect(preserved.readAt).toBe(READ_AT);
    expect(cleared.pinned).toBe(false);
    expect(cleared.readAt).toBeNull();
  });

  test("bounds thread UI state list on stable updated ordering", async () => {
    const database = createSessionThreadUiStateDatabase();

    for (let index = 0; index < SESSION_THREAD_UI_STATE_LIST_LIMIT + 5; index += 1) {
      const suffix = String(index).padStart(3, "0");

      insertSessionThreadUiState(database, {
        sessionId: `session-extra-${suffix}`,
        updatedAt: 10 + index,
      });
    }

    const states = await listSessionThreadUiStates(database, VIEWER, "01J00000000000000000000006");

    expect(states).toHaveLength(SESSION_THREAD_UI_STATE_LIST_LIMIT);
    expect(states[0]?.sessionId).toBe("session-extra-104");
    expect(states.at(-1)?.sessionId).toBe("session-extra-005");
  });
});
