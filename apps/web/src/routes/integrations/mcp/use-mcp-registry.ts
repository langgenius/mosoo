import type {
  ConnectMcpBearerInput,
  CreateAppMcpServerInput,
  McpRegistry,
  McpServerWithCredential,
  StartMcpOAuthPayload,
  UpdateAppMcpServerInput,
} from "@mosoo/contracts/mcp";
import { useQueryClient } from "@tanstack/react-query";

import { useAppSession } from "@/app/session-provider";
import {
  connectMcpBearer,
  createAppMcpServer,
  deleteMcpServer,
  getMcpOAuthFlowState,
  getMcpRegistry,
  revokeMcpCredential,
  setMcpServerEnabled,
  startMcpOAuth,
  updateAppMcpServer,
} from "@/domains/mcp/api/mcp-client";
import { mcpKeys, useMcpRegistryQuery } from "@/domains/mcp/query/mcp-queries";
import { toMcpOAuthFlowId, toMcpServerId, toAppId } from "@/routes/typed-id";

import { isTruthy } from "../../../shared/lib/truthiness";

async function getOAuthFlowState(flowId: string) {
  return getMcpOAuthFlowState(toMcpOAuthFlowId(flowId));
}

export function useMcpRegistry() {
  const queryClient = useQueryClient();
  const { activeAppId, appsLoading } = useAppSession();
  const appId = activeAppId;
  const registryQuery = useMcpRegistryQuery(appId);
  const registry = registryQuery.data;

  async function refresh(): Promise<McpRegistry> {
    if (!isTruthy(appId)) {
      throw new Error("App is not ready.");
    }

    await queryClient.invalidateQueries({
      queryKey: mcpKeys.registry(appId),
    });
    return queryClient.fetchQuery({
      queryFn: async () => getMcpRegistry(toAppId(appId)),
      queryKey: mcpKeys.registry(appId),
    });
  }

  async function addServer(
    input: Omit<CreateAppMcpServerInput, "appId">,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(appId)) {
      throw new Error("MCP registry is not ready.");
    }

    const created = await createAppMcpServer({
      ...input,
      appId: toAppId(appId),
    });
    await refresh();
    return created;
  }

  async function updateServer(
    input: Omit<UpdateAppMcpServerInput, "appId">,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(appId)) {
      throw new Error("MCP registry is not ready.");
    }

    const updated = await updateAppMcpServer({
      ...input,
      appId: toAppId(appId),
    });
    await refresh();
    return updated;
  }

  async function connectBearerCredential(
    input: Omit<ConnectMcpBearerInput, "appId">,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(appId)) {
      throw new Error("MCP registry is not ready.");
    }

    const nextServer = await connectMcpBearer({
      ...input,
      appId: toAppId(appId),
    });
    await refresh();
    return nextServer;
  }

  async function revokeCredential(serverId: string): Promise<McpServerWithCredential> {
    if (!isTruthy(appId)) {
      throw new Error("MCP registry is not ready.");
    }

    const nextServer = await revokeMcpCredential(toAppId(appId), toMcpServerId(serverId));
    await refresh();
    return nextServer;
  }

  async function removeServerById(serverId: string): Promise<void> {
    if (!isTruthy(appId)) {
      throw new Error("MCP registry is not ready.");
    }

    await deleteMcpServer(toAppId(appId), toMcpServerId(serverId));
    await refresh();
  }

  async function toggleServerEnabled(
    serverId: string,
    enabled: boolean,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(appId)) {
      throw new Error("MCP registry is not ready.");
    }

    const nextServer = await setMcpServerEnabled(toAppId(appId), toMcpServerId(serverId), enabled);
    await refresh();
    return nextServer;
  }

  async function startOAuthFlow(serverId: string): Promise<StartMcpOAuthPayload> {
    if (!isTruthy(appId)) {
      throw new Error("MCP registry is not ready.");
    }

    return startMcpOAuth({
      appId: toAppId(appId),
      serverId: toMcpServerId(serverId),
    });
  }

  return {
    addServer,
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
    loading: isTruthy(appId) ? registryQuery.isLoading : appsLoading,
    appId: registry?.appId ?? "",
    refresh,
    revokeCredential,
    servers: registry?.servers ?? [],
    setServerEnabled: toggleServerEnabled,
    startOAuth: startOAuthFlow,
    updateServer,
  };
}
