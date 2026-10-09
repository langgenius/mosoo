import { describe, expect, test } from "bun:test";

import { toAgentDetailModel } from "../src/modules/agents/application/agent-models";
import type { AgentRow } from "../src/modules/agents/application/agent-types";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "viewer-1",
  imageUrl: null,
  name: "Viewer",
};

const AGENT_CONFIG_JSON = JSON.stringify({
  packageMcpServers: [],
  packageResolution: null,
  packageSkills: [],
});

const AGENT_ROW: AgentRow = {
  configJson: AGENT_CONFIG_JSON,
  createdAt: 1,
  description: "Private details",
  environmentId: null,
  id: "01J00000000000000000000009",
  kind: "pet",
  liveDeploymentVersionId: "01J0000000000000000000006A",
  model: "gpt-5.4",
  name: "Agent",
  ownerId: "01J00000000000000000000001",
  projectId: "01J0000000000000000000000P",
  prompt: "Private prompt",
  provider: "openai",
  runtimeId: "openai-runtime",
  status: "published",
  updatedAt: 2,
};

function createAgentDetailModelDatabase(): D1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      image_url text,
      name text
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL
    );

    CREATE TABLE agent_deployment_version (
      agent_id text NOT NULL,
      config_json text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      environment_id text,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      mcp_bindings_json text NOT NULL,
      model text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      skills_json text NOT NULL,
      summary text NOT NULL,
      version_number integer NOT NULL
    );

    CREATE TABLE agent_skill (
      agent_id text NOT NULL,
      skill_id text NOT NULL,
      sort_order integer NOT NULL
    );

    CREATE TABLE skill (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      owner_account_id text NOT NULL,
      project_id text NOT NULL
    );

    CREATE TABLE agent_mcp_binding (
      agent_id text NOT NULL,
      server_id text NOT NULL,
      enabled integer NOT NULL,
      sort_order integer NOT NULL,
      created_at integer NOT NULL
    );

    CREATE TABLE mcp_server (
      id text PRIMARY KEY NOT NULL,
      icon_url text,
      name text NOT NULL,
      project_id text NOT NULL
    );

    INSERT INTO account (id, image_url, name)
    VALUES ('01J00000000000000000000001', NULL, 'Owner');

    INSERT INTO agent (id, project_id)
    VALUES ('01J00000000000000000000009', '01J0000000000000000000000P');

    INSERT INTO agent_deployment_version (
      agent_id,
      config_json,
      created_at,
      created_by_account_id,
      environment_id,
      id,
      kind,
      mcp_bindings_json,
      model,
      prompt,
      provider,
      runtime_id,
      skills_json,
      summary,
      version_number
    )
    VALUES (
      '01J00000000000000000000009',
      '${AGENT_CONFIG_JSON}',
      1,
      '01J00000000000000000000001',
      NULL,
      '01J0000000000000000000006A',
      'pet',
      '[]',
      'gpt-5.4',
      'Private prompt',
      'openai',
      'openai-runtime',
      '[]',
      'Initial publish',
      1
    );
  `);

  return database;
}

describe("agent detail model", () => {
  test("derives editor live version from the version list", async () => {
    const database = createAgentDetailModelDatabase();

    const detail = await toAgentDetailModel(database, VIEWER, AGENT_ROW);

    expect(detail.liveVersion?.id).toBe("01J0000000000000000000006A");
    expect(detail.versions.map((version) => version.id)).toEqual(["01J0000000000000000000006A"]);
    expect(detail.prompt).toBe("Private prompt");
    expect(detail.model).toBe("gpt-5.4");
  });
});
