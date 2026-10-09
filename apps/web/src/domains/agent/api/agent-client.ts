import type {
  Agent,
  AgentDeploymentVersion,
  AgentDetail,
  AgentEditorState,
  AgentEnvironmentConfig,
  AgentOwnerSummary,
  AgentSkillReference,
  AgentSummary,
  AgentToolSummary,
  CreateAgentInput,
  DeleteAgentInput,
  PublishAgentInput,
  UpdateAgentConfigInput,
} from "@mosoo/contracts/agent";
import type {
  AgentManifestExport,
  AgentPackageExport,
  AgentPackageImportResult,
  CreateAgentForkInput,
  ImportAgentPackageInput,
} from "@mosoo/contracts/agent-manifest";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  AgentMcpBindingId,
  EnvironmentId,
  FileId,
  McpServerId,
  ProjectId,
  SkillId,
} from "@mosoo/id";

import type {
  AgentEditorStateQuery,
  AgentFieldsFragment,
  AgentManifestQuery,
  AgentQuery,
  AccessibleAgentsQuery,
  CreateAgentForkMutation,
  ExportAgentPackageQuery,
  ImportAgentPackageMutation,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import {
  CREATE_AGENT_MUTATION,
  DELETE_AGENT_MUTATION,
  GET_AGENT_QUERY,
  LIST_VISIBLE_AGENTS_QUERY,
} from "./agent-core-documents";
import {
  GET_AGENT_EDITOR_STATE_QUERY,
  UPDATE_AGENT_CONFIG_MUTATION,
} from "./agent-editor-documents";
import {
  CREATE_AGENT_FORK_MUTATION,
  EXPORT_AGENT_PACKAGE_QUERY,
  GET_AGENT_MANIFEST_QUERY,
  IMPORT_AGENT_PACKAGE_MUTATION,
} from "./agent-package-documents";
import { PUBLISH_AGENT_MUTATION, UNPUBLISH_AGENT_MUTATION } from "./agent-runtime-documents";

type GraphQLAgentSummary = AccessibleAgentsQuery["accessibleAgentList"][number];
type GraphQLAgentDetail = AgentQuery["agent"];
type GraphQLAgentEditorState = AgentEditorStateQuery["agentEditorState"];
function toAgentSkillReference(skill: AgentFieldsFragment["skills"][number]): AgentSkillReference {
  return {
    ...skill,
    skillId: skill.skillId as SkillId,
  };
}

function toAgentDeploymentVersion(
  version: NonNullable<AgentFieldsFragment["liveVersion"]>,
): AgentDeploymentVersion {
  return {
    ...version,
    agentId: version.agentId as AgentId,
    createdByAccountId: version.createdByAccountId as AccountId,
    environmentId: version.environmentId as EnvironmentId | null,
    id: version.id as AgentDeploymentVersionId,
  };
}

function toAgentOwnerSummary(owner: GraphQLAgentSummary["owner"]): AgentOwnerSummary {
  return {
    ...owner,
    id: owner.id as AccountId,
  };
}

function toAgentToolSummary(tool: GraphQLAgentSummary["tools"][number]): AgentToolSummary {
  return {
    ...tool,
    serverId: tool.serverId as McpServerId,
  };
}

function toAgent(agent: AgentFieldsFragment): Agent {
  return {
    ...agent,
    id: agent.id as AgentId,
    liveVersion: agent.liveVersion === null ? null : toAgentDeploymentVersion(agent.liveVersion),
    projectId: agent.projectId as ProjectId,
    skills: agent.skills.map(toAgentSkillReference),
  };
}

function toAgentSummary(agent: GraphQLAgentSummary): AgentSummary {
  return {
    ...agent,
    id: agent.id as AgentId,
    projectId: agent.projectId as ProjectId,
    owner: toAgentOwnerSummary(agent.owner),
    tools: agent.tools.map(toAgentToolSummary),
  };
}

function toAgentDetail(agent: GraphQLAgentDetail): AgentDetail {
  return {
    ...agent,
    id: agent.id as AgentId,
    liveVersion: agent.liveVersion === null ? null : toAgentDeploymentVersion(agent.liveVersion),
    projectId: agent.projectId as ProjectId,
    owner: toAgentOwnerSummary(agent.owner),
    skills: agent.skills.map(toAgentSkillReference),
    tools: agent.tools.map(toAgentToolSummary),
    versions: agent.versions.map(toAgentDeploymentVersion),
  };
}

function toAgentEnvironmentConfig(
  environment: GraphQLAgentEditorState["environment"],
): AgentEnvironmentConfig {
  return {
    environmentId: environment.environmentId as EnvironmentId | null,
  };
}

function toAgentEditorState(state: GraphQLAgentEditorState): AgentEditorState {
  return {
    ...state,
    environment: toAgentEnvironmentConfig(state.environment),
    id: state.id as AgentId,
    mcpBindings: state.mcpBindings.map((binding) => ({
      ...binding,
      id: binding.id as AgentMcpBindingId,
      serverId: binding.serverId as McpServerId,
    })),
  };
}

function toAgentManifest(manifest: AgentManifestQuery["agentManifest"]): AgentManifestExport {
  return {
    ...manifest,
    agentId: manifest.agentId as AgentId,
  };
}

function toAgentPackageExport(
  exportedPackage: ExportAgentPackageQuery["exportAgentPackage"],
): AgentPackageExport {
  return {
    ...exportedPackage,
    agentId: exportedPackage.agentId as AgentId,
    contentType: "application/zip",
    fileId: exportedPackage.fileId as FileId,
  };
}

function toAgentPackageImportResult(
  result:
    | ImportAgentPackageMutation["importAgentPackage"]
    | CreateAgentForkMutation["createAgentFork"],
): AgentPackageImportResult<Agent> {
  return {
    ...result,
    agent: toAgent(result.agent),
  };
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const payload = await requestGraphQL(CREATE_AGENT_MUTATION, { input });

  return toAgent(payload.createAgent);
}

export async function updateAgentConfig(input: UpdateAgentConfigInput): Promise<Agent> {
  const payload = await requestGraphQL(UPDATE_AGENT_CONFIG_MUTATION, { input });

  return toAgent(payload.updateAgentConfig);
}

export async function deleteAgent(input: DeleteAgentInput): Promise<void> {
  await requestGraphQL(DELETE_AGENT_MUTATION, { input });
}

export async function listVisibleAgents(projectId: ProjectId): Promise<AgentSummary[]> {
  const payload = await requestGraphQL(LIST_VISIBLE_AGENTS_QUERY, { projectId });

  return payload.accessibleAgentList.map(toAgentSummary);
}

export async function getAgent(projectId: ProjectId, agentId: AgentId): Promise<AgentDetail> {
  const payload = await requestGraphQL(GET_AGENT_QUERY, { agentId, projectId });

  return toAgentDetail(payload.agent);
}

export async function getAgentEditorState(
  projectId: ProjectId,
  agentId: AgentId,
): Promise<AgentEditorState> {
  const payload = await requestGraphQL(GET_AGENT_EDITOR_STATE_QUERY, { agentId, projectId });

  return toAgentEditorState(payload.agentEditorState);
}

export async function getAgentManifest(
  projectId: ProjectId,
  agentId: AgentId,
): Promise<AgentManifestExport> {
  const payload = await requestGraphQL(GET_AGENT_MANIFEST_QUERY, { agentId, projectId });

  return toAgentManifest(payload.agentManifest);
}

export async function exportAgentPackage(
  projectId: ProjectId,
  agentId: AgentId,
): Promise<AgentPackageExport> {
  const payload = await requestGraphQL(EXPORT_AGENT_PACKAGE_QUERY, { agentId, projectId });

  return toAgentPackageExport(payload.exportAgentPackage);
}

export async function publishAgent(input: PublishAgentInput): Promise<Agent> {
  const payload = await requestGraphQL(PUBLISH_AGENT_MUTATION, { input });

  return toAgent(payload.publishAgent);
}

export async function unpublishAgent(projectId: ProjectId, agentId: AgentId): Promise<Agent> {
  const payload = await requestGraphQL(UNPUBLISH_AGENT_MUTATION, { agentId, projectId });

  return toAgent(payload.unpublishAgent);
}

export async function importAgentPackage(
  input: ImportAgentPackageInput,
): Promise<AgentPackageImportResult<Agent>> {
  const payload = await requestGraphQL(IMPORT_AGENT_PACKAGE_MUTATION, { input });

  return toAgentPackageImportResult(payload.importAgentPackage);
}

export async function createAgentFork(
  input: CreateAgentForkInput,
): Promise<AgentPackageImportResult<Agent>> {
  const payload = await requestGraphQL(CREATE_AGENT_FORK_MUTATION, { input });

  return toAgentPackageImportResult(payload.createAgentFork);
}
