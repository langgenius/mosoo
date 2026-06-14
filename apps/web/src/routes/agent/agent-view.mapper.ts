import type {
  AgentDetail,
  AgentEditorState,
  AgentEnvironmentConfig,
  AgentSkillReference,
  AgentSummary,
  AgentViewerRole,
} from "@mosoo/contracts/agent";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

import type { AuthUser } from "@/domains/auth/use-auth";

import type {
  Agent,
  AgentRole,
  AgentStatus,
  McpServer,
  RuntimeId,
  SkillInfo,
  SpaceBinding,
  ToolInfo,
  UserInfo,
} from "./agent.types";
const DEFAULT_ENVIRONMENT_CONFIG: AgentEnvironmentConfig = {
  boundSpaceIds: [],
  environmentId: null,
};

function parseKnownRuntimeId(runtimeId: string): RuntimeId {
  if (runtimeId.length === 0) {
    return "__private_runtime__";
  }

  return getRuntimeCatalogEntry(runtimeId) === null ? "__private_runtime__" : runtimeId;
}

function toAgentStatus(status: string | null | undefined): AgentStatus {
  if (status === "published") {
    return "published";
  }
  return "draft";
}

function toAgentRole(viewerRole: AgentViewerRole): AgentRole {
  if (viewerRole === "owner" || viewerRole === "admin") {
    return viewerRole;
  }
  return "user";
}

function toSkillInfo(skill: AgentSkillReference): SkillInfo {
  const skillInfo: SkillInfo = {
    filename: `${skill.skillId}.md`,
    id: skill.skillId,
    name: skill.skillName,
    state: skill.state,
  };
  return skillInfo;
}

function toToolInfo(binding: AgentSummary["tools"][number], index: number): ToolInfo {
  return {
    icon: binding.name.charAt(0).toUpperCase(),
    id: binding.serverId || `${binding.name}-${index}`,
    name: binding.name,
  };
}

function toEnabledToolInfos(tools: AgentSummary["tools"]): ToolInfo[] {
  const toolInfos: ToolInfo[] = [];

  for (const [index, binding] of tools.entries()) {
    if (!binding.enabled) {
      continue;
    }

    toolInfos.push(toToolInfo(binding, index));
  }

  return toolInfos;
}

function toMcpServer(binding: AgentEditorState["mcpBindings"][number]): McpServer {
  const server: McpServer = {
    authorizationState: binding.authorizationState,
    bindingId: binding.id,
    credentialMode: binding.credentialMode,
    credentialStatus: binding.credentialStatus,
    enabled: binding.enabled,
    id: binding.serverId.length > 0 ? binding.serverId : binding.name,
    name: binding.name,
    source: binding.source,
    type: "web",
    url: binding.url,
  };
  if (typeof binding.credentialSubject === "string" && binding.credentialSubject.length > 0) {
    server.credentialSubject = binding.credentialSubject;
  }
  if (typeof binding.iconUrl === "string" && binding.iconUrl.length > 0) {
    server.iconUrl = binding.iconUrl;
  }
  return server;
}

function toSpaceBinding(spaceId: string): SpaceBinding {
  return { id: spaceId, name: spaceId };
}

function toOwner(
  profile:
    | Pick<AgentSummary, "id" | "owner" | "viewerRole">
    | Pick<AgentDetail, "id" | "owner" | "viewerRole">,
  currentUser: AuthUser | null,
): UserInfo {
  if (profile.viewerRole === "owner" && currentUser !== null) {
    const owner: UserInfo = {
      email: currentUser.email,
      id: currentUser.id,
      name: currentUser.name,
    };
    if (typeof currentUser.image === "string" && currentUser.image.length > 0) {
      owner.avatar = currentUser.image;
    }
    return owner;
  }

  return {
    email: "",
    id: profile.owner.id,
    name: profile.owner.name ?? "Organization member",
    ...(typeof profile.owner.imageUrl === "string" && profile.owner.imageUrl.length > 0
      ? { avatar: profile.owner.imageUrl }
      : {}),
  };
}

function createEmptyAgentConfig(): Agent["config"] {
  return {
    builder: { componentDecisions: {} },
    environmentId: null,
    mcpServers: [],
    model: "",
    prompt: "",
    providerOptions: {},
    skills: [],
    spaces: [],
  };
}

export function mapAgentSummaryToListView(
  profile: AgentSummary,
  currentUser: AuthUser | null,
): Agent {
  return {
    config: createEmptyAgentConfig(),
    createdAt: profile.createdAt,
    description: profile.description ?? "",
    id: profile.id,
    appId: profile.appId,
    kind: profile.kind,
    liveVersion: null,
    name: profile.name,
    owner: toOwner(profile, currentUser),
    packageResolution: null,
    packageSharingEnabled: false,
    provider: "",
    readiness: null,
    role: toAgentRole(profile.viewerRole),
    runtime: parseKnownRuntimeId(profile.runtimeId),
    status: toAgentStatus(profile.status),
    tools: toEnabledToolInfos(profile.tools),
    updatedAt: profile.updatedAt,
    versions: [],
    visibility: profile.visibility,
  };
}

export function mapAgentDetailToView(
  profile: AgentDetail,
  editorDetail: AgentEditorState | null,
  currentUser: AuthUser | null,
): Agent {
  const environmentConfig = editorDetail?.environment ?? DEFAULT_ENVIRONMENT_CONFIG;

  return {
    config: {
      builder: editorDetail?.builder ?? { componentDecisions: {} },
      environmentId: environmentConfig.environmentId,
      mcpServers: editorDetail?.mcpBindings.map((binding) => toMcpServer(binding)) ?? [],
      model: profile.model,
      prompt: profile.prompt,
      providerOptions: editorDetail?.providerOptions ?? {},
      skills: profile.skills.map((skill) => toSkillInfo(skill)),
      spaces: environmentConfig.boundSpaceIds.map((spaceId) => toSpaceBinding(spaceId)),
    },
    createdAt: profile.createdAt,
    description: profile.description ?? "",
    id: profile.id,
    appId: profile.appId,
    kind: profile.kind,
    liveVersion: profile.liveVersion,
    name: profile.name,
    owner: toOwner(profile, currentUser),
    packageResolution: editorDetail?.packageResolution ?? null,
    packageSharingEnabled: profile.packageSharingEnabled,
    provider: profile.provider,
    readiness: editorDetail?.readiness ?? null,
    role: toAgentRole(profile.viewerRole),
    runtime: parseKnownRuntimeId(profile.runtimeId),
    status: toAgentStatus(profile.status),
    tools: toEnabledToolInfos(profile.tools),
    updatedAt: profile.updatedAt,
    versions: profile.versions,
    visibility: profile.visibility,
  };
}
