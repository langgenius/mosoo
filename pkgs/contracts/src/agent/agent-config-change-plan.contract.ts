import type { EnvironmentId, FileId, McpServerId, SkillId, SpaceId } from "../id/id.contract";
import type { AgentKind, AgentStatus, RuntimeStateApplyActionKind } from "./agent.contract";
import { agentKindPreservesRuntimeState } from "./agent.contract";

export type AgentConfigChangeAction = "direct-update" | "fork-agent" | RuntimeStateApplyActionKind;

export interface AgentConfigChangeSkill {
  id: SkillId;
  state?: "active" | "tombstone";
}

export interface AgentConfigChangeSnapshot {
  agentsFileId: FileId | null;
  description: string;
  environmentId: EnvironmentId | null;
  kind: AgentKind;
  mcpServerIds: readonly McpServerId[];
  model: string;
  name: string;
  prompt: string;
  provider: string;
  runtimeId: string;
  skills: readonly AgentConfigChangeSkill[];
  spaceIds: readonly SpaceId[];
}

export interface AgentConfigChangePlan {
  action: AgentConfigChangeAction;
  actionLabel: string;
  agentStatePreserved: boolean;
  fieldLabels: string[];
  requiresDeploymentVersion: boolean;
  requiresRuntimeOperation: boolean;
}

interface FieldPlan {
  action: AgentConfigChangeAction;
  label: string;
  rank: number;
}

export const AGENT_CONFIG_CHANGE_ACTION_LABELS: Record<AgentConfigChangeAction, string> = {
  "direct-update": "Save changes",
  "fork-agent": "Fork Agent",
  "patch-and-restart": "Patch native config + restart",
  "recreate-preserving-state": "Recreate sandbox",
  "restart-process": "Restart Agent process",
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : "undefined";
}

function changed(left: unknown, right: unknown): boolean {
  return stableStringify(left) !== stableStringify(right);
}

function pushIfChanged(plans: FieldPlan[], input: FieldPlan & { changed: boolean }): void {
  if (!input.changed) {
    return;
  }

  plans.push({
    action: input.action,
    label: input.label,
    rank: input.rank,
  });
}

function requiresRuntimeAction(action: AgentConfigChangeAction): boolean {
  return (
    action === "restart-process" ||
    action === "patch-and-restart" ||
    action === "recreate-preserving-state"
  );
}

export function classifyAgentConfigChanges(input: {
  agentStatus: AgentStatus;
  current: AgentConfigChangeSnapshot;
  saved: AgentConfigChangeSnapshot;
}): AgentConfigChangePlan {
  const fieldPlans: FieldPlan[] = [];

  pushIfChanged(fieldPlans, {
    action: "direct-update",
    changed: input.current.name !== input.saved.name,
    label: "Name",
    rank: 0,
  });
  pushIfChanged(fieldPlans, {
    action: "direct-update",
    changed: input.current.description !== input.saved.description,
    label: "Description",
    rank: 0,
  });
  pushIfChanged(fieldPlans, {
    action: input.agentStatus === "published" ? "fork-agent" : "direct-update",
    changed: input.current.kind !== input.saved.kind,
    label: "Agent type",
    rank: 0,
  });
  pushIfChanged(fieldPlans, {
    action: "restart-process",
    changed: input.current.prompt !== input.saved.prompt,
    label: "System prompt",
    rank: 1,
  });
  pushIfChanged(fieldPlans, {
    action: "restart-process",
    changed: input.current.agentsFileId !== input.saved.agentsFileId,
    label: "AGENTS.md",
    rank: 1,
  });
  pushIfChanged(fieldPlans, {
    action: "patch-and-restart",
    changed: changed(input.current.mcpServerIds, input.saved.mcpServerIds),
    label: "MCP Servers",
    rank: 2,
  });
  pushIfChanged(fieldPlans, {
    action: "patch-and-restart",
    changed: input.current.model !== input.saved.model,
    label: "Model",
    rank: 2,
  });
  pushIfChanged(fieldPlans, {
    action: "patch-and-restart",
    changed: input.current.provider !== input.saved.provider,
    label: "Provider",
    rank: 2,
  });
  pushIfChanged(fieldPlans, {
    action: "patch-and-restart",
    changed: changed(input.current.skills, input.saved.skills),
    label: "Skills",
    rank: 2,
  });
  pushIfChanged(fieldPlans, {
    action: "recreate-preserving-state",
    changed: input.current.environmentId !== input.saved.environmentId,
    label: "Environment",
    rank: 3,
  });
  pushIfChanged(fieldPlans, {
    action: "recreate-preserving-state",
    changed: changed(input.current.spaceIds, input.saved.spaceIds),
    label: "Spaces",
    rank: 3,
  });
  pushIfChanged(fieldPlans, {
    action: input.agentStatus === "published" ? "fork-agent" : "direct-update",
    changed: input.current.runtimeId !== input.saved.runtimeId,
    label: "Runtime",
    rank: 4,
  });

  let highest: FieldPlan | null = null;

  for (const plan of fieldPlans) {
    if (!highest || plan.rank > highest.rank) {
      highest = plan;
    }
  }

  const forkPlan = fieldPlans.find((plan) => plan.action === "fork-agent");
  const action = forkPlan?.action ?? highest?.action ?? "direct-update";
  const requiresDeploymentVersion =
    input.agentStatus === "published" && action !== "direct-update" && action !== "fork-agent";
  const requiresRuntimeOperation =
    requiresDeploymentVersion &&
    agentKindPreservesRuntimeState(input.saved.kind) &&
    requiresRuntimeAction(action);
  const actionLabel =
    requiresDeploymentVersion && !requiresRuntimeOperation
      ? "Save for new sessions"
      : AGENT_CONFIG_CHANGE_ACTION_LABELS[action];

  return {
    action,
    actionLabel,
    agentStatePreserved: requiresRuntimeOperation,
    fieldLabels: fieldPlans.map((plan) => plan.label),
    requiresDeploymentVersion,
    requiresRuntimeOperation,
  };
}
