import type { AgentBuilderPlanNode, AgentBuilderToolPayload } from "@mosoo/contracts/agent-builder";

interface BlockedDraftPatchInput {
  readonly fieldPath: "environmentId" | "skillIds";
  readonly nodeKey: string;
  readonly summary: string;
}

function createBlockedDraftPatchOutput(
  input: BlockedDraftPatchInput,
  extra: AgentBuilderToolPayload,
): AgentBuilderToolPayload {
  const node: AgentBuilderPlanNode = {
    actions: [],
    fieldPath: input.fieldPath,
    kind: "draft_patch",
    nodeKey: input.nodeKey,
    operation: "blocked",
    requiresConfirmation: false,
    status: "blocked",
    summary: input.summary,
    targetType: "draft",
  };

  return {
    appliedCount: 0,
    blockedCount: 1,
    itemCount: 1,
    mode: "draft_patch",
    nodes: [node],
    patches: [],
    status: "blocked",
    ...extra,
  };
}

export function createBlockedEnvironmentBindOutput(input: {
  environmentName: string;
  nodeKey: string;
}): AgentBuilderToolPayload {
  return createBlockedDraftPatchOutput(
    {
      fieldPath: "environmentId",
      nodeKey: input.nodeKey,
      summary: "Draft already has a non-default Environment; target Environment was not bound.",
    },
    { targetEnvironmentName: input.environmentName },
  );
}

export function createBlockedSkillReplaceOutput(input: {
  nodeKey: string;
  reason: string;
  skillName: string;
}): AgentBuilderToolPayload {
  return createBlockedDraftPatchOutput(
    {
      fieldPath: "skillIds",
      nodeKey: input.nodeKey,
      summary: input.reason,
    },
    { targetSkillName: input.skillName },
  );
}
