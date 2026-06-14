import { describe, expect, test } from "bun:test";

import { createEmptyResolutionSummary } from "@mosoo/agent-package";
import type { AgentManifest } from "@mosoo/contracts/agent-manifest";
import { AGENT_MANIFEST_VERSION } from "@mosoo/contracts/agent-manifest";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, AppId, SkillId, SpaceId } from "@mosoo/id";

import { createDraftAgent } from "../src/modules/agents/application/agent-package-draft.service";
import { resolvePackageSkills } from "../src/modules/agents/application/agent-package-resolution.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRAFT_IDS = {
  organization: parsePlatformId<OrganizationId>("01J00000000000000000000006"),
  owner: parsePlatformId<AccountId>("01J00000000000000000000001"),
  app: parsePlatformId<AppId>("01J00000000000000000000002"),
  skill: parsePlatformId<SkillId>("01J00000000000000000000003"),
  space: parsePlatformId<SpaceId>("01J00000000000000000000004"),
} as const;

function createAgentPackageDraftDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE app (
      created_at integer NOT NULL,
      default_environment_id text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      slug text NOT NULL,
      updated_at integer NOT NULL
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
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL,
      visibility text NOT NULL
    );

    CREATE TABLE agent_skill (
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      skill_id text NOT NULL,
      sort_order integer NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    );

    CREATE TABLE agent_space_binding (
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      sort_order integer NOT NULL,
      space_id text NOT NULL,
      PRIMARY KEY (agent_id, space_id)
    );

    INSERT INTO app (
      created_at,
      default_environment_id,
      id,
      name,
      organization_id,
      owner_account_id,
      slug,
      updated_at
    )
    VALUES (1, NULL, '${DRAFT_IDS.app}', 'Draft App', '${DRAFT_IDS.organization}', '${DRAFT_IDS.owner}', 'draft', 1);
  `);

  return database;
}

function createPackageResolutionDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      name text
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      default_environment_id text,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      slug text NOT NULL,
      updated_at integer NOT NULL
    );

	    CREATE TABLE organization (
	      id text PRIMARY KEY NOT NULL
	    );

    CREATE TABLE skill (
      author text NOT NULL,
      created_at integer NOT NULL,
      current_snapshot_id text NOT NULL,
      description text NOT NULL,
      forked_from_owner_name text,
      forked_from_skill_id text,
      forked_from_skill_name text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL,
      version text
    );

	    INSERT INTO organization (id)
	    VALUES ('${DRAFT_IDS.organization}');

    INSERT INTO app (
      id,
      created_at,
      default_environment_id,
      name,
      organization_id,
      owner_account_id,
      slug,
      updated_at
    )
    VALUES ('${DRAFT_IDS.app}', 1, NULL, 'Draft App', '${DRAFT_IDS.organization}', '${DRAFT_IDS.owner}', 'draft', 1);
  `);

  return database;
}

describe("agent package draft", () => {
  test("returns the inserted draft agent", async () => {
    const database = createAgentPackageDraftDatabase();

    const agent = await createDraftAgent(database, {
      agentName: "Imported Agent",
      description: "Imported from package",
      environmentId: null,
      kind: "pet",
      model: "gpt-5.4",
      ownerId: DRAFT_IDS.owner,
      packageMcpServers: [],
      packageResolution: null,
      packageSkills: [],
      prompt: "Help",
      provider: "openai",
      providerOptions: {},
      appId: DRAFT_IDS.app,
      runtimeId: "openai-runtime",
      skillIds: [DRAFT_IDS.skill, DRAFT_IDS.skill],
      spaceIds: [DRAFT_IDS.space],
    });

    expect(agent).toMatchObject({
      description: "Imported from package",
      environmentId: null,
      kind: "pet",
      liveDeploymentVersionId: null,
      model: "gpt-5.4",
      name: "Imported Agent",
      appOrganizationId: DRAFT_IDS.organization,
      ownerId: DRAFT_IDS.owner,
      appId: DRAFT_IDS.app,
      prompt: "Help",
      provider: "openai",
      runtimeId: "openai-runtime",
      status: "draft",
      visibility: "private",
    });
    expect(agent.id).toHaveLength(26);

    const row = await database
      .prepare("SELECT config_json FROM agent WHERE id = ?")
      .bind(agent.id)
      .first<{ config_json: string }>();

    expect(JSON.parse(row?.config_json ?? "{}")).toEqual({
      builder: {
        componentDecisions: {},
      },
      packageMcpServers: [],
      packageResolution: null,
      packageSkills: [],
      providerOptions: {},
    });
  });

  test("rejects package-owned Skill references before writing agent_skill rows", async () => {
    const database = createAgentPackageDraftDatabase();

    await expect(
      createDraftAgent(database, {
        agentName: "Imported Agent",
        description: "Imported from package",
        environmentId: null,
        kind: "pet",
        model: "gpt-5.4",
        ownerId: DRAFT_IDS.owner,
        packageMcpServers: [],
        packageResolution: null,
        packageSkills: [],
        prompt: "Help",
        provider: "openai",
        providerOptions: {},
        appId: DRAFT_IDS.app,
        runtimeId: "openai-runtime",
        skillIds: ["package:docs" as SkillId],
        spaceIds: [],
      }),
    ).rejects.toThrow("Agent skill ID must be a valid ULID.");

    const row = await database.prepare("SELECT COUNT(*) AS count FROM agent_skill").first<{
      count: number;
    }>();

    expect(row?.count).toBe(0);
  });

  test("keeps package-owned Skill references out of platform Skill ID admission", async () => {
    const summary = createEmptyResolutionSummary();
    const issues: Parameters<typeof resolvePackageSkills>[0]["issues"] = [];
    const manifest: AgentManifest = {
      advanced: null,
      environment: {
        environmentId: null,
        envVars: {},
        expectedName: null,
        setupScript: "",
      },
      kind: "pet",
      manifestVersion: AGENT_MANIFEST_VERSION,
      mcpServers: [],
      metadata: {
        description: null,
        name: "Imported Agent",
      },
      prompts: {
        system: "Help",
      },
      runtime: {
        id: "openai-runtime",
        model: "gpt-5.4",
        provider: "openai",
        providerOptions: {},
      },
      skills: [
        {
          ownerName: null,
          skillId: "package:docs",
          skillName: "Docs",
          state: "active",
        },
      ],
      spaces: [],
    };

    const resolution = await resolvePackageSkills({
      database: createPackageResolutionDatabase(),
      issues,
      manifest,
      appId: DRAFT_IDS.app,
      summary,
      viewerId: DRAFT_IDS.owner,
    });

    expect(resolution).toEqual({
      packageSkills: [],
      skillIds: [],
    });
    expect(issues).toMatchObject([
      {
        code: "agent.import.skill.missing",
        targetLabel: "Docs",
        targetType: "skill",
      },
    ]);
  });
});
