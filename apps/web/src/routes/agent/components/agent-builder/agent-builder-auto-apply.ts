import type {
  AgentBuilderComponentDecision,
  AgentBuilderDraftPatchChange,
} from "@mosoo/contracts/agent-builder";
import { parseAgentBuilderPlannerOutputJson } from "@mosoo/contracts/agent-builder";
import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import type { McpServerWithCredential } from "@mosoo/contracts/mcp";

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

export function createCreatedEnvironmentBuilderPatch(input: {
  readonly baseDraftRevision: string;
  readonly baseEnvironmentDecision: AgentBuilderComponentDecision | null;
  readonly baseEnvironmentId: string | null;
  readonly environment: Pick<EnvironmentSummary, "id" | "name">;
}): AgentBuilderClientPatch {
  return {
    items: [
      {
        autoApply: true,
        baseDraftRevision: input.baseDraftRevision,
        baseValue: input.baseEnvironmentId,
        fieldPath: "environmentId",
        resolvedReferences: [
          {
            bindingState: "not_bound",
            id: input.environment.id,
            name: input.environment.name,
            targetType: "environment",
          },
        ],
        sectionId: "environment",
        value: input.environment.id,
      },
      {
        autoApply: true,
        baseDraftRevision: input.baseDraftRevision,
        baseValue: input.baseEnvironmentDecision,
        fieldPath: "componentDecisions.environment",
        sectionId: "environment",
        value: "created",
      },
    ],
  };
}

export function createCreatedMcpServerBuilderPatch(input: {
  readonly baseDraftRevision: string;
  readonly baseMcpServerIds: readonly string[];
  readonly mcpServer: Pick<McpServerWithCredential, "id" | "name" | "url">;
}): AgentBuilderClientPatch {
  const nextMcpServerIds = input.baseMcpServerIds.includes(input.mcpServer.id)
    ? [...input.baseMcpServerIds]
    : [...input.baseMcpServerIds, input.mcpServer.id];

  return {
    items: [
      {
        autoApply: true,
        baseDraftRevision: input.baseDraftRevision,
        baseValue: [...input.baseMcpServerIds],
        fieldPath: "mcpServerIds",
        resolvedReferences: [
          {
            bindingState: "not_bound",
            id: input.mcpServer.id,
            name: input.mcpServer.name,
            targetType: "mcp_server",
            url: input.mcpServer.url,
          },
        ],
        sectionId: "integrations",
        value: nextMcpServerIds,
      },
    ],
  };
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
