import { describe, expect, test } from "bun:test";

import {
  ensureAgentAccess,
  ensureAgentCostAccess,
  ensureAgentDestructiveAccess,
  ensureAgentEditor,
} from "../src/modules/agents/application/agent-access.service";
import { getAgentRow } from "../src/modules/agents/application/agent-repository";
import {
  admitPublishedAgentCaller,
  ensurePublishedAgentCallerAccess,
} from "../src/modules/public-api/published-agent-admission.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const AGENT_ACCESS_IDS = {
  adminAccount: "01J00000000000000000000013",
  collabAdminAccount: "01J00000000000000000000012",
  liveVersion: "01J00000000000000000000041",
  organization: "01J00000000000000000000006",
  organizationAclAgent: "01J00000000000000000000026",
  organizationOwnerAccount: "01J00000000000000000000014",
  organizationVisibleNoAclAgent: "01J00000000000000000000025",
  ownerAccount: "01J00000000000000000000001",
  ownerAgent: "01J00000000000000000000021",
  personalMcpAgent: "01J00000000000000000000023",
  personalMcpServer: "01J00000000000000000000031",
  removedOwnerAccount: "01J00000000000000000000015",
  removedOwnerAgent: "01J00000000000000000000024",
  sharedAgent: "01J00000000000000000000022",
  viewerAccount: "01J00000000000000000000011",
} as const;

function createAgentAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
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
      created_at integer NOT NULL,
      resource_id text NOT NULL,
      resource_type text NOT NULL,
      role text NOT NULL,
      target_id text NOT NULL,
      target_kind text NOT NULL,
      PRIMARY KEY (resource_type, resource_id, target_kind, target_id)
    );

    CREATE TABLE agent_mcp_binding (
      agent_id text NOT NULL,
      server_id text NOT NULL
    );

    CREATE TABLE mcp_server (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL
    );

    INSERT INTO organization_member (organization_id, account_id, role, disabled_at)
    VALUES
      ('${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.ownerAccount}', 'member', NULL),
      ('${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.viewerAccount}', 'member', NULL),
      ('${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.collabAdminAccount}', 'member', NULL),
      ('${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.adminAccount}', 'admin', NULL),
      ('${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.organizationOwnerAccount}', 'owner', NULL);

    INSERT INTO account (id, image_url, name)
    VALUES
      ('${AGENT_ACCESS_IDS.ownerAccount}', NULL, 'Owner'),
      ('${AGENT_ACCESS_IDS.removedOwnerAccount}', NULL, 'Removed Owner');

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
      ('{}', 1, '${AGENT_ACCESS_IDS.ownerAgent}', 'pet', 'gpt-5.4', 'Owner Agent', '${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.ownerAccount}', 'Help', 'openai', 'openai-runtime', 'draft', 1, 'private'),
      ('{}', 2, '${AGENT_ACCESS_IDS.sharedAgent}', 'pet', 'gpt-5.4', 'Shared Agent', '${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.ownerAccount}', 'Help', 'openai', 'openai-runtime', 'published', 2, 'private'),
      ('{}', 3, '${AGENT_ACCESS_IDS.personalMcpAgent}', 'pet', 'gpt-5.4', 'Personal MCP Agent', '${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.ownerAccount}', 'Help', 'openai', 'openai-runtime', 'published', 3, 'private'),
      ('{}', 4, '${AGENT_ACCESS_IDS.removedOwnerAgent}', 'pet', 'gpt-5.4', 'Removed Owner Agent', '${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.removedOwnerAccount}', 'Help', 'openai', 'openai-runtime', 'draft', 4, 'private'),
      ('{}', 5, '${AGENT_ACCESS_IDS.organizationVisibleNoAclAgent}', 'pet', 'gpt-5.4', 'Visible Without ACL Agent', '${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.ownerAccount}', 'Help', 'openai', 'openai-runtime', 'published', 5, 'organization'),
      ('{}', 6, '${AGENT_ACCESS_IDS.organizationAclAgent}', 'pet', 'gpt-5.4', 'Organization ACL Agent', '${AGENT_ACCESS_IDS.organization}', '${AGENT_ACCESS_IDS.ownerAccount}', 'Help', 'openai', 'openai-runtime', 'published', 6, 'organization');

    INSERT INTO resource_acl (created_at, resource_id, resource_type, role, target_id, target_kind)
    VALUES
      (1, '${AGENT_ACCESS_IDS.sharedAgent}', 'agent', 'user', '${AGENT_ACCESS_IDS.viewerAccount}', 'user'),
      (1, '${AGENT_ACCESS_IDS.personalMcpAgent}', 'agent', 'user', '${AGENT_ACCESS_IDS.viewerAccount}', 'user'),
      (1, '${AGENT_ACCESS_IDS.organizationAclAgent}', 'agent', 'user', '${AGENT_ACCESS_IDS.organization}', 'organization');

    INSERT INTO mcp_server (id, source)
    VALUES ('${AGENT_ACCESS_IDS.personalMcpServer}', 'personal');

    INSERT INTO agent_mcp_binding (agent_id, server_id)
    VALUES ('${AGENT_ACCESS_IDS.personalMcpAgent}', '${AGENT_ACCESS_IDS.personalMcpServer}');

    UPDATE agent
       SET live_deployment_version_id = '${AGENT_ACCESS_IDS.liveVersion}'
     WHERE id = '${AGENT_ACCESS_IDS.sharedAgent}';
  `);

  return database;
}

describe("agent access", () => {
  test("resolves owner editor access", async () => {
    const database = createAgentAccessDatabase();

    const access = await ensureAgentEditor(
      database,
      AGENT_ACCESS_IDS.ownerAccount,
      AGENT_ACCESS_IDS.ownerAgent,
    );

    expect(access.agent.id).toBe(AGENT_ACCESS_IDS.ownerAgent);
    expect(access.viewerRole).toBe("owner");
  });

  test("resolves shared published access with ACL and personal MCP state", async () => {
    const database = createAgentAccessDatabase();

    const agent = await ensureAgentAccess(
      database,
      AGENT_ACCESS_IDS.viewerAccount,
      AGENT_ACCESS_IDS.sharedAgent,
    );

    expect(agent.id).toBe(AGENT_ACCESS_IDS.sharedAgent);
  });

  test("resolves shared cost access without listing collaborators", async () => {
    const database = createAgentAccessDatabase();

    const access = await ensureAgentCostAccess(
      database,
      AGENT_ACCESS_IDS.viewerAccount,
      AGENT_ACCESS_IDS.sharedAgent,
    );

    expect(access.agent.id).toBe(AGENT_ACCESS_IDS.sharedAgent);
    expect(access.viewerRole).toBe("user");
  });

  test("treats organization visibility as display state and requires organization ACL", async () => {
    const database = createAgentAccessDatabase();

    await expect(
      ensureAgentAccess(
        database,
        AGENT_ACCESS_IDS.viewerAccount,
        AGENT_ACCESS_IDS.organizationVisibleNoAclAgent,
      ),
    ).rejects.toThrow();

    const agent = await ensureAgentAccess(
      database,
      AGENT_ACCESS_IDS.viewerAccount,
      AGENT_ACCESS_IDS.organizationAclAgent,
    );

    expect(agent.id).toBe(AGENT_ACCESS_IDS.organizationAclAgent);
  });

  test("denies shared access to agents with personal MCP bindings", async () => {
    const database = createAgentAccessDatabase();

    await expect(
      ensureAgentAccess(
        database,
        AGENT_ACCESS_IDS.viewerAccount,
        AGENT_ACCESS_IDS.personalMcpAgent,
      ),
    ).rejects.toThrow();
  });

  test("allows admin destructive access when the agent owner is no longer active", async () => {
    const database = createAgentAccessDatabase();

    const access = await ensureAgentDestructiveAccess(
      database,
      AGENT_ACCESS_IDS.adminAccount,
      AGENT_ACCESS_IDS.removedOwnerAgent,
    );

    expect(access.agent.id).toBe(AGENT_ACCESS_IDS.removedOwnerAgent);
    expect(access.viewerRole).toBe("admin");
  });

  test("admits published API callers", async () => {
    const database = createAgentAccessDatabase();

    const agent = await admitPublishedAgentCaller(
      database,
      {
        email: "viewer@example.com",
        emailVerified: true,
        id: AGENT_ACCESS_IDS.viewerAccount,
        imageUrl: null,
        name: "Viewer",
      },
      AGENT_ACCESS_IDS.sharedAgent,
    );

    expect(agent.id).toBe(AGENT_ACCESS_IDS.sharedAgent);
  });

  test("checks known published Agent caller access", async () => {
    const database = createAgentAccessDatabase();
    const agent = await getAgentRow(database, AGENT_ACCESS_IDS.sharedAgent);

    await ensurePublishedAgentCallerAccess(
      database,
      {
        email: "viewer@example.com",
        emailVerified: true,
        id: AGENT_ACCESS_IDS.viewerAccount,
        imageUrl: null,
        name: "Viewer",
      },
      agent,
    );
  });

  test("normalizes legacy empty stored config when reading Agent rows", async () => {
    const agent = await getAgentRow(createAgentAccessDatabase(), AGENT_ACCESS_IDS.ownerAgent);

    expect(JSON.parse(agent.configJson)).toEqual({
      builder: {
        componentDecisions: {},
      },
      packageMcpServers: [],
      packageResolution: null,
      packageSharingEnabled: false,
      packageSkills: [],
      providerOptions: {},
    });
  });
});
