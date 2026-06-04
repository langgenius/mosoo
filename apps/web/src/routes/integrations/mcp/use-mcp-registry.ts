import type {
  ConnectMcpBearerInput,
  CreateOrganizationMcpServerInput,
  CreatePersonalMcpServerInput,
  McpRegistry,
  McpServerWithCredential,
  SetOrganizationSharedMcpBearerInput,
  StartMcpOAuthPayload,
} from "@mosoo/contracts/mcp";
import { useQueryClient } from "@tanstack/react-query";

import { useAppSession } from "@/app/session-provider";
import {
  clearOrganizationSharedCredential,
  connectMcpBearer,
  createOrganizationMcpServer,
  createPersonalMcpServer,
  deleteMcpServer,
  getMcpOAuthFlowState,
  getMcpRegistry,
  revokeMcpUserCredential,
  setMcpServerEnabled,
  setOrganizationSharedBearer,
  startMcpOAuth,
} from "@/domains/mcp/api/mcp-client";
import { mcpKeys, useMcpRegistryQuery } from "@/domains/mcp/query/mcp-queries";
import { toMcpOAuthFlowId, toMcpServerId, toOrganizationId } from "@/routes/typed-id";

import { isTruthy } from "../../../shared/lib/truthiness";

async function startOAuthFlow(serverId: string): Promise<StartMcpOAuthPayload> {
  return startMcpOAuth({ serverId: toMcpServerId(serverId) });
}

async function getOAuthFlowState(flowId: string) {
  return getMcpOAuthFlowState(toMcpOAuthFlowId(flowId));
}

export function useMcpRegistry() {
  const queryClient = useQueryClient();
  const { activeOrganization, organizationsLoading } = useAppSession();
  const organizationId = activeOrganization?.id ?? null;
  const registryQuery = useMcpRegistryQuery(organizationId);
  const registry = registryQuery.data;

  async function refresh(): Promise<McpRegistry> {
    if (!isTruthy(organizationId)) {
      throw new Error("Organization is not ready.");
    }

    await queryClient.invalidateQueries({
      queryKey: mcpKeys.registry(toOrganizationId(organizationId)),
    });
    const nextRegistry = await queryClient.fetchQuery({
      queryFn: async () => getMcpRegistry(toOrganizationId(organizationId)),
      queryKey: mcpKeys.registry(toOrganizationId(organizationId)),
    });
    return nextRegistry;
  }

  async function addPersonalServer(
    input: Omit<CreatePersonalMcpServerInput, "organizationId">,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(organizationId)) {
      throw new Error("MCP registry is not ready.");
    }

    const created = await createPersonalMcpServer({
      ...input,
      organizationId: toOrganizationId(organizationId),
    });
    await refresh();
    return created;
  }

  async function addOrganizationServer(
    input: Omit<CreateOrganizationMcpServerInput, "organizationId">,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(organizationId)) {
      throw new Error("MCP registry is not ready.");
    }

    const created = await createOrganizationMcpServer({
      ...input,
      organizationId: toOrganizationId(organizationId),
    });
    await refresh();
    return created;
  }

  async function connectBearerCredential(
    input: ConnectMcpBearerInput,
  ): Promise<McpServerWithCredential> {
    const nextServer = await connectMcpBearer(input);
    await refresh();
    return nextServer;
  }

  async function revokeCredential(serverId: string): Promise<McpServerWithCredential> {
    const nextServer = await revokeMcpUserCredential(toMcpServerId(serverId));
    await refresh();
    return nextServer;
  }

  async function configureOrganizationSharedCredential(
    input: SetOrganizationSharedMcpBearerInput,
  ): Promise<McpServerWithCredential> {
    const nextServer = await setOrganizationSharedBearer(input);
    await refresh();
    return nextServer;
  }

  async function clearSharedCredential(serverId: string): Promise<McpServerWithCredential> {
    const nextServer = await clearOrganizationSharedCredential(toMcpServerId(serverId));
    await refresh();
    return nextServer;
  }

  async function removeServerById(serverId: string): Promise<void> {
    await deleteMcpServer(toMcpServerId(serverId));
    await refresh();
  }

  async function toggleServerEnabled(
    serverId: string,
    enabled: boolean,
  ): Promise<McpServerWithCredential> {
    const nextServer = await setMcpServerEnabled(toMcpServerId(serverId), enabled);
    await refresh();
    return nextServer;
  }

  return {
    addOrganizationServer,
    addPersonalServer,
    clearOrganizationSharedCredential: clearSharedCredential,
    connectBearer: connectBearerCredential,
    currentUserId: registry?.currentUserId ?? "",
    currentUserName: registry?.currentUserName ?? "",
    deleteServer: removeServerById,
    error:
      registryQuery.error instanceof Error
        ? registryQuery.error.message
        : registryQuery.error
          ? "Failed to load MCP registry."
          : null,
    getOAuthFlowState,
    isAdmin: registry?.isAdmin ?? false,
    loading: isTruthy(organizationId) ? registryQuery.isLoading : organizationsLoading,
    organizationId: registry?.organizationId ?? "",
    organizationShared: registry?.organizationShared ?? [],
    personal: registry?.personal ?? [],
    refresh,
    revokeCredential,
    setOrganizationSharedCredential: configureOrganizationSharedCredential,
    setServerEnabled: toggleServerEnabled,
    startOAuth: startOAuthFlow,
  };
}
