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
  exposedViaApi: null,
  id: "01J00000000000000000000009",
  kind: "pet",
  liveDeploymentVersionId: "01J0000000000000000000006A",
  model: "gpt-5.4",
  name: "Agent",
  ownerId: "01J00000000000000000000001",
  appId: "01J0000000000000000000000P",
  prompt: "Private prompt",
  provider: "openai",
  runtimeId: "openai-runtime",
  status: "published",
  updatedAt: 2,
  visibility: "private",
};

const OWNER_SUMMARY = {
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createAgentDetailModelDatabase(
  input: {
    deploymentModel?: string;
    deploymentProvider?: string;
    deploymentRuntimeId?: string;
  } = {},
): D1Database {
  const database = new SqliteD1Database({ foreignKeys: false });
  const deploymentModel = input.deploymentModel ?? "gpt-5.4";
  const deploymentProvider = input.deploymentProvider ?? "openai";
  const deploymentRuntimeId = input.deploymentRuntimeId ?? "openai-runtime";

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      image_url text,
      name text
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      app_id text NOT NULL
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
      app_id text NOT NULL
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
      app_id text NOT NULL
    );

    INSERT INTO account (id, image_url, name)
    VALUES ('01J00000000000000000000001', NULL, 'Owner');

    INSERT INTO agent (id, app_id)
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
      ${sqlString(deploymentModel)},
      'Private prompt',
      ${sqlString(deploymentProvider)},
      ${sqlString(deploymentRuntimeId)},
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

    const detail = await toAgentDetailModel(database, VIEWER, AGENT_ROW, OWNER_SUMMARY, "owner");

    expect(detail.liveVersion?.id).toBe("01J0000000000000000000006A");
    expect(detail.versions.map((version) => version.id)).toEqual(["01J0000000000000000000006A"]);
    expect(detail.prompt).toBe("Private prompt");
    expect(detail.model).toBe("gpt-5.4");
  });

  test("apps runtime model fields from admitted identity values", async () => {
    const database = createAgentDetailModelDatabase({
      deploymentModel: " gpt-5.4 ",
      deploymentProvider: " openai ",
      deploymentRuntimeId: " openai-runtime ",
    });
    const detail = await toAgentDetailModel(
      database,
      VIEWER,
      {
        ...AGENT_ROW,
        model: " gpt-5.4 ",
        provider: " openai ",
        runtimeId: " openai-runtime ",
      },
      OWNER_SUMMARY,
      "owner",
    );

    expect(detail).toMatchObject({
      model: "gpt-5.4",
      provider: "openai",
      runtimeId: "openai-runtime",
    });
    expect(detail.liveVersion).toMatchObject({
      model: "gpt-5.4",
      provider: "openai",
      runtimeId: "openai-runtime",
    });
  });

  test("rejects invalid runtime model identity before projection", async () => {
    await expect(
      toAgentDetailModel(
        createAgentDetailModelDatabase(),
        VIEWER,
        {
          ...AGENT_ROW,
          model: " ",
        },
        OWNER_SUMMARY,
        "owner",
      ),
    ).rejects.toThrow("modelId is required.");
  });

  test("redacts deployment details for non-editor viewers", async () => {
    const database = createAgentDetailModelDatabase();

    const detail = await toAgentDetailModel(database, VIEWER, AGENT_ROW, OWNER_SUMMARY, "none");

    expect(detail.liveVersion).toBeNull();
    expect(detail.versions).toEqual([]);
    expect(detail.prompt).toBe("");
    expect(detail.model).toBe("");
    expect(detail.owner).toEqual({
      id: "01J00000000000000000000001",
      imageUrl: null,
      name: "Owner",
    });
  });
});
