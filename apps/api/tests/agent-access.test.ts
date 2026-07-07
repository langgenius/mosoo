import { describe, expect, test } from "bun:test";

import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";

import { ensureAppAgentOwner } from "../src/modules/agents/application/agent-access.service";
import { getAgentRow } from "../src/modules/agents/application/agent-repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const AGENT_ACCESS_IDS = {
  organization: "01J00000000000000000000006",
  otherApp: "01J0000000000000000000000R",
  ownerAccount: "01J00000000000000000000001",
  ownerAgent: "01J00000000000000000000021",
  app: "01J0000000000000000000000Q",
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

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE agent (
      config_json text NOT NULL,
      created_at integer NOT NULL,
      description text,
      environment_id text,
      exposed_via_api integer,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      live_deployment_version_id text,
      model text NOT NULL,
      name text NOT NULL,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL,
      visibility text NOT NULL
    );

    INSERT INTO account (id, image_url, name)
    VALUES
      ('${AGENT_ACCESS_IDS.ownerAccount}', NULL, 'Owner'),
      ('${AGENT_ACCESS_IDS.viewerAccount}', NULL, 'Viewer');

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      created_at,
      updated_at
    )
    VALUES
      (
        '${AGENT_ACCESS_IDS.app}',
        '${AGENT_ACCESS_IDS.organization}',
        '${AGENT_ACCESS_IDS.ownerAccount}',
        'Default App',
        1,
        1
      ),
      (
        '${AGENT_ACCESS_IDS.otherApp}',
        '${AGENT_ACCESS_IDS.organization}',
        '${AGENT_ACCESS_IDS.ownerAccount}',
        'Other App',
        1,
        1
      );

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
      '${AGENT_ACCESS_IDS.ownerAgent}',
      'pet',
      'gpt-5.4',
      'Owner Agent',
      '${AGENT_ACCESS_IDS.ownerAccount}',
      '${AGENT_ACCESS_IDS.app}',
      'Help',
      'openai',
      'openai-runtime',
      'draft',
      1,
      'private'
    );
  `);

  return database;
}

describe("app agent access", () => {
  test("resolves owner access with explicit App proof", async () => {
    const database = createAgentAccessDatabase();

    const access = await ensureAppAgentOwner(database, AGENT_ACCESS_IDS.ownerAccount, {
      agentId: AGENT_ACCESS_IDS.ownerAgent,
      appId: AGENT_ACCESS_IDS.app,
    });

    expect(access.agent.id).toBe(AGENT_ACCESS_IDS.ownerAgent);
    expect(access.agent.appId).toBe(AGENT_ACCESS_IDS.app);
    expect(access.owner).toMatchObject({
      id: AGENT_ACCESS_IDS.ownerAccount,
      name: "Owner",
    });
    expect(access.viewerRole).toBe("owner");
  });

  test("fails closed for non-owner access even inside the same organization", async () => {
    const database = createAgentAccessDatabase();

    await expect(
      ensureAppAgentOwner(database, AGENT_ACCESS_IDS.viewerAccount, {
        agentId: AGENT_ACCESS_IDS.ownerAgent,
        appId: AGENT_ACCESS_IDS.app,
      }),
    ).rejects.toThrow();
  });

  test("fails closed when the App proof does not match the Agent", async () => {
    const database = createAgentAccessDatabase();

    await expect(
      ensureAppAgentOwner(database, AGENT_ACCESS_IDS.ownerAccount, {
        agentId: AGENT_ACCESS_IDS.ownerAgent,
        appId: AGENT_ACCESS_IDS.otherApp,
      }),
    ).rejects.toThrow();
  });

  test("normalizes legacy empty stored config when reading Agent rows", async () => {
    const agent = await getAgentRow(createAgentAccessDatabase(), AGENT_ACCESS_IDS.ownerAgent);

    expect(agent.appId).toBe(AGENT_ACCESS_IDS.app);
    expect(JSON.parse(agent.configJson)).toEqual({
      builtInTools: createDefaultAgentBuiltInTools(),
      packageMcpServers: [],
      packageResolution: null,
      packageSkills: [],
      providerOptions: {},
    });
  });
});
