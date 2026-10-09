import type {
  AgentDetail,
  AgentEditorState,
  AgentEnvironmentConfig,
  AgentSkillReference,
  AgentSummary,
} from "@mosoo/contracts/agent";
import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";

import type { Agent, AgentStatus, McpServer, SkillInfo, ToolInfo } from "./agent.types";
const DEFAULT_ENVIRONMENT_CONFIG: AgentEnvironmentConfig = {
  environmentId: null,
};

function toAgentStatus(status: string | null | undefined): AgentStatus {
  if (status === "published") {
    return "published";
  }
  return "draft";
}

function toSkillInfo(skill: AgentSkillReference): SkillInfo {
  return {
    id: skill.skillId,
    name: skill.skillName,
    state: skill.state,
  };
}

function toToolInfo(binding: AgentSummary["tools"][number]): ToolInfo {
  return {
    icon: binding.name.charAt(0).toUpperCase(),
    id: binding.serverId,
    name: binding.name,
  };
}

function toEnabledToolInfos(tools: AgentSummary["tools"]): ToolInfo[] {
  return tools.filter((binding) => binding.enabled).map((binding) => toToolInfo(binding));
}

function toMcpServer(binding: AgentEditorState["mcpBindings"][number]): McpServer {
  const server: McpServer = {
    enabled: binding.enabled,
    id: binding.serverId,
    name: binding.name,
    url: binding.url,
  };
  if (typeof binding.iconUrl === "string" && binding.iconUrl.length > 0) {
    server.iconUrl = binding.iconUrl;
  }
  return server;
}

function createEmptyAgentConfig(): Agent["config"] {
  return {
    builtInTools: createDefaultAgentBuiltInTools(),
    environmentId: null,
    mcpServers: [],
    model: "",
    prompt: "",
    providerOptions: {},
    skills: [],
  };
}

export function mapAgentSummaryToListView(profile: AgentSummary): Agent {
  return {
    config: createEmptyAgentConfig(),
    createdAt: profile.createdAt,
    description: profile.description ?? "",
    id: profile.id,
    projectId: profile.projectId,
    liveVersion: null,
    name: profile.name,
    packageResolution: null,
    provider: "",
    readiness: null,
    runtime: profile.runtimeId,
    status: toAgentStatus(profile.status),
    tools: toEnabledToolInfos(profile.tools),
    updatedAt: profile.updatedAt,
    versions: [],
  };
}

export function mapAgentDetailToView(
  profile: AgentDetail,
  editorDetail: AgentEditorState | null,
): Agent {
  const environmentConfig = editorDetail?.environment ?? DEFAULT_ENVIRONMENT_CONFIG;

  return {
    config: {
      builtInTools: editorDetail?.builtInTools ?? createDefaultAgentBuiltInTools(),
      environmentId: environmentConfig.environmentId,
      mcpServers: editorDetail?.mcpBindings.map((binding) => toMcpServer(binding)) ?? [],
      model: profile.model,
      prompt: profile.prompt,
      providerOptions: editorDetail?.providerOptions ?? {},
      skills: profile.skills.map((skill) => toSkillInfo(skill)),
    },
    createdAt: profile.createdAt,
    description: profile.description ?? "",
    id: profile.id,
    projectId: profile.projectId,
    liveVersion: profile.liveVersion,
    name: profile.name,
    packageResolution: editorDetail?.packageResolution ?? null,
    provider: profile.provider,
    readiness: editorDetail?.readiness ?? null,
    runtime: profile.runtimeId,
    status: toAgentStatus(profile.status),
    tools: toEnabledToolInfos(profile.tools),
    updatedAt: profile.updatedAt,
    versions: profile.versions,
  };
}
