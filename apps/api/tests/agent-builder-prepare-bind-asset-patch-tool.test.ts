import { describe, expect, test } from "bun:test";

import {
  BIND_ASSET_IDS,
  apiBindings,
  contextWithVisibleMcpServer,
  createEnvironmentBindingDatabase,
  createRuntime,
  draftYaml,
  outputNodes,
  outputPatches,
  plannerContext,
} from "./agent-builder-prepare-bind-asset-patch-tool-fixtures";

describe("prepare bind asset patch tools", () => {
  test("prepare_bind_space_patch creates a normalized Space binding patch", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: BIND_ASSET_IDS.spaceCreated,
        assetName: "Ignored injected name",
        nodeKey: "node-create-space_bind_created_space",
      },
      toolId: "prepare_bind_space_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 1,
      blockedCount: 0,
      mode: "draft_patch",
      status: "ready",
    });
    expect(outputNodes(result.output)[0]).toMatchObject({
      fieldPath: "spaceIds",
      nodeKey: "node-create-space_bind_created_space",
      operation: "bind",
      status: "applied",
    });
    expect(outputPatches(result.output)[0]).toMatchObject({
      autoApply: true,
      baseDraftRevision: "draft-rev-1",
      baseValue: [],
      fieldPath: "spaceIds",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: BIND_ASSET_IDS.spaceCreated,
          name: "support-kb",
          targetType: "space",
        },
      ],
      sectionId: "environment",
      value: [BIND_ASSET_IDS.spaceCreated],
    });
  });

  test("prepare_bind_space_patch rejects assets missing from the visible index", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: BIND_ASSET_IDS.unknownSpace,
        assetName: "Unadmitted Space",
      },
      toolId: "prepare_bind_space_patch",
    });

    expect(result).toMatchObject({
      errorMessage: `Agent Builder cannot bind space ${BIND_ASSET_IDS.unknownSpace}: asset is not in the visible asset index.`,
      status: "failed",
    });
  });

  test("prepare_bind_environment_patch creates a normalized Environment binding patch", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: BIND_ASSET_IDS.environmentCreated,
        assetName: "Python Support",
        nodeKey: "node-create-environment_bind_created_environment",
      },
      toolId: "prepare_bind_environment_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 1,
      blockedCount: 0,
      mode: "draft_patch",
      status: "ready",
    });
    expect(outputPatches(result.output)[0]).toMatchObject({
      autoApply: true,
      baseDraftRevision: "draft-rev-1",
      baseValue: null,
      fieldPath: "environmentId",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: BIND_ASSET_IDS.environmentCreated,
          name: "Python Support",
          targetType: "environment",
        },
      ],
      sectionId: "environment",
      value: BIND_ASSET_IDS.environmentCreated,
    });
  });

  test("prepare_bind_mcp_patch creates a normalized MCP Server binding patch", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: BIND_ASSET_IDS.mcpGithub,
        assetName: "GitHub MCP",
        nodeKey: "node-bind-github-mcp",
      },
      toolId: "prepare_bind_mcp_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 1,
      blockedCount: 0,
      mode: "draft_patch",
      status: "ready",
    });
    expect(outputNodes(result.output)[0]).toMatchObject({
      fieldPath: "mcpServerIds",
      nodeKey: "node-bind-github-mcp",
      operation: "bind",
      status: "applied",
    });
    expect(outputPatches(result.output)[0]).toMatchObject({
      autoApply: true,
      baseDraftRevision: "draft-rev-1",
      baseValue: [],
      fieldPath: "mcpServerIds",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: BIND_ASSET_IDS.mcpGithub,
          name: "GitHub MCP",
          targetType: "mcp_server",
        },
      ],
      sectionId: "integrations",
      value: [BIND_ASSET_IDS.mcpGithub],
    });
  });

  test("prepare_bind_mcp_patch infers assetName from visible context when generated code passes only assetId", async () => {
    const result = await createRuntime(contextWithVisibleMcpServer()).execute({
      input: {
        assetId: BIND_ASSET_IDS.mcpVisible,
      },
      toolId: "prepare_bind_mcp_patch",
    });

    expect(result.status).toBe("completed");
    expect(outputNodes(result.output)[0]).toMatchObject({
      draftPatch: {
        resolvedReferences: [
          {
            bindingState: "not_bound",
            id: BIND_ASSET_IDS.mcpVisible,
            name: "ab-planner-linear-mcp",
            targetType: "mcp_server",
          },
        ],
        value: [BIND_ASSET_IDS.mcpVisible],
      },
      fieldPath: "mcpServerIds",
      status: "applied",
    });
  });

  test("prepare_bind_skill_patch creates a normalized Skill binding patch", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: BIND_ASSET_IDS.skillTicketTriage,
        assetName: "Ticket Triage Skill",
        nodeKey: "node-bind-ticket-triage-skill",
      },
      toolId: "prepare_bind_skill_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 1,
      blockedCount: 0,
      mode: "draft_patch",
      status: "ready",
    });
    expect(outputNodes(result.output)[0]).toMatchObject({
      fieldPath: "skillIds",
      nodeKey: "node-bind-ticket-triage-skill",
      operation: "bind",
      status: "applied",
    });
    expect(outputPatches(result.output)[0]).toMatchObject({
      autoApply: true,
      baseDraftRevision: "draft-rev-1",
      baseValue: [],
      fieldPath: "skillIds",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: BIND_ASSET_IDS.skillTicketTriage,
          name: "Ticket Triage Skill",
          targetType: "skill",
        },
      ],
      sectionId: "integrations",
      value: [BIND_ASSET_IDS.skillTicketTriage],
    });
  });

  test("prepare_replace_skill_patch replaces the only bound Skill", async () => {
    const result = await createRuntime(
      plannerContext({
        draftYaml: draftYaml({ skillIds: [BIND_ASSET_IDS.skillOld] }),
      }),
    ).execute({
      input: {
        assetId: BIND_ASSET_IDS.skillNew,
        assetName: "New Skill",
        nodeKey: "node-replace-skill",
      },
      toolId: "prepare_replace_skill_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 1,
      blockedCount: 0,
      mode: "draft_patch",
      status: "ready",
    });
    expect(outputPatches(result.output)[0]).toMatchObject({
      baseValue: [BIND_ASSET_IDS.skillOld],
      fieldPath: "skillIds",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: BIND_ASSET_IDS.skillNew,
          name: "New Skill",
          targetType: "skill",
        },
      ],
      sectionId: "integrations",
      value: [BIND_ASSET_IDS.skillNew],
    });
  });

  test("prepare_replace_skill_patch blocks ambiguous multi-Skill replacement", async () => {
    const result = await createRuntime(
      plannerContext({
        draftYaml: draftYaml({ skillIds: [BIND_ASSET_IDS.skillA, BIND_ASSET_IDS.skillB] }),
      }),
    ).execute({
      input: {
        assetId: BIND_ASSET_IDS.skillNew,
        assetName: "New Skill",
      },
      toolId: "prepare_replace_skill_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 0,
      blockedCount: 1,
      mode: "draft_patch",
      status: "blocked",
      targetSkillName: "New Skill",
    });
    expect(outputNodes(result.output)[0]).toMatchObject({
      fieldPath: "skillIds",
      operation: "blocked",
      status: "blocked",
    });
  });

  test("prepare_bind_environment_patch blocks instead of overwriting a non-default Environment", async () => {
    const database = createEnvironmentBindingDatabase();
    const result = await createRuntime(
      plannerContext({
        draftYaml: draftYaml({ environmentId: BIND_ASSET_IDS.environmentCurrent }),
      }),
      apiBindings(database),
    ).execute({
      input: {
        assetId: BIND_ASSET_IDS.environmentCreated,
        assetName: "Python Support",
      },
      toolId: "prepare_bind_environment_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 0,
      blockedCount: 1,
      mode: "draft_patch",
      status: "blocked",
      targetEnvironmentName: "Python Support",
    });
    expect(outputNodes(result.output)[0]).toMatchObject({
      fieldPath: "environmentId",
      operation: "blocked",
      status: "blocked",
    });
  });

  test("prepare_bind_environment_patch fails when the current Draft Environment is missing", async () => {
    const database = createEnvironmentBindingDatabase();
    const result = await createRuntime(
      plannerContext({
        draftYaml: draftYaml({ environmentId: BIND_ASSET_IDS.environmentMissing }),
      }),
      apiBindings(database),
    ).execute({
      input: {
        assetId: BIND_ASSET_IDS.environmentCreated,
        assetName: "Python Support",
      },
      toolId: "prepare_bind_environment_patch",
    });

    expect(result).toMatchObject({
      errorMessage: `Current draft Environment ${BIND_ASSET_IDS.environmentMissing} was not found.`,
      status: "failed",
    });
  });

  test("prepare_bind_environment_patch allows replacing a non-default Environment after explicit replacement input", async () => {
    const database = createEnvironmentBindingDatabase();
    const result = await createRuntime(
      plannerContext({
        draftYaml: draftYaml({ environmentId: BIND_ASSET_IDS.environmentCurrent }),
        turnInputText: "replace with Python 数据分析环境",
      }),
      apiBindings(database),
    ).execute({
      input: {
        assetId: BIND_ASSET_IDS.environmentPython,
        assetName: "Python 数据分析环境",
        replaceCurrentNonDefaultEnvironment: true,
      },
      toolId: "prepare_bind_environment_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 1,
      blockedCount: 0,
      mode: "draft_patch",
      status: "ready",
    });
    expect(outputPatches(result.output)[0]).toMatchObject({
      baseValue: BIND_ASSET_IDS.environmentCurrent,
      fieldPath: "environmentId",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: BIND_ASSET_IDS.environmentPython,
          name: "Python 数据分析环境",
          targetType: "environment",
        },
      ],
      value: BIND_ASSET_IDS.environmentPython,
    });
  });
});
