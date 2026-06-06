import { describe, expect, test } from "bun:test";

import type { AgentBuilderPlannerOutput } from "@mosoo/contracts/agent-builder";

import { parseAgentBuilderPlannerDraft } from "../src/modules/agent-builder/application/agent-builder-draft-parser";
import {
  applyAgentBuilderDraftPatchOutputToYaml,
  findNewRepairableDraftReadinessErrors,
  findRepairableDraftReadinessErrors,
} from "../src/modules/agent-builder/application/agent-builder-draft-patch-guardrail.service";
import {
  parseAgentBuilderPlannerRunId,
  parseMcpServerId,
} from "../src/modules/agent-builder/application/agent-builder-ids";

const draftYaml = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Old Agent",
  "  description: Old description.",
  "runtime:",
  "  id: openai-runtime",
  "  provider: openai",
  "  model: gpt-5.4",
  "prompt: Old prompt.",
  "environment:",
  "  environmentId: null",
  "assets:",
  "  skills: []",
  "  mcpServers: []",
  "  spaces: []",
].join("\n");

const GUARDRAIL_IDS = {
  mcpLinear: parseMcpServerId("01J00000000000000000000501"),
  plannerRun: parseAgentBuilderPlannerRunId("01J00000000000000000000502"),
} as const;

function plannerOutput(): AgentBuilderPlannerOutput {
  return {
    assistantText: "Updated the draft.",
    intentSummary: "Update the Agent Draft.",
    mode: "draft_patch",
    nodes: [
      {
        actions: [],
        draftPatch: {
          autoApply: true,
          fieldPath: "prompt",
          value: "New prompt.",
        },
        fieldPath: "prompt",
        kind: "draft_patch",
        nodeKey: "prompt",
        operation: "update",
        requiresConfirmation: false,
        status: "applied",
        summary: "Update prompt.",
        targetType: "draft",
      },
      {
        actions: [],
        draftPatch: {
          autoApply: true,
          fieldPath: "mcpServerIds",
          value: [GUARDRAIL_IDS.mcpLinear],
        },
        fieldPath: "mcpServerIds",
        kind: "draft_patch",
        nodeKey: "mcp",
        operation: "update",
        requiresConfirmation: false,
        status: "applied",
        summary: "Bind Linear MCP.",
        targetType: "draft",
      },
    ],
    plannerRunId: GUARDRAIL_IDS.plannerRun,
    version: 1,
  };
}

describe("Agent Builder draft patch guardrail", () => {
  test("simulates applied draft_patch nodes against Draft YAML", () => {
    const proposedYaml = applyAgentBuilderDraftPatchOutputToYaml(draftYaml, plannerOutput());
    const proposedDraft = parseAgentBuilderPlannerDraft(proposedYaml);

    expect(proposedDraft.prompt).toBe("New prompt.");
    expect(proposedDraft.mcpServerIds).toEqual([GUARDRAIL_IDS.mcpLinear]);
  });

  test("selects only Draft-repairable readiness errors for dry-run blocking", () => {
    expect(
      findRepairableDraftReadinessErrors({
        checkedAt: "2026-05-19T00:00:00.000Z",
        errorCount: 2,
        issues: [
          {
            code: "agent_builder.model.missing",
            message: "Draft model is required.",
            severity: "error",
          },
          {
            code: "agent.capability.agent.readiness.provider_credential.missing",
            message: "Provider key is required.",
            severity: "error",
          },
        ],
        ready: false,
        warningCount: 0,
      }),
    ).toEqual([
      {
        code: "agent_builder.model.missing",
        message: "Draft model is required.",
        severity: "error",
      },
    ]);
  });

  test("ignores pre-existing repairable readiness errors when evaluating a patch", () => {
    const before = {
      checkedAt: "2026-05-19T00:00:00.000Z",
      errorCount: 1,
      issues: [
        {
          code: "agent.capability.agent.readiness.model.unavailable",
          message: "Model claude-sonnet-4-5 is not available: needs-key. Next: Choose model.",
          severity: "error" as const,
        },
      ],
      ready: false,
      warningCount: 0,
    };
    const after = {
      ...before,
      checkedAt: "2026-05-19T00:01:00.000Z",
      issues: [
        ...before.issues,
        {
          code: "agent_builder.runtime.missing",
          message: "Draft runtime is required.",
          severity: "error" as const,
        },
      ],
    };

    expect(findNewRepairableDraftReadinessErrors({ after, before })).toEqual([
      {
        code: "agent_builder.runtime.missing",
        message: "Draft runtime is required.",
        severity: "error",
      },
    ]);
  });
});
