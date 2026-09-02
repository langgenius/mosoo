import type {
  ConnectMcpBearerInput,
  CreateProjectMcpServerInput,
  McpRegistry,
  McpServerWithCredential,
  StartMcpOAuthPayload,
  UpdateProjectMcpServerInput,
} from "@mosoo/contracts/mcp";
import { useQueryClient } from "@tanstack/react-query";

import { useAppSession } from "@/app/session-provider";
import {
  connectMcpBearer,
  createProjectMcpServer,
  deleteMcpServer,
  getMcpOAuthFlowState,
  getMcpRegistry,
  revokeMcpCredential,
  setMcpServerEnabled,
  startMcpOAuth,
  updateProjectMcpServer,
} from "@/domains/mcp/api/mcp-client";
import { mcpKeys, useMcpRegistryQuery } from "@/domains/mcp/query/mcp-queries";
import { toMcpOAuthFlowId, toMcpServerId, toProjectId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";

import { isTruthy } from "../../../shared/lib/truthiness";

async function getOAuthFlowState(flowId: string) {
  return getMcpOAuthFlowState(toMcpOAuthFlowId(flowId));
}

export function useMcpRegistry() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { activeProjectId, projectsLoading } = useAppSession();
  const projectId = activeProjectId;
  const registryQuery = useMcpRegistryQuery(projectId);
  const registry = registryQuery.data;

  async function refresh(): Promise<McpRegistry> {
    if (!isTruthy(projectId)) {
      throw new Error(t("mcp.projectNotReady"));
    }

    await queryClient.invalidateQueries({
      queryKey: mcpKeys.registry(projectId),
    });
    return queryClient.fetchQuery({
      queryFn: async () => getMcpRegistry(toProjectId(projectId)),
      queryKey: mcpKeys.registry(projectId),
    });
  }

  async function addServer(
    input: Omit<CreateProjectMcpServerInput, "projectId">,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(projectId)) {
      throw new Error(t("mcp.registryNotReady"));
    }

    const created = await createProjectMcpServer({
      ...input,
      projectId: toProjectId(projectId),
    });
    await refresh();
    return created;
  }

  async function updateServer(
    input: Omit<UpdateProjectMcpServerInput, "projectId">,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(projectId)) {
      throw new Error(t("mcp.registryNotReady"));
    }

    const updated = await updateProjectMcpServer({
      ...input,
      projectId: toProjectId(projectId),
    });
    await refresh();
    return updated;
  }

  async function connectBearerCredential(
    input: Omit<ConnectMcpBearerInput, "projectId">,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(projectId)) {
      throw new Error(t("mcp.registryNotReady"));
    }

    const nextServer = await connectMcpBearer({
      ...input,
      projectId: toProjectId(projectId),
    });
    await refresh();
    return nextServer;
  }

  async function revokeCredential(serverId: string): Promise<McpServerWithCredential> {
    if (!isTruthy(projectId)) {
      throw new Error(t("mcp.registryNotReady"));
    }

    const nextServer = await revokeMcpCredential(toProjectId(projectId), toMcpServerId(serverId));
    await refresh();
    return nextServer;
  }

  async function removeServerById(serverId: string): Promise<void> {
    if (!isTruthy(projectId)) {
      throw new Error(t("mcp.registryNotReady"));
    }

    await deleteMcpServer(toProjectId(projectId), toMcpServerId(serverId));
    await refresh();
  }

  async function toggleServerEnabled(
    serverId: string,
    enabled: boolean,
  ): Promise<McpServerWithCredential> {
    if (!isTruthy(projectId)) {
      throw new Error(t("mcp.registryNotReady"));
    }

    const nextServer = await setMcpServerEnabled(
      toProjectId(projectId),
      toMcpServerId(serverId),
      enabled,
    );
    await refresh();
    return nextServer;
  }

  async function startOAuthFlow(serverId: string): Promise<StartMcpOAuthPayload> {
    if (!isTruthy(projectId)) {
      throw new Error(t("mcp.registryNotReady"));
    }

    return startMcpOAuth({
      projectId: toProjectId(projectId),
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
          ? t("mcp.failedToLoad")
          : null,
    getOAuthFlowState,
    loading: isTruthy(projectId) ? registryQuery.isLoading : projectsLoading,
    projectId: registry?.projectId ?? "",
    refresh,
    revokeCredential,
    servers: registry?.servers ?? [],
    setServerEnabled: toggleServerEnabled,
    startOAuth: startOAuthFlow,
    updateServer,
  };
}
