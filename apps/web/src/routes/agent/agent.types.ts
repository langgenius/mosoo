import type { JsonObject } from "@mosoo/contracts";
import type {
  AgentBuiltInToolConfig,
  AgentDeploymentVersion,
  AgentReadiness,
} from "@mosoo/contracts/agent";
import type { AgentPackageResolutionState } from "@mosoo/contracts/agent-manifest";

export type AgentStatus = "draft" | "published";

export type RuntimeId = string;

export interface RuntimeInfo {
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
  state?: "active" | "tombstone";
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  iconUrl?: string; // Connector icon
}

export interface AgentConfig {
  builtInTools: AgentBuiltInToolConfig[];
  environmentId: string | null;
  mcpServers: McpServer[];
  model: string;
  prompt: string;
  providerOptions: JsonObject;
  skills: SkillInfo[];
}

export interface Agent {
  id: string;
  projectId: string;
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
  packageResolution: AgentPackageResolutionState | null;
  config: AgentConfig;
}
