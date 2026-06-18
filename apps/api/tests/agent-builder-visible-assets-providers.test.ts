import { describe, expect, test } from "bun:test";

import { toAgentBuilderPlannerDraftContext } from "../src/modules/agent-builder/application/agent-builder-lightweight-manifest-projections";
import {
  readPreviousVisibleAssetsFromPlannerContextJson,
  readVisibleAssetsFromPlannerContextJson,
} from "../src/modules/agent-builder/application/agent-builder-previous-visible-assets";
import { collectAgentBuilderVisibleAssets } from "../src/modules/agent-builder/application/agent-builder-visible-assets.service";
import type { AgentBuilderVisibleAssetSummaryCollections } from "../src/modules/agent-builder/application/agent-builder-visible-assets.types";
import { createAgentBuilderVisibleEnvironmentSummaries } from "../src/modules/agent-builder/application/agent-builder-visible-environment-summaries";
import { createAgentBuilderVisibleMcpServerSummaries } from "../src/modules/agent-builder/application/agent-builder-visible-mcp-server-summaries";
import { createAgentBuilderVisibleSkillSummaries } from "../src/modules/agent-builder/application/agent-builder-visible-skill-summaries";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const viewer: AuthenticatedViewer = {
  email: "agent.builder.fixture@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000051",
  imageUrl: null,
  name: "Agent Builder User",
};

const APP_ID = "01J00000000000000000000006";

const VISIBLE_ASSET_IDS = {
  environmentBound: "01J00000000000000000000303",
  environmentOld: "01J00000000000000000000304",
  mcpBound: "01J00000000000000000000305",
  mcpOld: "01J00000000000000000000306",
  skillBound: "01J00000000000000000000307",
  skillOld: "01J00000000000000000000308",
  skillSnapshot: "01J00000000000000000000309",
} as const;

const draftYaml = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Support Agent",
  "runtime:",
  "  id: openai-runtime",
  "  provider: openai",
  "  model: gpt-5.4",
  "prompt: Help users.",
  "environment:",
  `  environmentId: ${VISIBLE_ASSET_IDS.environmentBound}`,
  "assets:",
  "  skills:",
  `    - ${VISIBLE_ASSET_IDS.skillBound}`,
  "  mcpServers:",
  `    - ${VISIBLE_ASSET_IDS.mcpBound}`,
].join("\n");

function emptySummaries(): AgentBuilderVisibleAssetSummaryCollections {
  return {
    environments: [],
    mcpServers: [],
    skills: [],
  };
}

describe("Agent Builder visible asset providers", () => {
  test("summarizes visible asset records through explicit domain adapters", () => {
    const environments = createAgentBuilderVisibleEnvironmentSummaries(
      { environmentId: VISIBLE_ASSET_IDS.environmentBound },
      [
        {
          allowMcpServers: true,
          allowPackageManagers: true,
          description: "Support runtime",
          envVars: [{ key: "SLACK_BOT_TOKEN" }],
          id: VISIBLE_ASSET_IDS.environmentBound,
          isBuiltIn: false,
          isDefault: true,
          name: "support-env",
          networkPolicy: "limited",
          packages: [{ manager: "npm" }, { manager: "pip" }, { manager: "npm" }],
          setupScript: "echo ready",
          updatedAt: "2026-05-20T00:00:00.000Z",
        },
      ],
    );
    const mcpServers = createAgentBuilderVisibleMcpServerSummaries(
      {
        bindingRepresented: true,
        boundMcpServerIds: new Set([VISIBLE_ASSET_IDS.mcpBound]),
      },
      {
        servers: [
          {
            authType: "oauth",
            authorizationState: "active",
            credentialScope: "app",
            credentialStatus: "active",
            description: "Slack tools",
            enabled: true,
            id: VISIBLE_ASSET_IDS.mcpBound,
            name: "slack",
            source: "app",
            updatedAt: "2026-05-20T00:00:00.000Z",
            url: "https://mcp.example.com/slack",
          },
        ],
      },
    );
    const skills = createAgentBuilderVisibleSkillSummaries(
      { boundSkillIds: new Set([VISIBLE_ASSET_IDS.skillBound]) },
      [
        {
          description: "Review docs",
          id: VISIBLE_ASSET_IDS.skillBound,
          name: "docs-review",
          ownerName: "Agent Builder User",
          snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
          sourceKind: "user",
          updatedAt: "2026-05-20T00:00:00.000Z",
        },
      ],
    );
    expect(environments[0]).toEqual(
      expect.objectContaining({
        bindingState: "bound",
        envVarKeys: ["SLACK_BOT_TOKEN"],
        packageManagers: ["npm", "pip"],
      }),
    );
    expect(mcpServers[0]).toEqual(
      expect.objectContaining({
        bindingState: "bound",
        name: "slack",
        urlHost: "mcp.example.com",
      }),
    );
    expect(skills[0]).toEqual(
      expect.objectContaining({
        bindingState: "bound",
        name: "docs-review",
      }),
    );
  });

  test("rejects conflicting parsed and raw Draft inputs at runtime", async () => {
    const conflictingInput = {
      bindings: {} as ApiBindings,
      collectSummaries: async () => emptySummaries(),
      draft: toAgentBuilderPlannerDraftContext(draftYaml),
      draftYaml: "draft",
      appId: APP_ID,
      previousAssets: null,
      viewer,
    };

    await expect(
      Reflect.apply(collectAgentBuilderVisibleAssets, null, [conflictingInput]),
    ).rejects.toThrow(
      "Agent Builder draft context input must not provide both draft and draftYaml.",
    );
  });

  test("does not collect visible assets when Draft YAML cannot be parsed", async () => {
    const assets = await collectAgentBuilderVisibleAssets({
      bindings: {} as ApiBindings,
      collectSummaries: async () => {
        throw new Error("visible asset providers should not run for invalid Draft YAML");
      },
      draftYaml: "draft",
      appId: APP_ID,
      previousAssets: null,
      viewer,
    });

    expect(assets.draftBindings.parseStatus).toBe("failed");
    expect(assets.draftBindings.parseError).toContain("Manifest YAML must be an object");
    expect(assets.currentIndex).toEqual(emptySummaries());
    expect(assets.changesSinceLastTurn).toEqual({
      environments: { added: [], removed: [], updated: [] },
      mcpServers: { added: [], removed: [], updated: [] },
      skills: { added: [], removed: [], updated: [] },
    });
  });

  test("keeps Planner Context visible asset injection behavior after provider extraction", async () => {
    const assets = await collectAgentBuilderVisibleAssets({
      bindings: {} as ApiBindings,
      collectSummaries: async (input) => {
        expect([...input.boundSkillIds]).toEqual([VISIBLE_ASSET_IDS.skillBound]);
        expect([...input.boundMcpServerIds]).toEqual([VISIBLE_ASSET_IDS.mcpBound]);
        expect(input.draft.environmentId).toBe(VISIBLE_ASSET_IDS.environmentBound);

        return {
          ...emptySummaries(),
          environments: [
            {
              allowMcpServers: true,
              allowPackageManagers: true,
              bindingState: "bound",
              description: "Default runtime",
              envVarKeys: ["TOKEN"],
              hash: "env-hash",
              id: VISIBLE_ASSET_IDS.environmentBound,
              isBuiltIn: false,
              isDefault: false,
              name: "Bound Environment",
              networkPolicy: "limited",
              packageManagers: ["npm"],
              setupScriptConfigured: true,
              updatedAt: "2026-05-20T00:00:00.000Z",
            },
          ],
          skills: [
            {
              bindingState: "bound",
              description: "Support macros",
              hash: "skill-hash",
              id: VISIBLE_ASSET_IDS.skillBound,
              name: "Support Skill",
              ownerName: "Agent Builder User",
              snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
              sourceKind: "manual",
              updatedAt: "2026-05-20T00:00:00.000Z",
            },
          ],
        };
      },
      draftYaml,
      appId: APP_ID,
      previousAssets: null,
      viewer,
    });

    expect(assets.draftBindings).toMatchObject({
      environmentId: VISIBLE_ASSET_IDS.environmentBound,
      mcpServerIds: [VISIBLE_ASSET_IDS.mcpBound],
      parseStatus: "parsed",
      skillIds: [VISIBLE_ASSET_IDS.skillBound],
    });
    expect(assets.currentIndex.environments).toEqual([
      {
        bindingState: "bound",
        hash: "env-hash",
        id: VISIBLE_ASSET_IDS.environmentBound,
        kind: "environment",
        name: "Bound Environment",
      },
    ]);
    expect(assets.currentIndex.skills).toEqual([
      {
        bindingState: "bound",
        hash: "skill-hash",
        id: VISIBLE_ASSET_IDS.skillBound,
        kind: "skill",
        name: "Support Skill",
      },
    ]);
    expect(assets.changesSinceLastTurn.skills).toEqual({
      added: [],
      removed: [],
      updated: [],
    });
  });

  test("diffs current summaries against the previous Planner Context asset index", async () => {
    const previousDraftBindings = {
      componentDecisions: {
        environment: "skipped",
        mcpServers: "skipped",
        skills: "skipped",
      },
      environmentId: VISIBLE_ASSET_IDS.environmentOld,
      mcpServerIds: [VISIBLE_ASSET_IDS.mcpOld],
      parseError: null,
      parseStatus: "parsed" as const,
      skillIds: [VISIBLE_ASSET_IDS.skillOld],
    };
    const expectedPreviousDraftBindings = {
      ...previousDraftBindings,
      componentDecisions: {
        environment: "skipped",
      },
    };
    const previousAssets = readVisibleAssetsFromPlannerContextJson(
      JSON.stringify({
        assets: {
          currentIndex: {
            environments: [
              {
                bindingState: "bound",
                hash: "env-old-hash",
                id: VISIBLE_ASSET_IDS.environmentOld,
                kind: "environment",
                name: "Old Environment",
              },
            ],
            skills: [
              {
                bindingState: "not_bound",
                hash: "skill-old-hash",
                id: VISIBLE_ASSET_IDS.skillBound,
                kind: "skill",
                name: "Support Skill",
              },
            ],
          },
          draftBindings: previousDraftBindings,
          observedAt: "2026-05-19T00:00:00.000Z",
          snapshotHash: "previous-hash",
        },
      }),
    );

    expect(previousAssets?.draftBindings).toEqual(expectedPreviousDraftBindings);

    const assets = await collectAgentBuilderVisibleAssets({
      bindings: {} as ApiBindings,
      collectSummaries: async () => ({
        ...emptySummaries(),
        skills: [
          {
            bindingState: "bound",
            description: "Support macros",
            hash: "skill-new-hash",
            id: VISIBLE_ASSET_IDS.skillBound,
            name: "Support Skill",
            ownerName: "Agent Builder User",
            snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
            sourceKind: "manual",
            updatedAt: "2026-05-20T00:00:00.000Z",
          },
        ],
      }),
      draftYaml,
      appId: APP_ID,
      previousAssets,
      viewer,
    });

    expect(assets.changesSinceLastTurn.environments.removed).toEqual([
      {
        bindingState: "bound",
        hash: "env-old-hash",
        id: VISIBLE_ASSET_IDS.environmentOld,
        kind: "environment",
        name: "Old Environment",
      },
    ]);
    expect(assets.changesSinceLastTurn.skills.updated).toEqual([
      {
        bindingState: "bound",
        description: "Support macros",
        hash: "skill-new-hash",
        id: VISIBLE_ASSET_IDS.skillBound,
        name: "Support Skill",
        ownerName: "Agent Builder User",
        snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ]);
  });

  test("preserves invalid previous Planner Context JSON as explicit metadata", () => {
    const previous = readPreviousVisibleAssetsFromPlannerContextJson("{");

    expect(previous.assets).toBeNull();
    expect(previous.context).toEqual({
      errorMessage: "Agent Builder previous planner context JSON could not be parsed.",
      status: "invalid",
    });
  });

  test("treats parseable previous Planner Context without a visible asset cache as missing", () => {
    const missingRoot = readPreviousVisibleAssetsFromPlannerContextJson(JSON.stringify({}));
    const missingIndex = readPreviousVisibleAssetsFromPlannerContextJson(
      JSON.stringify({ assets: {} }),
    );
    const emptyIndex = readPreviousVisibleAssetsFromPlannerContextJson(
      JSON.stringify({ assets: { currentIndex: {} } }),
    );

    expect(missingRoot).toEqual({
      assets: null,
      context: {
        errorMessage: null,
        status: "missing",
      },
    });
    expect(missingIndex).toEqual({
      assets: null,
      context: {
        errorMessage: null,
        status: "missing",
      },
    });
    expect(emptyIndex).toEqual({
      assets: null,
      context: {
        errorMessage: null,
        status: "missing",
      },
    });
  });

  test("treats malformed previous visible asset cache entries as invalid", () => {
    const previous = readPreviousVisibleAssetsFromPlannerContextJson(
      JSON.stringify({
        assets: {
          currentIndex: {
            skills: [
              {
                bindingState: "not_bound",
                hash: "skill-old-hash",
                id: VISIBLE_ASSET_IDS.skillBound,
              },
            ],
          },
        },
      }),
    );

    expect(previous).toEqual({
      assets: null,
      context: {
        errorMessage: "Agent Builder previous planner context JSON could not be parsed.",
        status: "invalid",
      },
    });
  });

  test("does not report all current assets as added when previous Planner Context is missing visible asset cache", async () => {
    const previous = readPreviousVisibleAssetsFromPlannerContextJson(JSON.stringify({}));
    const assets = await collectAgentBuilderVisibleAssets({
      bindings: {} as ApiBindings,
      collectSummaries: async () => ({
        ...emptySummaries(),
        skills: [
          {
            bindingState: "not_bound",
            description: "Support macros",
            hash: "skill-new-hash",
            id: VISIBLE_ASSET_IDS.skillBound,
            name: "Support Skill",
            ownerName: "Agent Builder User",
            snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
            sourceKind: "manual",
            updatedAt: "2026-05-20T00:00:00.000Z",
          },
        ],
      }),
      draftYaml,
      appId: APP_ID,
      previousAssets: previous.assets,
      previousContext: previous.context,
      viewer,
    });

    expect(assets.previousContext).toEqual(previous.context);
    expect(assets.changesSinceLastTurn).toEqual({
      environments: { added: [], removed: [], updated: [] },
      mcpServers: { added: [], removed: [], updated: [] },
      skills: { added: [], removed: [], updated: [] },
    });
  });

  test("does not report all current assets as added when previous Planner Context is invalid", async () => {
    const previous = readPreviousVisibleAssetsFromPlannerContextJson("{");
    const assets = await collectAgentBuilderVisibleAssets({
      bindings: {} as ApiBindings,
      collectSummaries: async () => ({
        ...emptySummaries(),
        skills: [
          {
            bindingState: "not_bound",
            description: "Support macros",
            hash: "skill-new-hash",
            id: VISIBLE_ASSET_IDS.skillBound,
            name: "Support Skill",
            ownerName: "Agent Builder User",
            snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
            sourceKind: "manual",
            updatedAt: "2026-05-20T00:00:00.000Z",
          },
        ],
      }),
      draftYaml,
      appId: APP_ID,
      previousAssets: previous.assets,
      previousContext: previous.context,
      viewer,
    });

    expect(assets.previousContext).toEqual(previous.context);
    expect(assets.changesSinceLastTurn).toEqual({
      environments: { added: [], removed: [], updated: [] },
      mcpServers: { added: [], removed: [], updated: [] },
      skills: { added: [], removed: [], updated: [] },
    });
  });
});
