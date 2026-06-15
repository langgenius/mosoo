import { describe, expect, test } from "bun:test";

import type { AgentRow } from "../src/modules/agents/application/agent-types";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  listAgentMcpServerIds,
  replaceAgentMcpBindingsForConfig,
} from "../src/modules/mcp/application/mcp-agent-binding.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const NEEDS_AUTH_MCP_SERVER_ID = "01J0000000000000000000000A";
const FILES_MCP_SERVER_ID = "01J0000000000000000000000B";
const ISSUES_MCP_SERVER_ID = "01J0000000000000000000000C";

function createMcpBindingDatabase(): D1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      created_at integer NOT NULL,
      email text NOT NULL,
      email_verified integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      image_url text,
      last_active_organization_id text,
      name text NOT NULL,
      system_agent_model text,
      updated_at integer NOT NULL
    );

    CREATE TABLE agent (
      config_json text NOT NULL,
      created_at integer NOT NULL,
      description text,
      environment_id text,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL DEFAULT 'pet',
      live_deployment_version_id text,
      model text NOT NULL,
      name text NOT NULL,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      updated_at integer NOT NULL,
      visibility text NOT NULL DEFAULT 'private'
    );

    CREATE TABLE mcp_server (
      auth_type text NOT NULL,
      byo_client_id text,
      byo_client_secret_secret_id text,
      created_at integer NOT NULL,
      credential_scope text NOT NULL,
      description text,
      enabled integer NOT NULL DEFAULT 1,
      icon_url text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      oauth_metadata_json text,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      source text NOT NULL,
      updated_at integer NOT NULL,
      url text NOT NULL
    );

    CREATE TABLE agent_mcp_binding (
      agent_credential_id text,
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      credential_mode text NOT NULL DEFAULT 'runtime_resolved',
      enabled integer NOT NULL DEFAULT 1,
      id text PRIMARY KEY NOT NULL,
      server_id text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      updated_at integer NOT NULL
    );

    CREATE TABLE mcp_credential (
      id text PRIMARY KEY NOT NULL,
      account_id text,
      agent_id text,
      auth_type text NOT NULL,
      created_at integer NOT NULL,
      expires_at integer,
      last_refreshed_at integer,
      oauth_client_id text,
      oauth_client_secret_secret_id text,
      app_id text NOT NULL,
      refresh_secret_id text,
      scope text NOT NULL,
      scope_values_json text,
      secret_id text NOT NULL,
      server_id text NOT NULL,
      status text NOT NULL,
      subject_label text,
      updated_at integer NOT NULL
    );

    INSERT INTO account (
      created_at,
      email,
      email_verified,
      id,
      name,
      updated_at
    )
    VALUES (1, 'owner@mosoo.ai', 1, '01J00000000000000000000001', 'Owner', 1);

    INSERT INTO agent (
      config_json,
      created_at,
      id,
      kind,
      model,
      name,
      owner_account_id,
      app_id,
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
      '01J00000000000000000000009',
      'pet',
      'gpt-5.4',
      'Agent',
      '01J00000000000000000000001',
      '01J00000000000000000000007',
      'Help',
      'openai',
      'openai-runtime',
      'draft',
      1,
      'private'
    );

    INSERT INTO mcp_server (
      auth_type,
      created_at,
      credential_scope,
      description,
      enabled,
      id,
      name,
      owner_account_id,
      app_id,
      source,
      updated_at,
      url
    )
    VALUES
      (
        'oauth',
        1,
        'app',
        'OAuth not connected yet',
        1,
        '${NEEDS_AUTH_MCP_SERVER_ID}',
        'Needs Auth MCP',
        '01J00000000000000000000001',
        '01J00000000000000000000007',
        'app',
        1,
        'https://mcp.example.com'
      ),
      (
        'oauth',
        1,
        'app',
        'OAuth not connected yet',
        1,
        '${FILES_MCP_SERVER_ID}',
        'Files MCP',
        '01J00000000000000000000001',
        '01J00000000000000000000007',
        'app',
        1,
        'https://files.example.com'
      ),
      (
        'oauth',
        1,
        'app',
        'OAuth not connected yet',
        1,
        '${ISSUES_MCP_SERVER_ID}',
        'Issues MCP',
        '01J00000000000000000000001',
        '01J00000000000000000000007',
        'app',
        1,
        'https://issues.example.com'
      );
  `);

  return database;
}

const viewer: AuthenticatedViewer = {
  email: "owner@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

const agent: AgentRow = {
  configJson: "{}",
  createdAt: 1,
  description: null,
  environmentId: null,
  id: "01J00000000000000000000009",
  kind: "pet",
  liveDeploymentVersionId: null,
  model: "gpt-5.4",
  name: "Agent",
  ownerId: "01J00000000000000000000001",
  appId: "01J00000000000000000000007",
  prompt: "Help",
  provider: "openai",
  runtimeId: "openai-runtime",
  status: "draft",
  updatedAt: 1,
  visibility: "private",
};

describe("agent MCP config binding", () => {
  test("writes visible MCP server IDs without requiring credentials", async () => {
    const database = createMcpBindingDatabase();

    await replaceAgentMcpBindingsForConfig(database, viewer, {
      agent,
      serverIds: [NEEDS_AUTH_MCP_SERVER_ID],
      updatedAt: 2,
    });

    await expect(listAgentMcpServerIds(database, agent.id)).resolves.toEqual([
      NEEDS_AUTH_MCP_SERVER_ID,
    ]);
  });

  test("replaces config bindings", async () => {
    const database = createMcpBindingDatabase();

    await replaceAgentMcpBindingsForConfig(database, viewer, {
      agent,
      serverIds: [NEEDS_AUTH_MCP_SERVER_ID, FILES_MCP_SERVER_ID, ISSUES_MCP_SERVER_ID],
      updatedAt: 2,
    });

    await expect(listAgentMcpServerIds(database, agent.id)).resolves.toEqual([
      NEEDS_AUTH_MCP_SERVER_ID,
      FILES_MCP_SERVER_ID,
      ISSUES_MCP_SERVER_ID,
    ]);
  });

  test("replaces existing bindings through the canonical config path", async () => {
    const database = createMcpBindingDatabase();
    await replaceAgentMcpBindingsForConfig(database, viewer, {
      agent,
      serverIds: [NEEDS_AUTH_MCP_SERVER_ID, FILES_MCP_SERVER_ID, ISSUES_MCP_SERVER_ID],
      updatedAt: 2,
    });

    await replaceAgentMcpBindingsForConfig(database, viewer, {
      agent,
      serverIds: [ISSUES_MCP_SERVER_ID, NEEDS_AUTH_MCP_SERVER_ID],
      updatedAt: 3,
    });

    await expect(listAgentMcpServerIds(database, agent.id)).resolves.toEqual([
      ISSUES_MCP_SERVER_ID,
      NEEDS_AUTH_MCP_SERVER_ID,
    ]);
  });
});
