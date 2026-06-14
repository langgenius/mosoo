import { describe, expect, test } from "bun:test";

import type { AgentBuilderMessage } from "../src/domains/agent-builder/api/agent-builder-client";
import {
  createAutoApplyDraftPatch,
  createCreatedEnvironmentBuilderPatch,
  createCreatedMcpServerBuilderPatch,
} from "../src/routes/agent/components/agent-builder/agent-builder-auto-apply";
import type { AgentEditorDraft } from "../src/routes/agent/components/editor/draft";
import {
  createDraftYamlHash,
  createEditorSaveSnapshot,
} from "../src/routes/agent/components/editor/draft";
import { applyAgentEditorBuilderPatch } from "../src/routes/agent/components/editor/patch";

function draft(): AgentEditorDraft {
  return {
    componentDecisions: {},
    description: "Old description.",
    environmentId: null,
    kind: "pet",
    mcpServers: [
      {
        credentialMode: "runtime_resolved",
        enabled: true,
        id: "mcp_existing",
        name: "Existing MCP",
        type: "web",
        url: "https://mcp.example.com",
      },
    ],
    model: "gpt-5.4",
    name: "Old Agent",
    prompt: "Old prompt.",
    provider: "openai",
    runtime: "openai-runtime",
    skills: [
      {
        filename: "existing.md",
        id: "skill_existing",
        name: "Existing Skill",
      },
    ],
    spaces: [{ id: "space_existing", name: "Existing Space" }],
  };
}

function builderMessage(overrides: Partial<AgentBuilderMessage>): AgentBuilderMessage {
  return {
    cardsJson: null,
    contentText: "Builder message",
    createdAt: "2026-06-07T09:00:00.000Z",
    createdByAccountId: null,
    id: "builder_message_1",
    inputKind: null,
    plannerRunId: null,
    role: "assistant",
    seq: 1,
    threadId: "builder_thread_1",
    ...overrides,
  };
}

describe("Agent Builder draft patch application", () => {
  test("extracts auto-apply patches from mixed draft patch and action planner output", () => {
    const patch = createAutoApplyDraftPatch([
      builderMessage({
        cardsJson: JSON.stringify({
          assistantText: "Apply an existing MCP and open secure creation UI.",
          intentSummary: "Mixed MCP binding and secure action.",
          mode: "draft_patch",
          nodes: [
            {
              actions: [],
              draftPatch: {
                autoApply: true,
                baseDraftRevision: "draft_hash",
                baseValue: ["mcp_existing"],
                fieldPath: "mcpServerIds",
                sectionId: "integrations",
                value: ["mcp_existing", "mcp_needs_auth"],
              },
              kind: "draft_patch",
              nodeKey: "patch_mcp_servers",
              operation: "bind",
              requiresConfirmation: false,
              status: "applied",
              summary: "Bind selected MCP servers.",
              targetType: "draft",
            },
            {
              actions: [
                {
                  actionKey: "create_remote_mcp_server",
                  label: "Create remote MCP server",
                  style: "primary",
                },
              ],
              kind: "action",
              nodeKey: "show_next_action:create_remote_mcp_server",
              operation: "show",
              requiresConfirmation: false,
              status: "pending",
              summary: "Open the secure remote MCP server creation UI.",
              targetType: "workflow",
            },
          ],
          plannerRunId: "planner_run_1",
          version: 1,
        }),
      }),
    ]);

    expect(patch?.items).toEqual([
      {
        autoApply: true,
        baseDraftRevision: "draft_hash",
        baseValue: ["mcp_existing"],
        fieldPath: "mcpServerIds",
        sectionId: "integrations",
        value: ["mcp_existing", "mcp_needs_auth"],
      },
    ]);
  });

  test("applies scalar fields from the accepted Builder patch", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: current.name,
          fieldPath: "name",
          sectionId: "basics",
          value: "Weather Assistant",
        },
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: current.prompt,
          fieldPath: "prompt",
          sectionId: "basics",
          value: "Give concise weather guidance.",
        },
      ],
    });

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["basics"]);
    expect(result.draft.name).toBe("Weather Assistant");
    expect(result.draft.prompt).toBe("Give concise weather guidance.");
  });

  test("uses last-writer-wins ordering when Builder patch follows a manual edit", () => {
    const current = { ...draft(), name: "Manual Edit" };
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: "old-hash",
          baseValue: "Old Agent",
          fieldPath: "name",
          sectionId: "basics",
          value: "Builder Edit",
        },
      ],
    });

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["basics"]);
    expect(result.draft.name).toBe("Builder Edit");
  });

  test("binds existing visible Skill and Space references", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: ["skill_existing"],
          fieldPath: "skillIds",
          resolvedReferences: [
            {
              bindingState: "not_bound",
              filename: "skill_new.md",
              id: "skill_new",
              name: "New Skill",
              targetType: "skill",
            },
          ],
          sectionId: "integrations",
          value: ["skill_existing", "skill_new"],
        },
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: ["space_existing"],
          fieldPath: "spaceIds",
          resolvedReferences: [
            {
              bindingState: "not_bound",
              id: "space_new",
              name: "New Space",
              targetType: "space",
            },
          ],
          sectionId: "environment",
          value: ["space_existing", "space_new"],
        },
      ],
    });

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["integrations", "environment"]);
    expect(result.draft.skills.map((skill) => skill.id)).toEqual(["skill_existing", "skill_new"]);
    expect(result.draft.spaces.map((space) => space.id)).toEqual(["space_existing", "space_new"]);
  });

  test("binds existing visible MCP references even when auth is not ready", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: ["mcp_existing"],
          fieldPath: "mcpServerIds",
          resolvedReferences: [
            {
              bindingState: "not_bound",
              id: "mcp_needs_auth",
              name: "Needs Auth MCP",
              targetType: "mcp_server",
            },
          ],
          sectionId: "integrations",
          value: ["mcp_existing", "mcp_needs_auth"],
        },
      ],
    });

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["integrations"]);
    expect(result.draft.mcpServers.map((server) => server.id)).toEqual([
      "mcp_existing",
      "mcp_needs_auth",
    ]);
    expect(result.draft.mcpServers.at(-1)?.credentialMode).toBe("runtime_resolved");
  });

  test("applies runtime provider model patches as Draft-only edits", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: current.runtime,
          fieldPath: "runtimeId",
          sectionId: "basics",
          value: "claude-agent-sdk",
        },
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: current.provider,
          fieldPath: "provider",
          sectionId: "basics",
          value: "anthropic",
        },
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: current.model,
          fieldPath: "model",
          sectionId: "basics",
          value: "claude-sonnet-4-5",
        },
      ],
    });

    expect(result.blockedItems).toEqual([]);
    expect(result.draft.runtime).toBe("claude-agent-sdk");
    expect(result.draft.provider).toBe("anthropic");
    expect(result.draft.model).toBe("claude-sonnet-4-5");
  });

  test("blocks invalid scalar patch values without changing the draft", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: current.name,
          fieldPath: "name",
          sectionId: "basics",
          value: ["not-a-string"],
        },
      ],
    });

    expect(result.appliedSections).toEqual([]);
    expect(result.blockedItems).toEqual([
      {
        fieldPath: "name",
        reason: "Expected a string name.",
      },
    ]);
    expect(result.draft).toBe(current);
  });

  test("blocks unsupported agent kind values", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: current.kind,
          fieldPath: "kind",
          sectionId: "basics",
          value: "dog",
        },
      ],
    });

    expect(result.appliedSections).toEqual([]);
    expect(result.blockedItems).toEqual([
      {
        fieldPath: "kind",
        reason: "Expected agent kind to be pet or cattle.",
      },
    ]);
    expect(result.draft.kind).toBe("pet");
  });

  test("blocks missing visible asset references instead of silently dropping them", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: ["skill_existing"],
          fieldPath: "skillIds",
          resolvedReferences: [],
          sectionId: "integrations",
          value: ["skill_existing", "skill_missing"],
        },
      ],
    });

    expect(result.appliedSections).toEqual([]);
    expect(result.blockedItems).toEqual([
      {
        fieldPath: "skillIds",
        reason: "Missing visible Skill references: skill_missing.",
      },
    ]);
    expect(result.draft.skills.map((skill) => skill.id)).toEqual(["skill_existing"]);
  });

  test("preserves current tombstone Skill state when applying replacement Skill bindings", () => {
    const current = {
      ...draft(),
      skills: [
        {
          filename: "skill_existing.md",
          id: "skill_existing",
          name: "Existing Skill",
        },
        {
          filename: "skill_deleted.md",
          id: "skill_deleted",
          name: "Deleted Skill",
          state: "tombstone" as const,
        },
      ],
    };
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: ["skill_existing", "skill_deleted"],
          fieldPath: "skillIds",
          sectionId: "integrations",
          value: ["skill_deleted"],
        },
      ],
    });

    expect(result.blockedItems).toEqual([]);
    expect(result.draft.skills).toEqual([
      {
        filename: "skill_deleted.md",
        id: "skill_deleted",
        name: "Deleted Skill",
        state: "tombstone",
      },
    ]);
  });

  test("applies durable Environment skip decision patches", () => {
    const current = {
      ...draft(),
      componentDecisions: { environment: "bound" as const },
      environmentId: "01J0000000000000000000E001",
      mcpServers: [],
      skills: [],
      spaces: [],
    };
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: null,
          fieldPath: "componentDecisions.environment",
          sectionId: "environment",
          value: "skipped",
        },
      ],
    });

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["environment"]);
    expect(result.draft.componentDecisions.environment).toBe("skipped");
    expect(result.draft.environmentId).toBeNull();
    expect(createEditorSaveSnapshot(result.draft)).not.toBe(createEditorSaveSnapshot(current));
  });

  test("binding Environment clears a previous skip decision", () => {
    const current = {
      ...draft(),
      componentDecisions: { environment: "skipped" as const },
    };
    const result = applyAgentEditorBuilderPatch(current, {
      items: [
        {
          autoApply: true,
          baseDraftRevision: createDraftYamlHash(current),
          baseValue: null,
          fieldPath: "environmentId",
          sectionId: "environment",
          value: "env_selected",
        },
      ],
    });

    expect(result.blockedItems).toEqual([]);
    expect(result.draft.environmentId).toBe("env_selected");
    expect(result.draft.componentDecisions.environment).toBe("bound");
  });

  test("binding a newly created Environment records the created decision", () => {
    const current = {
      ...draft(),
      componentDecisions: { environment: "skipped" as const },
    };
    const result = applyAgentEditorBuilderPatch(
      current,
      createCreatedEnvironmentBuilderPatch({
        baseDraftRevision: createDraftYamlHash(current),
        baseEnvironmentDecision: current.componentDecisions.environment,
        baseEnvironmentId: current.environmentId,
        environment: {
          allowMcpServers: true,
          allowPackageManagers: true,
          allowedHosts: [],
          canDelete: true,
          canEdit: true,
          createdAt: "2026-06-06T00:00:00.000Z",
          currentRevisionId: "env_rev_created",
          description: "Created by Builder",
          envVars: [],
          forkOrigin: null,
          id: "env_created",
          isBuiltIn: false,
          isDefault: false,
          isEditable: true,
          name: "Created Environment",
          networkPolicy: "full",
          owner: {
            id: "acct_owner",
            imageUrl: null,
            name: "Owner",
          },
          packages: [],
          role: "owner",
          setupScript: "",
          updatedAt: "2026-06-06T00:00:00.000Z",
          usedByAgentCount: 0,
          appId: "app_builder",
        },
      }),
    );

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["environment"]);
    expect(result.draft.environmentId).toBe("env_created");
    expect(result.draft.componentDecisions.environment).toBe("created");
  });

  test("binding a newly created remote MCP server appends it to the manifest", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(
      current,
      createCreatedMcpServerBuilderPatch({
        baseDraftRevision: createDraftYamlHash(current),
        baseMcpServerIds: current.mcpServers.map((server) => server.id),
        mcpServer: {
          id: "mcp_created",
          name: "Created MCP",
          url: "https://mcp.created.example.com",
        },
      }),
    );

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["integrations"]);
    expect(result.draft.mcpServers.map((server) => server.id)).toEqual([
      "mcp_existing",
      "mcp_created",
    ]);
    expect(result.draft.mcpServers.at(-1)).toMatchObject({
      credentialMode: "runtime_resolved",
      enabled: true,
      id: "mcp_created",
      name: "Created MCP",
      type: "web",
      url: "https://mcp.created.example.com",
    });
  });
});
