import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import { classifyAgentConfigChanges } from "@mosoo/contracts/agent-config-change-plan";
import type {
  AgentConfigChangePlan,
  AgentConfigChangeSnapshot,
} from "@mosoo/contracts/agent-config-change-plan";
import { isSupportedDriverRuntime } from "@mosoo/driver-protocol";
import type { DriverRuntime } from "@mosoo/driver-protocol";
import type { AccountId, AgentId, McpServerId, SkillId, SpaceId } from "@mosoo/id";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

import {
  isSpaceRoleRankSufficient,
  listSpaceAccessRows,
} from "../../spaces/domain/space-access.policy";
import { listEditableAgentSkillReferences } from "./agent-deployment-version.service";
import type { AgentRow } from "./agent-types";

class AgentRuntimeForkRequiredError extends Error {
  public constructor() {
    super(
      "Runtime change is not allowed in place on a published Agent. Fork Agent to change runtime; sessions, logs, cost, and agent-state stay attached to the original Agent.",
    );
    this.name = "AgentRuntimeForkRequiredError";
  }
}

export type AgentRuntimeSelectionResult =
  | {
      ok: true;
      runtimeId: DriverRuntime;
    }
  | {
      message: string;
      ok: false;
    };

export function evaluateAgentRuntimeSelection(input: {
  model: string;
  provider: string;
  runtimeId: string;
}): AgentRuntimeSelectionResult {
  const entry = getRuntimeCatalogEntry(input.runtimeId);

  if (entry === null || !isSupportedDriverRuntime(entry.runtimeId)) {
    return {
      message: `Unsupported runtime: ${input.runtimeId}.`,
      ok: false,
    };
  }

  if (entry.disabledReason !== undefined && entry.disabledReason !== "") {
    return {
      message: entry.disabledReason,
      ok: false,
    };
  }

  return {
    ok: true,
    runtimeId: entry.runtimeId,
  };
}

export async function ensureAgentOwnerCanReadBoundSpaces(
  database: D1Database,
  ownerId: AccountId,
  boundSpaceIds: readonly SpaceId[],
): Promise<void> {
  const uniqueSpaceIds = [...new Set(boundSpaceIds)];
  const access = await listSpaceAccessRows(database, ownerId, uniqueSpaceIds);

  for (const spaceId of uniqueSpaceIds) {
    const row = access.accessibleRowsById.get(spaceId);

    if (!access.existingSpaceIds.has(spaceId)) {
      throw new Error(`Cannot bind Space ${spaceId}: Space not found.`);
    }

    if (!row || !isSpaceRoleRankSufficient(row.role_rank, "read")) {
      throw new Error(`Cannot bind Space ${spaceId}: Insufficient space permission.`);
    }
  }
}

export async function listAgentSkillIds(
  database: D1Database,
  agentId: AgentId,
): Promise<SkillId[]> {
  const skills = await listEditableAgentSkillReferences(database, agentId);
  return skills.map((skill) => skill.skillId);
}

export function createAgentConfigChangeSnapshot(input: {
  agent: Pick<
    AgentRow,
    "description" | "kind" | "model" | "name" | "prompt" | "provider" | "runtimeId"
  >;
  environment: AgentEnvironmentConfig;
  mcpServerIds: readonly McpServerId[];
  skillIds: readonly SkillId[];
}): AgentConfigChangeSnapshot {
  return {
    description: input.agent.description ?? "",
    environmentId: input.environment.environmentId,
    kind: input.agent.kind,
    mcpServerIds: input.mcpServerIds,
    model: input.agent.model,
    name: input.agent.name,
    prompt: input.agent.prompt,
    provider: input.agent.provider,
    runtimeId: input.agent.runtimeId,
    skills: input.skillIds.map((id) => ({ id, state: "active" as const })),
    spaceIds: input.environment.boundSpaceIds,
  };
}

export function planVersionedAgentConfigChange(input: {
  agentStatus: AgentRow["status"];
  current: AgentConfigChangeSnapshot;
  next: AgentConfigChangeSnapshot;
}): AgentConfigChangePlan {
  return classifyAgentConfigChanges({
    agentStatus: input.agentStatus,
    current: input.next,
    saved: input.current,
  });
}

export function summarizeVersionedAgentConfigChange(plan: AgentConfigChangePlan): string {
  if (plan.fieldLabels.length === 0) {
    return "Configuration updated";
  }

  return `${plan.actionLabel} · ${plan.fieldLabels.join(", ")}`;
}

export function enforcePublishedRuntimeStability(
  agent: Pick<AgentRow, "runtimeId" | "status">,
  runtimeId: string,
): void {
  if (agent.status === "published" && runtimeId !== agent.runtimeId) {
    throw new AgentRuntimeForkRequiredError();
  }
}
