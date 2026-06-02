import { describe, expect, test } from "bun:test";

import {
  createResolveFixtureWithAmbiguousPlannerAssets,
  createResolveFixtureWithBoundLinearEnvironment,
  createResolveFixtureWithPlannerEnvironment,
} from "./agent-builder-resolve-asset-reference-fixtures";
import {
  createRuntimeWithResolveAssets,
  outputCandidates,
  sortedStrings,
} from "./agent-builder-resolve-asset-reference-runtime";

describe("resolve_asset_reference tool", () => {
  test("validates a real asset id and returns the canonical tool asset", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetId: "skill_billing",
        assetType: "skill",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      assetType: "skill",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        assetType: "skill",
        bindingState: "not_bound",
        id: "skill_billing",
        matchType: "exact_id",
        name: "Billing Skill",
      },
      status: "resolved",
    });
    expect(JSON.stringify(result.output)).not.toContain("skill-billing-hash");
    expect(JSON.stringify(result.output)).not.toContain("snapshot-billing");
  });

  test("resolves a unique exact name without requiring detail API access", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "skill",
        name: "Billing Skill",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      resolvedAsset: {
        id: "skill_billing",
        matchType: "exact_name",
      },
      status: "resolved",
    });
  });

  test("resolves hyphenated Space names from natural-language de-hyphenated references", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "space",
        bindingState: ["not_bound"],
        reference: "please bind ab planner sales playbook space to this agent",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "space",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        id: "space_ab_planner_sales_playbook",
        matchType: "exact_name",
        name: "ab-planner-sales-playbook",
      },
      status: "resolved",
    });
  });

  test("resolves visible Skill fixture names in generated full-sentence bind requests", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "skill",
        bindingState: ["not_bound"],
        reference: "please bind ab-planner-sales-followup-skill to this agent",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "skill",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        id: "skill_ab_planner_sales_followup",
        matchType: "exact_name",
        name: "ab-planner-sales-followup-skill",
      },
      status: "resolved",
    });
  });

  test("resolves visible Skill fixture names when hyphens are spoken as spaces", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "skill",
        bindingState: ["not_bound"],
        reference: "please bind ab planner sales followup skill to this agent",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "skill",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        id: "skill_ab_planner_sales_followup",
        matchType: "exact_name",
        name: "ab-planner-sales-followup-skill",
      },
      status: "resolved",
    });
  });

  test("accepts kind as a generated-code alias for assetType", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        bindingState: ["not_bound"],
        kind: "skill",
        query: "sales skill",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "skill",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        id: "skill_ab_planner_sales_followup",
        matchType: "single_candidate",
        name: "ab-planner-sales-followup-skill",
      },
      status: "resolved",
    });
  });

  test("resolves Environment abbreviations such as linear env", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "environment",
        bindingState: ["not_bound"],
        query: "linear env",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "environment",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        bindingState: "not_bound",
        id: "env_linear",
        matchType: "single_candidate",
        name: "Linear limited environment",
      },
      status: "resolved",
    });
  });

  test("resolves Environment fixture slugs when the user says planner env", async () => {
    const result = await createRuntimeWithResolveAssets(
      createResolveFixtureWithPlannerEnvironment(),
    ).execute({
      input: {
        assetType: "environment",
        bindingState: ["not_bound"],
        query: "planner env",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "environment",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        bindingState: "not_bound",
        id: "env_ab_planner_system_default",
        matchType: "single_candidate",
        name: "ab-planner-system-default",
      },
      status: "resolved",
    });
  });

  test("returns no_op when an Environment abbreviation matches the already-bound target", async () => {
    const result = await createRuntimeWithResolveAssets(
      createResolveFixtureWithBoundLinearEnvironment(),
    ).execute({
      input: {
        assetType: "environment",
        bindingState: ["not_bound"],
        query: "linear env",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      alreadyBound: true,
      assetType: "environment",
      candidateCount: 0,
      nextAction: "no_op",
      resolvedAsset: {
        bindingState: "bound",
        id: "env_linear",
        matchType: "single_candidate",
        name: "Linear limited environment",
      },
      status: "resolved",
    });
  });

  test("accepts assetName as a generated-code alias for reference text", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetName: "support-kb-2",
        assetType: "space",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      resolvedAsset: {
        assetType: "space",
        id: "space_support_2",
        matchType: "exact_name",
      },
      status: "resolved",
    });
  });

  test("considers exact name even when generated code also passes a noisy reference", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "space",
        name: "support-kb-2",
        query: "support-kb-2",
        reference: "support-kb-2 space",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      resolvedAsset: {
        id: "space_support_2",
        matchType: "exact_name",
      },
      status: "resolved",
    });
  });

  test("returns candidates when a name is ambiguous", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "skill",
        name: "Support Skill",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "skill",
      candidateCount: 2,
      nextAction: "ask_user",
      resolvedAsset: null,
      status: "ambiguous",
    });
    expect(outputCandidates(result.output).map((candidate) => candidate["id"])).toEqual([
      "skill_support",
      "skill_support_finance",
    ]);
  });

  const fuzzyAmbiguousCases = [
    {
      assetType: "skill",
      expectedAssetType: "skill",
      expectedIds: ["skill_ab_planner_sales_followup", "skill_ab_planner_support"],
      query: "planner skill",
    },
    {
      assetType: "mcp",
      expectedAssetType: "mcp_server",
      expectedIds: ["mcp_ab_planner_github", "mcp_ab_planner_linear"],
      query: "planner mcp",
    },
    {
      assetType: "environment",
      expectedAssetType: "environment",
      expectedIds: ["env_ab_planner_linear_limited", "env_ab_planner_system_default"],
      query: "planner env",
    },
    {
      assetType: "space",
      expectedAssetType: "space",
      expectedIds: ["space_ab_planner_sales_playbook", "space_ab_planner_support"],
      query: "planner space",
    },
  ] as const;

  for (const fuzzyCase of fuzzyAmbiguousCases) {
    test(`returns fuzzy ambiguous candidates for ${fuzzyCase.assetType}`, async () => {
      const result = await createRuntimeWithResolveAssets(
        createResolveFixtureWithAmbiguousPlannerAssets(),
      ).execute({
        input: {
          assetType: fuzzyCase.assetType,
          bindingState: ["not_bound"],
          query: fuzzyCase.query,
        },
        toolId: "resolve_asset_reference",
      });

      expect(result.output).toMatchObject({
        assetType: fuzzyCase.expectedAssetType,
        candidateCount: 2,
        nextAction: "ask_user",
        resolvedAsset: null,
        status: "ambiguous",
      });
      expect(
        sortedStrings(outputCandidates(result.output).map((candidate) => candidate["id"])),
      ).toEqual(sortedStrings(fuzzyCase.expectedIds));
    });
  }

  test("does not treat fake ids as valid assets", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetId: "skill_fake",
        assetType: "skill",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      candidateCount: 0,
      nextAction: "create_asset_or_block",
      resolvedAsset: null,
      status: "missing",
    });
  });
});
