import { describe, expect, test } from "bun:test";

import type { AgentBuilderToolPayload } from "@mosoo/contracts/agent-builder";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import type { AgentBuilderVisibleAssetSummaryCollections } from "../src/modules/agent-builder/application/agent-builder-visible-assets.types";
import { createSearchAssetsTool } from "../src/modules/agent-builder/application/tools/search-assets.tool";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const viewer: AuthenticatedViewer = {
  email: "xiaoke@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000051",
  imageUrl: null,
  name: "Xiaoke",
};

function emptySummaries(): AgentBuilderVisibleAssetSummaryCollections {
  return {
    channels: [],
    environments: [],
    mcpServers: [],
    selectedSpaceFiles: [],
    skills: [],
    spaces: [],
  };
}

function createSearchFixture(): AgentBuilderVisibleAssetSummaryCollections {
  return {
    ...emptySummaries(),
    environments: [
      {
        allowMcpServers: true,
        allowPackageManagers: true,
        bindingState: "bound",
        description: "Node runtime for support workflows",
        envVarKeys: ["SUPPORT_TOKEN"],
        hash: "env-hash",
        id: "env_support",
        isBuiltIn: false,
        isDefault: false,
        name: "Support Environment",
        networkPolicy: "limited",
        packageManagers: ["npm"],
        setupScriptConfigured: true,
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    mcpServers: [
      {
        authType: "oauth",
        authorizationState: "authorized",
        bindingState: "not_bound",
        credentialScope: "user",
        credentialStatus: "configured",
        description: "GitHub repository access",
        enabled: true,
        hash: "mcp-hash",
        id: "mcp_github",
        name: "GitHub MCP",
        source: "organization_shared",
        updatedAt: "2026-05-20T00:00:00.000Z",
        urlHost: "github.example.com",
      },
    ],
    skills: [
      {
        bindingState: "not_bound",
        description: "Reusable support response macros",
        hash: "skill-support-hash",
        id: "skill_support",
        name: "Support Skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-support",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        bindingState: "not_bound",
        description: "Routes billing tickets",
        hash: "skill-billing-hash",
        id: "skill_billing",
        name: "Billing Skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-billing",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        bindingState: "not_bound",
        description: "Planner fixture sales follow-up workflow helper",
        hash: "skill-ab-planner-sales-hash",
        id: "skill_ab_planner_sales_followup",
        name: "ab-planner-sales-followup-skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-ab-planner-sales",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    spaces: [
      {
        bindingState: "bound",
        hash: "space-hash",
        id: "space_support",
        name: "Support KB",
        role: "admin",
        visibility: "private",
      },
      {
        bindingState: "not_bound",
        hash: "space-ab-planner-sales-hash",
        id: "space_ab_planner_sales_playbook",
        name: "ab-planner-sales-playbook",
        role: "read",
        visibility: "shared",
      },
    ],
  };
}

function createRuntimeWithSearchAssets(fixture = createSearchFixture()) {
  return createAgentBuilderToolRuntime({
    tools: [
      createSearchAssetsTool({
        bindings: {} as ApiBindings,
        collectSummaries: async () => fixture,
        draftYaml: "version: 1",
        organizationId: "01J00000000000000000000006",
        viewer,
      }),
    ],
  });
}

function outputAssets(output: AgentBuilderToolPayload | null): AgentBuilderToolPayload[] {
  const assets = output?.["assets"];

  if (!Array.isArray(assets)) {
    throw new Error("Expected search_assets output assets.");
  }

  return assets as AgentBuilderToolPayload[];
}

describe("search_assets tool", () => {
  test("filters assets by type and query without exposing secret-bearing fields", async () => {
    const result = await createRuntimeWithSearchAssets().execute({
      input: {
        assetTypes: ["mcp"],
        query: "github",
      },
      toolId: "search_assets",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      count: 1,
      query: "github",
      totalMatched: 1,
    });
    expect(outputAssets(result.output)).toEqual([
      {
        assetType: "mcp_server",
        bindingState: "not_bound",
        fields: {
          authType: "oauth",
          authorizationState: "authorized",
          credentialScope: "user",
          credentialStatus: "configured",
          description: "GitHub repository access",
          enabled: true,
          source: "organization_shared",
          updatedAt: "2026-05-20T00:00:00.000Z",
          urlHost: "github.example.com",
        },
        id: "mcp_github",
        name: "GitHub MCP",
      },
    ]);
    expect(JSON.stringify(result.output)).not.toContain("mcp-hash");
    expect(JSON.stringify(result.output)).not.toContain("secret");
    expect(JSON.stringify(result.output)).not.toContain("token/super");
  });

  test("supports binding state filters and cursor pagination", async () => {
    const firstPage = await createRuntimeWithSearchAssets().execute({
      input: {
        bindingState: "not_bound",
        limit: 1,
      },
      toolId: "search_assets",
    });

    expect(firstPage.output).toMatchObject({
      count: 1,
      hasMore: true,
      nextCursor: "1",
      totalMatched: 5,
    });

    const secondPage = await createRuntimeWithSearchAssets().execute({
      input: {
        bindingState: "not_bound",
        cursor: firstPage.output?.["nextCursor"],
        limit: 2,
      },
      toolId: "search_assets",
    });

    expect(secondPage.output).toMatchObject({
      count: 2,
      hasMore: true,
      nextCursor: "3",
      totalMatched: 5,
    });
    expect(outputAssets(secondPage.output).map((asset) => asset["bindingState"])).toEqual([
      "not_bound",
      "not_bound",
    ]);
  });

  test("matches visible hyphenated assets from de-hyphenated natural-language queries", async () => {
    const result = await createRuntimeWithSearchAssets().execute({
      input: {
        assetTypes: ["space"],
        bindingState: "not_bound",
        query: "please bind ab planner sales playbook space to this agent",
      },
      toolId: "search_assets",
    });

    expect(result.output).toMatchObject({
      count: 1,
      totalMatched: 1,
    });
    expect(outputAssets(result.output).map((asset) => asset["id"])).toEqual([
      "space_ab_planner_sales_playbook",
    ]);
  });

  test("matches visible Skill fixture names from generated full-sentence queries", async () => {
    const result = await createRuntimeWithSearchAssets().execute({
      input: {
        assetTypes: ["skill"],
        bindingState: "not_bound",
        query: "please bind ab planner sales followup skill to this agent",
      },
      toolId: "search_assets",
    });

    expect(result.output).toMatchObject({
      count: 1,
      totalMatched: 1,
    });
    expect(outputAssets(result.output).map((asset) => asset["id"])).toEqual([
      "skill_ab_planner_sales_followup",
    ]);
  });

  test("matches Environment aliases such as planner env", async () => {
    const fixture = createSearchFixture();
    const result = await createRuntimeWithSearchAssets({
      ...fixture,
      environments: [
        ...fixture.environments,
        {
          allowMcpServers: true,
          allowPackageManagers: true,
          bindingState: "not_bound",
          description: "Planner fixture default runtime",
          envVarKeys: [],
          hash: "env-ab-planner-system-default-hash",
          id: "env_ab_planner_system_default",
          isBuiltIn: false,
          isDefault: false,
          name: "ab-planner-system-default",
          networkPolicy: "full",
          packageManagers: ["npm"],
          setupScriptConfigured: false,
          updatedAt: "2026-05-20T00:00:00.000Z",
        },
      ],
    }).execute({
      input: {
        assetTypes: ["environment"],
        bindingState: "not_bound",
        query: "planner env",
      },
      toolId: "search_assets",
    });

    expect(result.output).toMatchObject({
      count: 1,
      totalMatched: 1,
    });
    expect(outputAssets(result.output).map((asset) => asset["id"])).toEqual([
      "env_ab_planner_system_default",
    ]);
  });

  test("returns a failed tool record for unsupported asset filters", async () => {
    await expect(
      createRuntimeWithSearchAssets().execute({
        input: {
          assetTypes: ["secret"],
        },
        toolId: "search_assets",
      }),
    ).resolves.toMatchObject({
      errorMessage: expect.stringContaining("secret"),
      output: null,
      status: "failed",
      toolId: "search_assets",
    });
  });

  test("trims asset filters and rejects unsafe cursors", async () => {
    const result = await createRuntimeWithSearchAssets().execute({
      input: {
        assetTypes: [" mcp "],
        bindingState: " not_bound ",
        cursor: " 0 ",
        query: "github",
      },
      toolId: "search_assets",
    });

    expect(result.output).toMatchObject({
      assetTypes: ["mcp_server"],
      bindingStates: ["not_bound"],
      count: 1,
    });

    await expect(
      createRuntimeWithSearchAssets().execute({
        input: {
          cursor: "9007199254740993",
        },
        toolId: "search_assets",
      }),
    ).resolves.toMatchObject({
      errorMessage: expect.stringContaining("cursor"),
      output: null,
      status: "failed",
      toolId: "search_assets",
    });
  });
});
