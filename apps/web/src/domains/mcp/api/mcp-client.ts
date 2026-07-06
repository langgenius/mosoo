import type { McpOAuthFlowId, McpServerId, AppId } from "@mosoo/contracts/id";
import type {
  ConnectMcpBearerInput,
  CreateAppMcpServerInput,
  McpOAuthFlowState,
  McpRegistry,
  McpServerWithCredential,
  StartMcpOAuthInput,
  StartMcpOAuthPayload,
  UpdateAppMcpServerInput,
} from "@mosoo/contracts/mcp";

import type {
  ConnectMcpBearerMutation,
  CreateAppMcpServerMutation,
  McpOAuthFlowStatusQuery,
  McpRegistryQuery,
  RevokeMcpCredentialMutation,
  SetMcpServerEnabledMutation,
  StartMcpOAuthMutation,
  UpdateAppMcpServerMutation,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import {
  toAccountId,
  toCredentialId,
  toMcpOAuthFlowId,
  toMcpServerId,
  toAppId,
} from "@/routes/typed-id";

import {
  CONNECT_MCP_BEARER_MUTATION,
  CREATE_APP_MCP_SERVER_MUTATION,
  DELETE_MCP_SERVER_MUTATION,
  MCP_OAUTH_FLOW_STATUS_QUERY,
  MCP_REGISTRY_QUERY,
  REVOKE_MCP_CREDENTIAL_MUTATION,
  SET_MCP_SERVER_ENABLED_MUTATION,
  START_MCP_OAUTH_MUTATION,
  UPDATE_APP_MCP_SERVER_MUTATION,
} from "./mcp-graphql-documents";

type GraphQLMcpServerWithCredential = McpRegistryQuery["mcpRegistry"]["servers"][number];
type GraphQLMcpServerMutationResult =
  | CreateAppMcpServerMutation["createAppMcpServer"]
  | ConnectMcpBearerMutation["connectMcpBearer"]
  | RevokeMcpCredentialMutation["revokeMcpCredential"]
  | SetMcpServerEnabledMutation["setMcpServerEnabled"]
  | UpdateAppMcpServerMutation["updateAppMcpServer"];

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
    appId: toAppId(server.appId),
  };
}

function toMcpRegistry(registry: McpRegistryQuery["mcpRegistry"]): McpRegistry {
  return {
    ...registry,
    currentUserId: toAccountId(registry.currentUserId),
    appId: toAppId(registry.appId),
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

export async function getMcpRegistry(appId: AppId): Promise<McpRegistry> {
  const payload = await requestGraphQL(MCP_REGISTRY_QUERY, { appId });

  return toMcpRegistry(payload.mcpRegistry);
}

export async function createAppMcpServer(
  input: CreateAppMcpServerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(CREATE_APP_MCP_SERVER_MUTATION, { input });

  return toMcpServerWithCredential(payload.createAppMcpServer);
}

export async function connectMcpBearer(
  input: ConnectMcpBearerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(CONNECT_MCP_BEARER_MUTATION, { input });

  return toMcpServerWithCredential(payload.connectMcpBearer);
}

export async function revokeMcpCredential(
  appId: AppId,
  serverId: McpServerId,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(REVOKE_MCP_CREDENTIAL_MUTATION, { appId, serverId });

  return toMcpServerWithCredential(payload.revokeMcpCredential);
}

export async function setMcpServerEnabled(
  appId: AppId,
  serverId: McpServerId,
  enabled: boolean,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(SET_MCP_SERVER_ENABLED_MUTATION, {
    enabled,
    appId,
    serverId,
  });

  return toMcpServerWithCredential(payload.setMcpServerEnabled);
}

export async function updateAppMcpServer(
  input: UpdateAppMcpServerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(UPDATE_APP_MCP_SERVER_MUTATION, { input });

  return toMcpServerWithCredential(payload.updateAppMcpServer);
}

export async function deleteMcpServer(appId: AppId, serverId: McpServerId): Promise<void> {
  await requestGraphQL(DELETE_MCP_SERVER_MUTATION, { appId, serverId });
}

export async function startMcpOAuth(input: StartMcpOAuthInput): Promise<StartMcpOAuthPayload> {
  const payload = await requestGraphQL(START_MCP_OAUTH_MUTATION, { input });

  return toStartMcpOAuthPayload(payload.startMcpOAuth);
}

export async function getMcpOAuthFlowState(flowId: McpOAuthFlowId): Promise<McpOAuthFlowState> {
  const payload = await requestGraphQL(MCP_OAUTH_FLOW_STATUS_QUERY, { flowId });

  return toMcpOAuthFlowState(payload.mcpOAuthFlowStatus);
}
