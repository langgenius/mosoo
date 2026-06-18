import type { JsonObject } from "@mosoo/contracts";
import type {
  AgentDeploymentVersion,
  AgentKind,
  AgentReadiness,
  AgentVisibility,
} from "@mosoo/contracts/agent";
import type { AgentConfigBuilderMetadata } from "@mosoo/contracts/agent";
import type { AgentPackageResolutionState } from "@mosoo/contracts/agent-manifest";
import type { McpAuthorizationState, McpCredentialStatus } from "@mosoo/contracts/mcp";

export type AgentStatus = "draft" | "published";
export type AgentRole = "owner" | "none";
export type AgentMode = "create" | "preview" | "dev" | "consume";
export type { AgentKind };

export type RuntimeId = string;

export interface RuntimeInfo {
  defaultModel: string;
  id: RuntimeId;
  name: string;
  provider: string;
  vendor: string;
  color: string;
  icon: string; // Fallback text when image unavailable
}

export interface ToolInfo {
  id: string;
  name: string;
  icon: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  filename: string;
  state?: "active" | "tombstone";
}

export interface McpServer {
  id: string;
  bindingId?: string;
  name: string;
  url: string;
  enabled: boolean;
  authorizationState?: McpAuthorizationState;
  iconUrl?: string; // Connector icon
  type?: "web" | "custom";
  source?: "app";
  /**
   * Credential resolution mode for this Agent × Server binding.
   * runtime_resolved = resolve at runtime from the active credential source.
   * agent_bound = persist the builder's credential on the agent itself.
   */
  credentialMode?: "runtime_resolved" | "agent_bound";
  credentialStatus?: McpCredentialStatus;
  /**
   * When credentialMode === "agent_bound", the human-readable subject label of
   * the bound credential (e.g. "alex@example.com" or "Bearer Token configured").
   */
  credentialSubject?: string;
}

export interface AgentConfig {
  builder: AgentConfigBuilderMetadata;
  environmentId: string | null;
  mcpServers: McpServer[];
  model: string;
  prompt: string;
  providerOptions: JsonObject;
  skills: SkillInfo[];
}

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface Agent {
  id: string;
  appId: string;
  kind: AgentKind;
  liveVersion: AgentDeploymentVersion | null;
  name: string;
  description: string;
  provider: string;
  readiness: AgentReadiness | null;
  runtime: RuntimeId;
  status: AgentStatus;
  tools: ToolInfo[];
  createdAt: string;
  updatedAt: string;
  versions: AgentDeploymentVersion[];
  visibility: AgentVisibility;
  owner: UserInfo;
  packageResolution: AgentPackageResolutionState | null;
  role: AgentRole;
  config: AgentConfig;
}
