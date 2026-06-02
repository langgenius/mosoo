import { describe, expect, test } from "bun:test";

import {
  addAgentCollaborator,
  updateAgentCollaborator,
} from "../src/modules/agents/application/agent-collaborator.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

function createAgentCollaboratorDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      image_url text,
      name text
    );

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

    CREATE TABLE resource_acl (
      assigned_by_account_id text,
      created_at integer NOT NULL,
      resource_id text NOT NULL,
      resource_type text NOT NULL,
      role text NOT NULL,
      target_id text NOT NULL,
      target_kind text NOT NULL,
      PRIMARY KEY (resource_type, resource_id, target_kind, target_id)
    );

    CREATE TABLE audit_event (
      action text NOT NULL,
      after_json text,
      actor_display text NOT NULL,
      actor_id text,
      actor_type text NOT NULL,
      before_json text,
      correlation_id text,
      id text PRIMARY KEY NOT NULL,
      ip_address text,
      metadata_json text,
      organization_id text NOT NULL,
      outcome text NOT NULL,
      resource_display text,
      resource_id text,
      resource_type text NOT NULL,
      session_id text,
      timestamp integer NOT NULL,
      user_agent text
    );

    CREATE TABLE agent_mcp_binding (
      agent_id text NOT NULL,
      server_id text NOT NULL
    );

    CREATE TABLE mcp_server (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL
    );

    INSERT INTO account (id, email, image_url, name)
    VALUES
      ('01J00000000000000000000001', 'owner@example.com', NULL, 'Owner'),
      ('01J00000000000000000000002', 'member@example.com', NULL, 'Member');

    INSERT INTO organization_member (organization_id, account_id, role, disabled_at)
    VALUES
      ('01J00000000000000000000006', '01J00000000000000000000001', 'member', NULL),
      ('01J00000000000000000000006', '01J00000000000000000000002', 'member', NULL);

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
    VALUES
      ('{}', 1, '01J00000000000000000000009', 'pet', 'gpt-5.4', 'Agent', '01J00000000000000000000006', '01J00000000000000000000001', 'Help', 'openai', 'openai-runtime', 'published', 1, 'private');
  `);

  return database;
}

async function getAgentCollaboratorRole(database: SqliteD1Database): Promise<string | null> {
  const row = await database
    .prepare(
      `
        SELECT role
        FROM resource_acl
        WHERE resource_type = 'agent'
          AND resource_id = '01J00000000000000000000009'
          AND target_kind = 'user'
          AND target_id = '01J00000000000000000000002'
      `,
    )
    .first<{ role: string }>();

  return row?.role ?? null;
}

describe("agent collaborators", () => {
  test("keeps add idempotent and reserves role changes for update", async () => {
    const database = createAgentCollaboratorDatabase();

    await addAgentCollaborator(database, OWNER_VIEWER, {
      agentId: "01J00000000000000000000009",
      principal: "01J00000000000000000000002",
      role: "user",
    });

    await addAgentCollaborator(database, OWNER_VIEWER, {
      agentId: "01J00000000000000000000009",
      principal: "01J00000000000000000000002",
      role: "admin",
    });

    expect(await getAgentCollaboratorRole(database)).toBe("user");

    await updateAgentCollaborator(database, OWNER_VIEWER, {
      agentId: "01J00000000000000000000009",
      principal: "01J00000000000000000000002",
      role: "admin",
    });

    expect(await getAgentCollaboratorRole(database)).toBe("admin");
  });
});
