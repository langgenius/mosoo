import { describe, expect, test } from "bun:test";

import { createResolveFixture } from "./agent-builder-resolve-asset-reference-fixtures";
import {
  createRuntimeWithResolveAssets,
  plannerContextWithEnvironmentQuestion,
  plannerContextWithMcpQuestion,
  plannerContextWithSkillQuestion,
  plannerContextWithSpaceQuestion,
} from "./agent-builder-resolve-asset-reference-runtime";

describe("resolve_asset_reference action references", () => {
  test("returns no_op when an exact Space id is already bound but the bind search filters to unbound assets", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetId: "space_support",
        assetType: "space",
        bindingState: ["not_bound"],
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      alreadyBound: true,
      assetType: "space",
      candidateCount: 0,
      nextAction: "no_op",
      resolvedAsset: {
        bindingState: "bound",
        id: "space_support",
        matchType: "exact_id",
        name: "support-kb",
      },
      status: "resolved",
    });
  });

  test("returns no_op when an exact Space name is already bound but the bind search filters to unbound assets", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "space",
        bindingState: ["not_bound"],
        name: "support-kb",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      alreadyBound: true,
      assetType: "space",
      candidateCount: 0,
      nextAction: "no_op",
      resolvedAsset: {
        bindingState: "bound",
        id: "space_support",
        matchType: "exact_name",
        name: "support-kb",
      },
      status: "resolved",
    });
  });

  test("returns no_op when an exact Skill name is already bound but the bind search filters to unbound assets", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "skill",
        bindingState: ["not_bound"],
        name: "Existing Skill",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      alreadyBound: true,
      assetType: "skill",
      candidateCount: 0,
      nextAction: "no_op",
      resolvedAsset: {
        bindingState: "bound",
        id: "skill_existing",
        matchType: "exact_name",
        name: "Existing Skill",
      },
      status: "resolved",
    });
  });

  test("resolves Space button labels by stripping the use-existing action prefix", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "space",
        bindingState: ["not_bound"],
        reference: "使用 support-kb-2",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "space",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        bindingState: "not_bound",
        id: "space_support_2",
        matchType: "exact_name",
        name: "support-kb-2",
      },
      status: "resolved",
    });
  });

  test("returns no_op for already-bound Space button labels after stripping the action prefix", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "space",
        bindingState: ["not_bound"],
        reference: "绑定现有 Space: support-kb",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      alreadyBound: true,
      assetType: "space",
      candidateCount: 0,
      nextAction: "no_op",
      resolvedAsset: {
        bindingState: "bound",
        id: "space_support",
        matchType: "exact_name",
        name: "support-kb",
      },
      status: "resolved",
    });
  });

  test("resolves Environment button labels by stripping the use-existing action prefix", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "environment",
        bindingState: ["not_bound"],
        reference: "使用 Linear limited environment",
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
        matchType: "exact_name",
        name: "Linear limited environment",
      },
      status: "resolved",
    });
  });

  test("returns no_op for already-bound Environment button labels after stripping the action prefix", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "environment",
        bindingState: ["not_bound"],
        reference: "绑定现有 Environment: Support Environment",
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
        id: "env_support",
        matchType: "exact_name",
        name: "Support Environment",
      },
      status: "resolved",
    });
  });

  test("accepts the mcp asset type alias and resolves a single text candidate", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "mcp",
        query: "github",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "mcp_server",
      resolvedAsset: {
        id: "mcp_github",
        matchType: "single_candidate",
        name: "GitHub MCP",
      },
      status: "resolved",
    });
    expect(JSON.stringify(result.output)).not.toContain("credential-secret");
  });

  test("resolves MCP button labels by stripping the use-existing action prefix", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "mcp",
        bindingState: ["not_bound"],
        reference: "绑定现有 MCP: GitHub MCP",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "mcp_server",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        bindingState: "not_bound",
        id: "mcp_github",
        matchType: "exact_name",
        name: "GitHub MCP",
      },
      status: "resolved",
    });
  });

  test("returns no_op for already-bound MCP button labels after stripping the action prefix", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "mcp_server",
        bindingState: ["not_bound"],
        reference: "使用现有 MCP Server: Linear MCP",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      alreadyBound: true,
      assetType: "mcp_server",
      candidateCount: 0,
      nextAction: "no_op",
      resolvedAsset: {
        bindingState: "bound",
        id: "mcp_linear",
        matchType: "exact_name",
        name: "Linear MCP",
      },
      status: "resolved",
    });
  });

  test("resolves Skill button labels by stripping the use-existing action prefix", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "skill",
        bindingState: ["not_bound"],
        reference: "绑定现有 Skill: Billing Skill",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "skill",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        bindingState: "not_bound",
        id: "skill_billing",
        matchType: "exact_name",
        name: "Billing Skill",
      },
      status: "resolved",
    });
  });

  test("returns no_op for already-bound Skill button labels after stripping the action prefix", async () => {
    const result = await createRuntimeWithResolveAssets().execute({
      input: {
        assetType: "skill",
        bindingState: ["not_bound"],
        reference: "使用现有 Skill: Existing Skill",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      alreadyBound: true,
      assetType: "skill",
      candidateCount: 0,
      nextAction: "no_op",
      resolvedAsset: {
        bindingState: "bound",
        id: "skill_existing",
        matchType: "exact_name",
        name: "Existing Skill",
      },
      status: "resolved",
    });
  });

  test("resolves ordinal Space choices from the latest pending Space question", async () => {
    const result = await createRuntimeWithResolveAssets(
      createResolveFixture(),
      plannerContextWithSpaceQuestion(),
    ).execute({
      input: {
        assetType: "space",
        reference: "用第二个",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "space",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        id: "space_support_2",
        matchType: "exact_name",
        name: "support-kb-2",
      },
      status: "resolved",
    });
  });

  test("resolves ordinal Environment choices from the latest pending Environment question", async () => {
    const result = await createRuntimeWithResolveAssets(
      createResolveFixture(),
      plannerContextWithEnvironmentQuestion(),
    ).execute({
      input: {
        assetType: "environment",
        reference: "用第一个",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "environment",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        id: "env_linear",
        matchType: "exact_name",
        name: "Linear limited environment",
      },
      status: "resolved",
    });
  });

  test("resolves ordinal MCP choices from the latest pending MCP question", async () => {
    const result = await createRuntimeWithResolveAssets(
      createResolveFixture(),
      plannerContextWithMcpQuestion(),
    ).execute({
      input: {
        assetType: "mcp_server",
        bindingState: ["not_bound"],
        reference: "用第二个",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "mcp_server",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        id: "mcp_github",
        matchType: "exact_name",
        name: "GitHub MCP",
      },
      status: "resolved",
    });
  });

  test("resolves ordinal Skill choices from the latest pending Skill question", async () => {
    const result = await createRuntimeWithResolveAssets(
      createResolveFixture(),
      plannerContextWithSkillQuestion(),
    ).execute({
      input: {
        assetType: "skill",
        bindingState: ["not_bound"],
        reference: "用第一个",
      },
      toolId: "resolve_asset_reference",
    });

    expect(result.output).toMatchObject({
      assetType: "skill",
      candidateCount: 0,
      nextAction: "use_resolved_id",
      resolvedAsset: {
        id: "skill_billing",
        matchType: "exact_name",
        name: "Billing Skill",
      },
      status: "resolved",
    });
  });

  test("fails unsupported asset types without throwing out of the runtime", async () => {
    await expect(
      createRuntimeWithResolveAssets().execute({
        input: {
          assetType: "secret",
          name: "prod key",
        },
        toolId: "resolve_asset_reference",
      }),
    ).resolves.toMatchObject({
      errorMessage: expect.stringContaining("secret"),
      output: null,
      status: "failed",
      toolId: "resolve_asset_reference",
    });
  });
});
