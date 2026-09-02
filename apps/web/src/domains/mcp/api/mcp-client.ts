import type { McpOAuthFlowId, McpServerId, ProjectId } from "@mosoo/contracts/id";
import type {
  ConnectMcpBearerInput,
  CreateProjectMcpServerInput,
  McpOAuthFlowState,
  McpRegistry,
  McpServerWithCredential,
  StartMcpOAuthInput,
  StartMcpOAuthPayload,
  UpdateProjectMcpServerInput,
} from "@mosoo/contracts/mcp";

import type {
  ConnectMcpBearerMutation,
  CreateProjectMcpServerMutation,
  McpOAuthFlowStatusQuery,
  McpRegistryQuery,
  RevokeMcpCredentialMutation,
  SetMcpServerEnabledMutation,
  StartMcpOAuthMutation,
  UpdateProjectMcpServerMutation,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import {
  toAccountId,
  toCredentialId,
  toMcpOAuthFlowId,
  toMcpServerId,
  toProjectId,
} from "@/routes/typed-id";

import {
  CONNECT_MCP_BEARER_MUTATION,
  CREATE_PROJECT_MCP_SERVER_MUTATION,
  DELETE_MCP_SERVER_MUTATION,
  MCP_OAUTH_FLOW_STATUS_QUERY,
  MCP_REGISTRY_QUERY,
  REVOKE_MCP_CREDENTIAL_MUTATION,
  SET_MCP_SERVER_ENABLED_MUTATION,
  START_MCP_OAUTH_MUTATION,
  UPDATE_PROJECT_MCP_SERVER_MUTATION,
} from "./mcp-graphql-documents";

type GraphQLMcpServerWithCredential = McpRegistryQuery["mcpRegistry"]["servers"][number];
type GraphQLMcpServerMutationResult =
  | CreateProjectMcpServerMutation["createProjectMcpServer"]
  | ConnectMcpBearerMutation["connectMcpBearer"]
  | RevokeMcpCredentialMutation["revokeMcpCredential"]
  | SetMcpServerEnabledMutation["setMcpServerEnabled"]
  | UpdateProjectMcpServerMutation["updateProjectMcpServer"];

function toMcpServerWithCredential(
  server: GraphQLMcpServerWithCredential | GraphQLMcpServerMutationResult,
): McpServerWithCredential {
  return {
    ...server,
    credential:
      server.credential === null
        ? null
        : {
            ...server.credential,
            id: toCredentialId(server.credential.id),
          },
    id: toMcpServerId(server.id),
    ownerId: toAccountId(server.ownerId),
    projectId: toProjectId(server.projectId),
  };
}

function toMcpRegistry(registry: McpRegistryQuery["mcpRegistry"]): McpRegistry {
  return {
    ...registry,
    currentUserId: toAccountId(registry.currentUserId),
    projectId: toProjectId(registry.projectId),
    servers: registry.servers.map(toMcpServerWithCredential),
  };
}

function toStartMcpOAuthPayload(
  payload: StartMcpOAuthMutation["startMcpOAuth"],
): StartMcpOAuthPayload {
  return {
    ...payload,
    flowId: toMcpOAuthFlowId(payload.flowId),
  };
}

function toMcpOAuthFlowState(
  state: McpOAuthFlowStatusQuery["mcpOAuthFlowStatus"],
): McpOAuthFlowState {
  return {
    ...state,
    flowId: toMcpOAuthFlowId(state.flowId),
    serverId: toMcpServerId(state.serverId),
  };
}

export async function getMcpRegistry(projectId: ProjectId): Promise<McpRegistry> {
  const payload = await requestGraphQL(MCP_REGISTRY_QUERY, { projectId });

  return toMcpRegistry(payload.mcpRegistry);
}

export async function createProjectMcpServer(
  input: CreateProjectMcpServerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(CREATE_PROJECT_MCP_SERVER_MUTATION, { input });

  return toMcpServerWithCredential(payload.createProjectMcpServer);
}

export async function connectMcpBearer(
  input: ConnectMcpBearerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(CONNECT_MCP_BEARER_MUTATION, { input });

  return toMcpServerWithCredential(payload.connectMcpBearer);
}

export async function revokeMcpCredential(
  projectId: ProjectId,
  serverId: McpServerId,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(REVOKE_MCP_CREDENTIAL_MUTATION, { projectId, serverId });

  return toMcpServerWithCredential(payload.revokeMcpCredential);
}

export async function setMcpServerEnabled(
  projectId: ProjectId,
  serverId: McpServerId,
  enabled: boolean,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(SET_MCP_SERVER_ENABLED_MUTATION, {
    enabled,
    projectId,
    serverId,
  });

  return toMcpServerWithCredential(payload.setMcpServerEnabled);
}

export async function updateProjectMcpServer(
  input: UpdateProjectMcpServerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(UPDATE_PROJECT_MCP_SERVER_MUTATION, { input });

  return toMcpServerWithCredential(payload.updateProjectMcpServer);
}

export async function deleteMcpServer(projectId: ProjectId, serverId: McpServerId): Promise<void> {
  await requestGraphQL(DELETE_MCP_SERVER_MUTATION, { projectId, serverId });
}

export async function startMcpOAuth(input: StartMcpOAuthInput): Promise<StartMcpOAuthPayload> {
  const payload = await requestGraphQL(START_MCP_OAUTH_MUTATION, { input });

  return toStartMcpOAuthPayload(payload.startMcpOAuth);
}

export async function getMcpOAuthFlowState(flowId: McpOAuthFlowId): Promise<McpOAuthFlowState> {
  const payload = await requestGraphQL(MCP_OAUTH_FLOW_STATUS_QUERY, { flowId });

  return toMcpOAuthFlowState(payload.mcpOAuthFlowStatus);
}
