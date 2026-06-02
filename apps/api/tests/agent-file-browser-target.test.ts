import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { resolveAgentFileBrowserTarget } from "../src/modules/runtime/application/agent-file-browser-target.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

const AGENT_ID = "01J00000000000000000000009";
const SANDBOX_ID = "01J0000000000000000000000A";

function createAgentFileBrowserDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE agent (
      config_json text NOT NULL,
      created_at integer NOT NULL,
      description text,
      environment_id text,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      live_deployment_version_id text,
      model text NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL,
      visibility text NOT NULL
    );

    CREATE TABLE organization_member (
      account_id text NOT NULL,
      disabled_at integer,
      organization_id text NOT NULL,
      role text NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      last_error text,
      status text NOT NULL,
      subject_id text NOT NULL,
      subject_kind text NOT NULL
    );

    INSERT INTO organization_member (organization_id, account_id, role, disabled_at)
    VALUES ('01J00000000000000000000006', '01J00000000000000000000001', 'member', NULL);

    INSERT INTO agent (
      config_json,
      created_at,
      id,
      kind,
      model,
      name,
      organization_id,
      owner_account_id,
      prompt,
      provider,
      runtime_id,
      status,
      updated_at,
      visibility
    )
    VALUES (
      '{}',
      1,
      '${AGENT_ID}',
      'pet',
      'gpt-5.4',
      'File Browser Agent',
      '01J00000000000000000000006',
      '01J00000000000000000000001',
      'Help',
      'openai',
      'openai-runtime',
      'draft',
      1,
      'private'
    );

    INSERT INTO sandbox (
      id,
      kind,
      last_error,
      status,
      subject_id,
      subject_kind
    )
    VALUES (
      '${SANDBOX_ID}',
      'pet',
      NULL,
      'active',
      '${AGENT_ID}',
      'agent'
    );
  `);

  return database;
}

describe("agent file browser target", () => {
  test("resolves owner access and sandbox state", async () => {
    const database = createAgentFileBrowserDatabase();

    const target = await resolveAgentFileBrowserTarget(database, VIEWER, AGENT_ID);

    expect(target.agent.id).toBe(AGENT_ID);
    expect(target.sandbox).toEqual({
      id: SANDBOX_ID,
      lastError: null,
      status: "active",
    });
    expect(target.unavailableSandbox).toBeNull();
    expect(target.subject).toEqual({
      kind: "pet",
      subjectId: AGENT_ID,
      subjectKind: "agent",
    });
  });

  test("rejects legacy sandbox IDs before API serialization", async () => {
    const database = createAgentFileBrowserDatabase();
    await database.prepare("UPDATE sandbox SET id = ?").bind(`pet-agent-${AGENT_ID}`).run();

    const target = await resolveAgentFileBrowserTarget(database, VIEWER, AGENT_ID);

    expect(target.sandbox).toBeNull();
    expect(target.unavailableSandbox).toEqual({
      lastError: "Sandbox ID is not canonical. Recreate the agent sandbox to use file browser.",
      status: "unsupported",
    });
  });
});
