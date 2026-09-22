import { type } from "arktype";

import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  EnvironmentId,
  McpServerId,
  ProjectId,
  SkillId,
} from "../id/id.contract";
import type { AgentMcpBinding } from "../mcp/mcp.contract";
import type { JsonObject } from "../validation/primitives.contract";
import type { AgentPackageResolutionState } from "./agent-manifest.contract";

export const AGENT_KIND_VALUES = ["pet", "cattle"] as const;
export const AGENT_KIND_LIST_LABEL = AGENT_KIND_VALUES.join(" or ");
export const AgentKind = type.enumerated(...AGENT_KIND_VALUES);
export type AgentKind = typeof AgentKind.infer;
export type AgentRuntimeSubjectScope = "agent" | "session";
export type AgentRuntimeTerminalTarget = "stable_subject" | "unavailable";

export const AGENT_KIND_RUNTIME_SUBJECT_SCOPES = {
  cattle: "session",
  pet: "agent",
} as const satisfies Record<AgentKind, AgentRuntimeSubjectScope>;

export interface AgentKindRuntimePolicy {
  readonly kind: AgentKind;
  readonly operations: {
    readonly ownerTerminal: boolean;
    readonly resetSubjectState: boolean;
  };
  readonly stateRetention: {
    readonly preservesRuntimeState: boolean;
    readonly summary: string;
  };
  readonly subject: {
    readonly scope: AgentRuntimeSubjectScope;
    readonly stable: boolean;
    readonly summary: string;
  };
  readonly terminal: {
    readonly summary: string;
    readonly target: AgentRuntimeTerminalTarget;
  };
}

export const AGENT_KIND_RUNTIME_POLICIES = {
  cattle: {
    kind: "cattle",
    operations: {
      ownerTerminal: false,
      resetSubjectState: false,
    },
    stateRetention: {
      preservesRuntimeState: true,
      summary: "Thread workspace and resume state are preserved through Backup/Restore.",
    },
    subject: {
      scope: "session",
      stable: false,
      summary: "Session-scoped runtime subject, subject = session:{sessionId}.",
    },
    terminal: {
      summary: "Owner terminal is unavailable for session-scoped sandboxes.",
      target: "unavailable",
    },
  },
  pet: {
    kind: "pet",
    operations: {
      ownerTerminal: true,
      resetSubjectState: true,
    },
    stateRetention: {
      preservesRuntimeState: true,
      summary: "Agent sandbox state is preserved through Backup/Restore.",
    },
    subject: {
      scope: "agent",
      stable: true,
      summary: "Agent-scoped stable runtime subject, subject = agent:{agentId}.",
    },
    terminal: {
      summary: "Owner terminal connects to the stable agent sandbox.",
      target: "stable_subject",
    },
  },
} as const satisfies Record<AgentKind, AgentKindRuntimePolicy>;

export function getAgentKindRuntimeSubjectScope(kind: AgentKind): AgentRuntimeSubjectScope {
  return AGENT_KIND_RUNTIME_POLICIES[kind].subject.scope;
}

export function getAgentKindRuntimePolicy(kind: AgentKind): AgentKindRuntimePolicy {
  return AGENT_KIND_RUNTIME_POLICIES[kind];
}

export function agentKindUsesStableRuntimeSubject(kind: AgentKind): boolean {
  return getAgentKindRuntimePolicy(kind).subject.stable;
}

export function agentKindPreservesRuntimeState(kind: AgentKind): boolean {
  return getAgentKindRuntimePolicy(kind).stateRetention.preservesRuntimeState;
}

export function agentKindSupportsOwnerTerminal(kind: AgentKind): boolean {
  return getAgentKindRuntimePolicy(kind).operations.ownerTerminal;
}

export function agentKindSupportsResetState(kind: AgentKind): boolean {
  return getAgentKindRuntimePolicy(kind).operations.resetSubjectState;
}

export type AgentStatus = "draft" | "published";
export type AgentVisibility = "private";
export type AgentSkillState = "active" | "tombstone";
export type AgentViewerRole = "owner" | "none";
export const AGENT_BUILT_IN_TOOL_NAMES = [
  "bash",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "web_fetch",
  "web_search",
] as const;
export type AgentBuiltInToolName = (typeof AGENT_BUILT_IN_TOOL_NAMES)[number];

export interface AgentBuiltInToolConfig {
  enabled: boolean;
  name: AgentBuiltInToolName;
}

export function isAgentBuiltInToolName(value: unknown): value is AgentBuiltInToolName {
  return AGENT_BUILT_IN_TOOL_NAMES.some((toolName) => toolName === value);
}

export function createDefaultAgentBuiltInTools(): AgentBuiltInToolConfig[] {
  return AGENT_BUILT_IN_TOOL_NAMES.map((name) => ({
    enabled: true,
    name,
  }));
}

export function normalizeAgentBuiltInTools(
  tools: readonly AgentBuiltInToolConfig[],
): AgentBuiltInToolConfig[] {
  const enabledByName = new Map<AgentBuiltInToolName, boolean>(
    createDefaultAgentBuiltInTools().map((tool) => [tool.name, tool.enabled]),
  );

  for (const tool of tools) {
    enabledByName.set(tool.name, tool.enabled);
  }

  return AGENT_BUILT_IN_TOOL_NAMES.map((name) => ({
    enabled: enabledByName.get(name) ?? true,
    name,
  }));
}

// Keep this admission rule aligned with the Agent Driver provider registry.
export function getAgentBuiltInToolSupportError(
  runtimeId: string,
  tools: readonly AgentBuiltInToolConfig[],
): string | null {
  if (
    runtimeId === "claude-agent-sdk" ||
    !normalizeAgentBuiltInTools(tools).some((tool) => !tool.enabled)
  ) {
    return null;
  }
  return `Runtime ${runtimeId} does not support disabling built-in tools. Use Claude Agent SDK for tool restrictions, or explicitly enable all built-in tools if unrestricted tools are intended.`;
}

export interface AgentSkillReference {
  ownerName: string | null;
  skillId: SkillId;
  skillName: string;
  state: AgentSkillState;
}

export interface AgentEnvironmentConfig {
  environmentId: EnvironmentId | null;
}

export interface AgentOwnerSummary {
  id: AccountId;
  imageUrl: string | null;
  name: string | null;
}

export interface AgentToolSummary {
  enabled: boolean;
  iconUrl: string | null;
  name: string;
  serverId: McpServerId;
}

export interface AgentDeploymentVersion {
  agentId: AgentId;
  createdAt: string;
  createdByAccountId: AccountId;
  environmentId: EnvironmentId | null;
  id: AgentDeploymentVersionId;
  isLive: boolean;
  kind: AgentKind;
  model: string;
  provider: string;
  runtimeId: string;
  summary: string;
  versionNumber: number;
}

export interface AgentSummary {
  createdAt: string;
  description: string | null;
  id: AgentId;
  kind: AgentKind;
  name: string;
  owner: AgentOwnerSummary;
  runtimeId: string;
  status: AgentStatus;
  tools: AgentToolSummary[];
  updatedAt: string;
  viewerRole: AgentViewerRole;
  visibility: AgentVisibility;
  projectId: ProjectId;
}

export interface Agent {
  createdAt: string;
  description: string | null;
  id: AgentId;
  kind: AgentKind;
  liveVersion: AgentDeploymentVersion | null;
  model: string;
  name: string;
  prompt: string;
  provider: string;
  runtimeId: string;
  skills: AgentSkillReference[];
  status: AgentStatus;
  updatedAt: string;
  visibility: AgentVisibility;
  projectId: ProjectId;
}

export interface AgentDetail {
  createdAt: string;
  description: string | null;
  id: AgentId;
  kind: AgentKind;
  liveVersion: AgentDeploymentVersion | null;
  model: string;
  name: string;
  owner: AgentOwnerSummary;
  prompt: string;
  provider: string;
  runtimeId: string;
  skills: AgentSkillReference[];
  status: AgentStatus;
  tools: AgentToolSummary[];
  updatedAt: string;
  versions: AgentDeploymentVersion[];
  viewerRole: AgentViewerRole;
  visibility: AgentVisibility;
  projectId: ProjectId;
}

export interface AgentReadinessIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface AgentReadiness {
  checkedAt: string;
  issues: AgentReadinessIssue[];
  ready: boolean;
}

export interface AgentEditorState {
  builtInTools: AgentBuiltInToolConfig[];
  environment: AgentEnvironmentConfig;
  id: AgentId;
  packageResolution: AgentPackageResolutionState | null;
  mcpBindings: AgentMcpBinding[];
  providerOptions: JsonObject;
  readiness: AgentReadiness;
}

export interface CreateAgentInput {
  description?: string | null;
  /** Legacy input; every new Agent uses Session-isolated execution. */
  kind?: AgentKind | null;
  model: string;
  name: string;
  prompt: string;
  provider: string;
  runtimeId: string;
  skillIds: SkillId[];
  projectId: ProjectId;
}

export interface UpdateAgentConfigInput {
  agentId: AgentId;
  builtInTools?: AgentBuiltInToolConfig[];
  description?: string | null;
  environment: AgentEnvironmentConfig;
  /** Legacy input; changing configuration cannot migrate existing workspaces. */
  kind?: AgentKind | null;
  mcpServerIds: McpServerId[];
  model: string;
  name: string;
  prompt: string;
  provider: string;
  providerOptions: JsonObject;
  runtimeId: string;
  skillIds: SkillId[];
  projectId: ProjectId;
}

export interface DeleteAgentInput {
  agentId: AgentId;
  projectId: ProjectId;
}

export interface PublishAgentInput {
  agentId: AgentId;
  projectId: ProjectId;
}

export type RuntimeStateOperationName = "restartDriver" | "recreateSandbox" | "resetAgentState";
export type RuntimeStateApplyActionKind =
  | "patch-and-restart"
  | "recreate-preserving-state"
  | "restart-process";

export interface RuntimeStateTargetVersionInput {
  id: AgentDeploymentVersionId;
  versionNumber: number;
}

export interface RuntimeStateOperationInput {
  affectedFields?: string[] | null;
  agentId: AgentId;
  applyActionKind?: RuntimeStateApplyActionKind | null;
  projectId: ProjectId;
  targetVersion?: RuntimeStateTargetVersionInput | null;
}

export interface RuntimeStateOperationResult {
  affectedSessionCount: number;
  agentId: AgentId;
  ok: boolean;
  operation: RuntimeStateOperationName;
}
