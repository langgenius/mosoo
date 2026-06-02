import { describe, expect, test } from "bun:test";

import type { AgentEditorDraft } from "../src/routes/agent/components/editor/draft";
import { createDraftYamlHash } from "../src/routes/agent/components/editor/draft";
import { applyAgentEditorBuilderPatch } from "../src/routes/agent/components/editor/patch";

function draft(): AgentEditorDraft {
  return {
    agentsFileId: null,
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

describe("Agent Builder draft patch application", () => {
  test("applies safe scalar fields when the base value still matches", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(
      current,
      {
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
      },
      createDraftYamlHash(current),
    );

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["basics"]);
    expect(result.draft.name).toBe("Weather Assistant");
    expect(result.draft.prompt).toBe("Give concise weather guidance.");
  });

  test("blocks stale field updates instead of overwriting manual edits", () => {
    const current = { ...draft(), name: "Manual Edit" };
    const result = applyAgentEditorBuilderPatch(
      current,
      {
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
      },
      createDraftYamlHash(current),
    );

    expect(result.blockedItems).toHaveLength(1);
    expect(result.blockedItems[0]?.fieldPath).toBe("name");
    expect(result.blockedItems[0]?.reason.length).toBeGreaterThan(0);
    expect(result.draft.name).toBe("Manual Edit");
  });

  test("binds existing visible Skill and Space references", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(
      current,
      {
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
      },
      createDraftYamlHash(current),
    );

    expect(result.blockedItems).toEqual([]);
    expect(result.appliedSections).toEqual(["integrations", "environment"]);
    expect(result.draft.skills.map((skill) => skill.id)).toEqual(["skill_existing", "skill_new"]);
    expect(result.draft.spaces.map((space) => space.id)).toEqual(["space_existing", "space_new"]);
  });

  test("binds existing visible MCP references even when auth is not ready", () => {
    const current = draft();
    const result = applyAgentEditorBuilderPatch(
      current,
      {
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
      },
      createDraftYamlHash(current),
    );

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
    const result = applyAgentEditorBuilderPatch(
      current,
      {
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
      },
      createDraftYamlHash(current),
    );

    expect(result.blockedItems).toEqual([]);
    expect(result.draft.runtime).toBe("claude-agent-sdk");
    expect(result.draft.provider).toBe("anthropic");
    expect(result.draft.model).toBe("claude-sonnet-4-5");
  });
});
