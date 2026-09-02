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
  RuntimeStateOperationInput,
  RuntimeStateOperationResult,
  UpdateAgentConfigInput,
} from "@mosoo/contracts/agent";
import type {
  AgentManifestExport,
  AgentPackageExport,
  AgentPackageImportResult,
  CreateAgentForkInput,
  ImportAgentPackageInput,
} from "@mosoo/contracts/agent-manifest";
import type { AgentId, ProjectId } from "@mosoo/contracts/id";

import type {
  AgentEditorStateQuery,
  AgentFieldsFragment,
  AgentManifestQuery,
  AgentQuery,
  AccessibleAgentsQuery,
  CreateAgentForkMutation,
  ExportAgentPackageQuery,
  ImportAgentPackageMutation,
  RecreateSandboxMutation,
  ResetAgentStateMutation,
  RestartDriverMutation,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import {
  toAccountId,
  toAgentDeploymentVersionId,
  toAgentId,
  toAgentMcpBindingId,
  toEnvironmentId,
  toFileId,
  toMcpServerId,
  toProjectId,
  toSkillId,
} from "@/routes/typed-id";

import {
  CREATE_AGENT_MUTATION,
  DELETE_AGENT_MUTATION,
  GET_AGENT_EDITOR_STATE_QUERY,
  GET_AGENT_QUERY,
  LIST_VISIBLE_AGENTS_QUERY,
  PUBLISH_AGENT_MUTATION,
  RECREATE_SANDBOX_MUTATION,
  RESET_AGENT_STATE_MUTATION,
  RESTART_DRIVER_MUTATION,
  UNPUBLISH_AGENT_MUTATION,
  UPDATE_AGENT_CONFIG_MUTATION,
} from "./agent-documents";
import {
  CREATE_AGENT_FORK_MUTATION,
  EXPORT_AGENT_PACKAGE_QUERY,
  GET_AGENT_MANIFEST_QUERY,
  IMPORT_AGENT_PACKAGE_MUTATION,
} from "./agent-package-documents";

type GraphQLAgentSummary = AccessibleAgentsQuery["accessibleAgentList"][number];
type GraphQLAgentDetail = AgentQuery["agent"];
type GraphQLAgentEditorState = AgentEditorStateQuery["agentEditorState"];
type GraphQLRuntimeStateOperationResult =
  | RestartDriverMutation["restartDriver"]
  | RecreateSandboxMutation["recreateSandbox"]
  | ResetAgentStateMutation["resetAgentState"];

function toAgentSkillReference(skill: AgentFieldsFragment["skills"][number]): AgentSkillReference {
  return {
    ...skill,
    skillId: toSkillId(skill.skillId),
  };
}

function toAgentDeploymentVersion(
  version: NonNullable<AgentFieldsFragment["liveVersion"]>,
): AgentDeploymentVersion {
  return {
    ...version,
    agentId: toAgentId(version.agentId),
    createdByAccountId: toAccountId(version.createdByAccountId),
    environmentId: version.environmentId === null ? null : toEnvironmentId(version.environmentId),
    id: toAgentDeploymentVersionId(version.id),
  };
}

function toAgentOwnerSummary(owner: GraphQLAgentSummary["owner"]): AgentOwnerSummary {
  return {
    ...owner,
    id: toAccountId(owner.id),
  };
}

function toAgentToolSummary(tool: GraphQLAgentSummary["tools"][number]): AgentToolSummary {
  return {
    ...tool,
    serverId: toMcpServerId(tool.serverId),
  };
}

function toAgent(agent: AgentFieldsFragment): Agent {
  return {
    ...agent,
    id: toAgentId(agent.id),
    liveVersion: agent.liveVersion === null ? null : toAgentDeploymentVersion(agent.liveVersion),
    projectId: toProjectId(agent.projectId),
    skills: agent.skills.map(toAgentSkillReference),
  };
}

function toAgentSummary(agent: GraphQLAgentSummary): AgentSummary {
  return {
    ...agent,
    id: toAgentId(agent.id),
    projectId: toProjectId(agent.projectId),
    owner: toAgentOwnerSummary(agent.owner),
    tools: agent.tools.map(toAgentToolSummary),
  };
}

function toAgentDetail(agent: GraphQLAgentDetail): AgentDetail {
  return {
    ...agent,
    id: toAgentId(agent.id),
    liveVersion: agent.liveVersion === null ? null : toAgentDeploymentVersion(agent.liveVersion),
    projectId: toProjectId(agent.projectId),
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
    environmentId:
      environment.environmentId === null ? null : toEnvironmentId(environment.environmentId),
  };
}

function toAgentEditorState(state: GraphQLAgentEditorState): AgentEditorState {
  return {
    ...state,
    environment: toAgentEnvironmentConfig(state.environment),
    id: toAgentId(state.id),
    mcpBindings: state.mcpBindings.map((binding) => ({
      ...binding,
      id: toAgentMcpBindingId(binding.id),
      serverId: toMcpServerId(binding.serverId),
    })),
  };
}

function toRuntimeStateOperationResult(
  result: GraphQLRuntimeStateOperationResult,
): RuntimeStateOperationResult {
  return {
    ...result,
    agentId: toAgentId(result.agentId),
  };
}

function toAgentManifest(manifest: AgentManifestQuery["agentManifest"]): AgentManifestExport {
  return {
    ...manifest,
    agentId: toAgentId(manifest.agentId),
  };
}

function toAgentPackageExport(
  exportedPackage: ExportAgentPackageQuery["exportAgentPackage"],
): AgentPackageExport {
  return {
    ...exportedPackage,
    agentId: toAgentId(exportedPackage.agentId),
    contentType: "application/zip",
    fileId: toFileId(exportedPackage.fileId),
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

export async function restartDriver(
  input: RuntimeStateOperationInput,
): Promise<RuntimeStateOperationResult> {
  const payload = await requestGraphQL(RESTART_DRIVER_MUTATION, { input });

  return toRuntimeStateOperationResult(payload.restartDriver);
}

export async function recreateSandbox(
  input: RuntimeStateOperationInput,
): Promise<RuntimeStateOperationResult> {
  const payload = await requestGraphQL(RECREATE_SANDBOX_MUTATION, { input });

  return toRuntimeStateOperationResult(payload.recreateSandbox);
}

export async function resetAgentState(
  input: RuntimeStateOperationInput,
): Promise<RuntimeStateOperationResult> {
  const payload = await requestGraphQL(RESET_AGENT_STATE_MUTATION, { input });

  return toRuntimeStateOperationResult(payload.resetAgentState);
}
