import type { McpOAuthFlowId, McpServerId, OrganizationId } from "@mosoo/contracts/id";
import type {
  ConnectMcpBearerInput,
  CreateOrganizationMcpServerInput,
  CreatePersonalMcpServerInput,
  McpOAuthFlowState,
  McpRegistry,
  McpServerWithCredential,
  SetOrganizationSharedMcpBearerInput,
  StartMcpOAuthInput,
  StartMcpOAuthPayload,
} from "@mosoo/contracts/mcp";

import type {
  ClearOrganizationSharedCredentialMutation,
  ConnectMcpBearerMutation,
  CreateOrganizationMcpServerMutation,
  CreatePersonalMcpServerMutation,
  McpOAuthFlowStatusQuery,
  McpRegistryQuery,
  RevokeMcpUserCredentialMutation,
  SetMcpServerEnabledMutation,
  SetOrganizationSharedBearerMutation,
  StartMcpOAuthMutation,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import {
  toAccountId,
  toCredentialId,
  toMcpOAuthFlowId,
  toMcpServerId,
  toOrganizationId,
} from "@/routes/typed-id";

import {
  CLEAR_ORGANIZATION_SHARED_CREDENTIAL_MUTATION,
  CONNECT_MCP_BEARER_MUTATION,
  CREATE_ORGANIZATION_MCP_SERVER_MUTATION,
  CREATE_PERSONAL_MCP_SERVER_MUTATION,
  DELETE_MCP_SERVER_MUTATION,
  MCP_OAUTH_FLOW_STATUS_QUERY,
  MCP_REGISTRY_QUERY,
  REVOKE_MCP_USER_CREDENTIAL_MUTATION,
  SET_MCP_SERVER_ENABLED_MUTATION,
  SET_ORGANIZATION_SHARED_BEARER_MUTATION,
  START_MCP_OAUTH_MUTATION,
} from "./mcp-graphql-documents";

type GraphQLMcpServerWithCredential = McpRegistryQuery["mcpRegistry"]["personal"][number];
type GraphQLMcpServerMutationResult =
  | CreatePersonalMcpServerMutation["createPersonalMcpServer"]
  | CreateOrganizationMcpServerMutation["createOrganizationMcpServer"]
  | ConnectMcpBearerMutation["connectMcpBearer"]
  | SetOrganizationSharedBearerMutation["setOrganizationSharedBearer"]
  | ClearOrganizationSharedCredentialMutation["clearOrganizationSharedCredential"]
  | RevokeMcpUserCredentialMutation["revokeMcpUserCredential"]
  | SetMcpServerEnabledMutation["setMcpServerEnabled"];

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
    organizationId: toOrganizationId(server.organizationId),
    ownerId: toAccountId(server.ownerId),
  };
}

function toMcpRegistry(registry: McpRegistryQuery["mcpRegistry"]): McpRegistry {
  return {
    ...registry,
    currentUserId: toAccountId(registry.currentUserId),
    organizationId: toOrganizationId(registry.organizationId),
    organizationShared: registry.organizationShared.map(toMcpServerWithCredential),
    personal: registry.personal.map(toMcpServerWithCredential),
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

export async function getMcpRegistry(organizationId: OrganizationId): Promise<McpRegistry> {
  const payload = await requestGraphQL(MCP_REGISTRY_QUERY, { organizationId });

  return toMcpRegistry(payload.mcpRegistry);
}

export async function createPersonalMcpServer(
  input: CreatePersonalMcpServerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(CREATE_PERSONAL_MCP_SERVER_MUTATION, { input });

  return toMcpServerWithCredential(payload.createPersonalMcpServer);
}

export async function createOrganizationMcpServer(
  input: CreateOrganizationMcpServerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(CREATE_ORGANIZATION_MCP_SERVER_MUTATION, { input });

  return toMcpServerWithCredential(payload.createOrganizationMcpServer);
}

export async function connectMcpBearer(
  input: ConnectMcpBearerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(CONNECT_MCP_BEARER_MUTATION, { input });

  return toMcpServerWithCredential(payload.connectMcpBearer);
}

export async function setOrganizationSharedBearer(
  input: SetOrganizationSharedMcpBearerInput,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(SET_ORGANIZATION_SHARED_BEARER_MUTATION, { input });

  return toMcpServerWithCredential(payload.setOrganizationSharedBearer);
}

export async function clearOrganizationSharedCredential(
  serverId: McpServerId,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(CLEAR_ORGANIZATION_SHARED_CREDENTIAL_MUTATION, { serverId });

  return toMcpServerWithCredential(payload.clearOrganizationSharedCredential);
}

export async function revokeMcpUserCredential(
  serverId: McpServerId,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(REVOKE_MCP_USER_CREDENTIAL_MUTATION, { serverId });

  return toMcpServerWithCredential(payload.revokeMcpUserCredential);
}

export async function setMcpServerEnabled(
  serverId: McpServerId,
  enabled: boolean,
): Promise<McpServerWithCredential> {
  const payload = await requestGraphQL(SET_MCP_SERVER_ENABLED_MUTATION, { enabled, serverId });

  return toMcpServerWithCredential(payload.setMcpServerEnabled);
}

export async function deleteMcpServer(serverId: McpServerId): Promise<void> {
  await requestGraphQL(DELETE_MCP_SERVER_MUTATION, { serverId });
}

export async function startMcpOAuth(input: StartMcpOAuthInput): Promise<StartMcpOAuthPayload> {
  const payload = await requestGraphQL(START_MCP_OAUTH_MUTATION, { input });

  return toStartMcpOAuthPayload(payload.startMcpOAuth);
}

export async function getMcpOAuthFlowState(flowId: McpOAuthFlowId): Promise<McpOAuthFlowState> {
  const payload = await requestGraphQL(MCP_OAUTH_FLOW_STATUS_QUERY, { flowId });

  return toMcpOAuthFlowState(payload.mcpOAuthFlowStatus);
}
