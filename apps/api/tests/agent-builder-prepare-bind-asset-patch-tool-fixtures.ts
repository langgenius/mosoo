import type {
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import {
  createPrepareBindEnvironmentPatchTool,
  createPrepareBindMcpPatchTool,
  createPrepareBindSkillPatchTool,
  createPrepareBindSpacePatchTool,
  createPrepareReplaceSkillPatchTool,
} from "../src/modules/agent-builder/application/tools/prepare-bind-asset-patch.tool";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

export const BIND_ASSET_IDS = {
  environmentCreated: "01J000000000000000000000A2",
  environmentCurrent: "01J000000000000000000000B1",
  environmentCurrentRevision: "01J000000000000000000000B4",
  environmentMissing: "01J000000000000000000000B2",
  environmentPython: "01J000000000000000000000B3",
  mcpGithub: "01J000000000000000000000A3",
  mcpVisible: "01J000000000000000000000A4",
  skillA: "01J000000000000000000000A8",
  skillB: "01J000000000000000000000A9",
  skillNew: "01J000000000000000000000A7",
  skillOld: "01J000000000000000000000A6",
  skillTicketTriage: "01J000000000000000000000A5",
  spaceCreated: "01J000000000000000000000A1",
  unknownSpace: "01J000000000000000000000C1",
} as const;

export function apiBindings(database: D1Database = {} as D1Database): ApiBindings {
  return { DB: database } as ApiBindings;
}

export function draftYaml(
  input: {
    environmentId?: string | null;
    skillIds?: readonly string[];
  } = {},
): string {
  const environmentId = input.environmentId ?? null;
  const skillIds = input.skillIds ?? [];
  const skillLines =
    skillIds.length === 0
      ? ["  skills: []"]
      : ["  skills:", ...skillIds.map((id) => `    - ${id}`)];

  return [
    "version: 1",
    "kind: pet",
    "identity:",
    "  name: Support Agent",
    "runtime:",
    "  id: openai-runtime",
    "  provider: openai",
    "  model: gpt-5.4",
    "prompt: Help support users.",
    "environment:",
    `  environmentId: ${environmentId ?? "null"}`,
    "assets:",
    "  agentsFileId: null",
    ...skillLines,
    "  mcpServers: []",
    "  spaces: []",
  ].join("\n");
}

export function plannerContext(
  input: {
    draftYaml?: string;
    historicalOpenNodes?: AgentBuilderPlanNode[];
    inputKind?: AgentBuilderPlannerContext["turn"]["inputKind"];
    revision?: string;
    turnInputText?: string;
  } = {},
): AgentBuilderPlannerContext {
  return {
    agent: {
      agentId: "01J00000000000000000000009",
      kind: "pet",
      organizationId: "01J00000000000000000000006",
      status: "draft",
    },
    assets: {
      changesSinceLastTurn: {
        channels: { added: [], removed: [], updated: [] },
        environments: { added: [], removed: [], updated: [] },
        mcpServers: { added: [], removed: [], updated: [] },
        selectedSpaceFiles: { added: [], removed: [], updated: [] },
        skills: { added: [], removed: [], updated: [] },
        spaces: { added: [], removed: [], updated: [] },
      },
      currentIndex: {
        channels: [],
        environments: [
          {
            bindingState: "not_bound",
            hash: "environment-created-hash",
            id: BIND_ASSET_IDS.environmentCreated,
            kind: "environment",
            name: "Python Support",
          },
          {
            bindingState: "not_bound",
            hash: "environment-python-hash",
            id: BIND_ASSET_IDS.environmentPython,
            kind: "environment",
            name: "Python 数据分析环境",
          },
        ],
        mcpServers: [
          {
            bindingState: "not_bound",
            hash: "mcp-github-hash",
            id: BIND_ASSET_IDS.mcpGithub,
            kind: "mcp_server",
            name: "GitHub MCP",
          },
        ],
        selectedSpaceFiles: [],
        skills: [
          {
            bindingState: "not_bound",
            hash: "skill-ticket-triage-hash",
            id: BIND_ASSET_IDS.skillTicketTriage,
            kind: "skill",
            name: "Ticket Triage Skill",
          },
          {
            bindingState: "not_bound",
            hash: "skill-new-hash",
            id: BIND_ASSET_IDS.skillNew,
            kind: "skill",
            name: "New Skill",
          },
        ],
        spaces: [
          {
            bindingState: "not_bound",
            hash: "space-created-hash",
            id: BIND_ASSET_IDS.spaceCreated,
            kind: "space",
            name: "support-kb",
          },
        ],
      },
      draftBindings: {
        agentsFileId: null,
        channelIds: [],
        environmentId: null,
        mcpServerIds: [],
        parseError: null,
        parseStatus: "parsed",
        skillIds: [],
        spaceIds: [],
      },
      observedAt: "2026-05-20T00:00:00.000Z",
      snapshotHash: "asset-hash",
    },
    boundaryPolicy: {
      allowedModes: ["plain_text", "draft_patch", "question", "blocked"],
      forbiddenWrites: [],
      requiresLlmPlanner: true,
    },
    conversation: { recentMessages: [] },
    draft: {
      revision: input.revision ?? "draft-rev-1",
      yaml: input.draftYaml ?? draftYaml(),
    },
    historicalOpenNodes: input.historicalOpenNodes ?? [],
    plannerRunId: "01J000000000000000000000D1",
    readiness: {
      checkedAt: "2026-05-20T00:00:00.000Z",
      errorCount: 0,
      issues: [],
      ready: true,
      warningCount: 0,
    },
    systemAgent: {
      credentialSource: "provider_database",
      model: { modelId: "gpt-5.4", provider: "openai" },
    },
    threadId: "01J000000000000000000000D2",
    turn: {
      inputKind: input.inputKind ?? "confirmation",
      inputText: input.turnInputText ?? "confirm create",
      triggerMessageId: "01J000000000000000000000D3",
    },
    version: 1,
  };
}

export function outputNodes(output: AgentBuilderToolPayload | null): unknown[] {
  const nodes = output?.["nodes"];

  if (!Array.isArray(nodes)) {
    throw new Error("Expected bind patch output nodes.");
  }

  return nodes;
}

export function outputPatches(output: AgentBuilderToolPayload | null): unknown[] {
  const patches = output?.["patches"];

  if (!Array.isArray(patches)) {
    throw new Error("Expected bind patch output patches.");
  }

  return patches;
}

export function createRuntime(context = plannerContext(), bindings = apiBindings()) {
  return createAgentBuilderToolRuntime({
    tools: [
      createPrepareBindSpacePatchTool({
        actorAccountId: "01J00000000000000000000051",
        bindings,
        context,
      }),
      createPrepareBindEnvironmentPatchTool({
        actorAccountId: "01J00000000000000000000051",
        bindings,
        context,
      }),
      createPrepareBindMcpPatchTool({
        actorAccountId: "01J00000000000000000000051",
        bindings,
        context,
      }),
      createPrepareBindSkillPatchTool({
        actorAccountId: "01J00000000000000000000051",
        bindings,
        context,
      }),
      createPrepareReplaceSkillPatchTool({
        actorAccountId: "01J00000000000000000000051",
        bindings,
        context,
      }),
    ],
  });
}

export function contextWithVisibleMcpServer(): AgentBuilderPlannerContext {
  const context = plannerContext();

  return {
    ...context,
    assets: {
      ...context.assets,
      currentIndex: {
        ...context.assets.currentIndex,
        mcpServers: [
          {
            bindingState: "not_bound",
            hash: "mcp-ab-planner-linear-hash",
            id: BIND_ASSET_IDS.mcpVisible,
            kind: "mcp_server",
            name: "ab-planner-linear-mcp",
          },
        ],
      },
    },
  };
}

export function createEnvironmentBindingDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  createEnvironmentBindingSchema(database);
  database
    .prepare(
      `INSERT INTO account (
        created_at,
        email,
        email_verified,
        id,
        name,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(1, "xiaoke@mosoo.ai", 1, "01J00000000000000000000051", "Xiaoke", 1)
    .run();
  database
    .prepare(
      `INSERT INTO organization (
        byok_enabled,
        created_at,
        creator_account_id,
        id,
        join_policy,
        name,
        slug,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      1,
      "01J00000000000000000000051",
      "01J00000000000000000000006",
      "closed",
      "Mosoo Test",
      "mosoo-test",
      1,
    )
    .run();
  database
    .prepare(
      `INSERT INTO environment (
        created_at,
        current_revision_id,
        description,
        id,
        name,
        organization_id,
        owner_account_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      BIND_ASSET_IDS.environmentCurrentRevision,
      "",
      BIND_ASSET_IDS.environmentCurrent,
      "Current custom Environment",
      "01J00000000000000000000006",
      "01J00000000000000000000051",
      1,
    )
    .run();
  database
    .prepare(
      `INSERT INTO environment_revision (
        allow_mcp_servers,
        allow_package_managers,
        allowed_hosts_json,
        created_at,
        created_by_account_id,
        env_vars_json,
        environment_id,
        id,
        network_policy,
        organization_id,
        packages_json,
        setup_script
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      1,
      "[]",
      1,
      "01J00000000000000000000051",
      "[]",
      BIND_ASSET_IDS.environmentCurrent,
      BIND_ASSET_IDS.environmentCurrentRevision,
      "full",
      "01J00000000000000000000006",
      "[]",
      "",
    )
    .run();

  return database;
}

function createEnvironmentBindingSchema(database: SqliteD1Database): void {
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

    CREATE TABLE organization (
      avatar_url text,
      byok_allowed_providers text,
      byok_enabled integer DEFAULT true NOT NULL,
      created_at integer NOT NULL,
      creator_account_id text,
      default_environment_id text,
      id text PRIMARY KEY NOT NULL,
      join_policy text NOT NULL,
      name text NOT NULL,
      primary_domain text,
      slug text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE agent (
      config_json text NOT NULL,
      created_at integer NOT NULL,
      description text,
      environment_id text,
      id text PRIMARY KEY NOT NULL,
      kind text DEFAULT 'pet' NOT NULL,
      live_deployment_version_id text,
      model text NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      updated_at integer NOT NULL,
      visibility text DEFAULT 'private' NOT NULL
    );

    CREATE TABLE environment (
      created_at integer NOT NULL,
      current_revision_id text NOT NULL,
      description text NOT NULL,
      forked_from_environment_id text,
      forked_from_environment_name text,
      forked_from_owner_name text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text,
      updated_at integer NOT NULL
    );

    CREATE TABLE environment_revision (
      allow_mcp_servers integer NOT NULL,
      allow_package_managers integer NOT NULL,
      allowed_hosts_json text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text,
      env_vars_json text NOT NULL,
      environment_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      network_policy text NOT NULL,
      organization_id text NOT NULL,
      packages_json text NOT NULL,
      setup_script text NOT NULL
    );
  `);
}
