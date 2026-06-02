import { parseAgentBuilderPlannerOutputJson } from "@mosoo/contracts/agent-builder";
import type { AgentBuilderDraftPatchChange } from "@mosoo/contracts/agent-builder";

import type { AgentBuilderMessage } from "@/domains/agent-builder/api/agent-builder-client";

export interface AgentBuilderPatchApplyResult {
  blockedItems: readonly {
    reason: string;
  }[];
  saveError?: string | null;
}

export interface AgentBuilderClientPatch {
  items: AgentBuilderDraftPatchChange[];
}

export function createAutoApplyDraftPatch(
  messages: AgentBuilderMessage[],
): AgentBuilderClientPatch | null {
  const assistantMessage = messages.toReversed().find((message) => message.role === "assistant");

  if (assistantMessage?.cardsJson === null || assistantMessage?.cardsJson === undefined) {
    return null;
  }

  const output = parseAgentBuilderPlannerOutputJson(assistantMessage.cardsJson);

  if (output === null || output.mode !== "draft_patch") {
    return null;
  }

  const items: AgentBuilderDraftPatchChange[] = [];

  for (const node of output.nodes) {
    const draftPatch = node.draftPatch;

    if (draftPatch?.autoApply !== true || node.status !== "applied") {
      continue;
    }

    items.push(draftPatch);
  }

  return items.length > 0 ? { items } : null;
}
