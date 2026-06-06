import { describe, expect, test } from "bun:test";

import { readVisibleAssetsFromPlannerContextJson } from "../src/modules/agent-builder/application/agent-builder-visible-asset-index";
import { collectAgentBuilderVisibleAssets } from "../src/modules/agent-builder/application/agent-builder-visible-assets.service";
import type { AgentBuilderVisibleAssetSummaryCollections } from "../src/modules/agent-builder/application/agent-builder-visible-assets.types";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const viewer: AuthenticatedViewer = {
  email: "xiaoke@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000051",
  imageUrl: null,
  name: "Xiaoke",
};

const VISIBLE_ASSET_IDS = {
  channelSlack: "01J00000000000000000000302",
  environmentBound: "01J00000000000000000000303",
  environmentOld: "01J00000000000000000000304",
  mcpBound: "01J00000000000000000000305",
  mcpOld: "01J00000000000000000000306",
  skillBound: "01J00000000000000000000307",
  skillOld: "01J00000000000000000000308",
  skillSnapshot: "01J00000000000000000000309",
  spaceBound: "01J00000000000000000000310",
  spaceOld: "01J00000000000000000000311",
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
  "  spaces:",
  `    - id: ${VISIBLE_ASSET_IDS.spaceBound}`,
  "      name: Support KB",
].join("\n");

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

describe("Agent Builder visible asset providers", () => {
  test("keeps Planner Context visible asset injection behavior after provider extraction", async () => {
    const assets = await collectAgentBuilderVisibleAssets({
      bindings: {} as ApiBindings,
      collectSummaries: async (input) => {
        expect([...input.boundSkillIds]).toEqual([VISIBLE_ASSET_IDS.skillBound]);
        expect([...input.boundMcpServerIds]).toEqual([VISIBLE_ASSET_IDS.mcpBound]);
        expect([...input.boundSpaceIds]).toEqual([VISIBLE_ASSET_IDS.spaceBound]);
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
              ownerName: "Xiaoke",
              snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
              sourceKind: "manual",
              updatedAt: "2026-05-20T00:00:00.000Z",
            },
          ],
        };
      },
      draftYaml,
      organizationId: "01J00000000000000000000006",
      previousAssets: null,
      viewer,
    });

    expect(assets.draftBindings).toMatchObject({
      environmentId: VISIBLE_ASSET_IDS.environmentBound,
      mcpServerIds: [VISIBLE_ASSET_IDS.mcpBound],
      parseStatus: "parsed",
      skillIds: [VISIBLE_ASSET_IDS.skillBound],
      spaceIds: [VISIBLE_ASSET_IDS.spaceBound],
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
      channelIds: [VISIBLE_ASSET_IDS.channelSlack],
      environmentId: VISIBLE_ASSET_IDS.environmentOld,
      mcpServerIds: [VISIBLE_ASSET_IDS.mcpOld],
      parseError: null,
      parseStatus: "parsed" as const,
      skillIds: [VISIBLE_ASSET_IDS.skillOld],
      spaceIds: [VISIBLE_ASSET_IDS.spaceOld],
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

    expect(previousAssets?.draftBindings).toEqual(previousDraftBindings);

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
            ownerName: "Xiaoke",
            snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
            sourceKind: "manual",
            updatedAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        spaces: [
          {
            bindingState: "bound",
            hash: "space-new-hash",
            id: VISIBLE_ASSET_IDS.spaceBound,
            name: "Support KB",
            role: "admin",
            visibility: "private",
          },
        ],
      }),
      draftYaml,
      organizationId: "01J00000000000000000000006",
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
        ownerName: "Xiaoke",
        snapshotId: VISIBLE_ASSET_IDS.skillSnapshot,
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ]);
    expect(assets.changesSinceLastTurn.spaces.added).toEqual([
      {
        bindingState: "bound",
        hash: "space-new-hash",
        id: VISIBLE_ASSET_IDS.spaceBound,
        name: "Support KB",
        role: "admin",
        visibility: "private",
      },
    ]);
  });
});
