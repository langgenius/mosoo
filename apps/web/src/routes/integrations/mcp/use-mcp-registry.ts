import type {
  ConnectMcpBearerInput,
  CreateProjectMcpServerInput,
  McpServerWithCredential,
  StartMcpOAuthPayload,
  UpdateProjectMcpServerInput,
} from "@mosoo/contracts/mcp";
import type { McpServerId } from "@mosoo/id";
import { useQueryClient } from "@tanstack/react-query";

import { useActiveProject } from "@/app/session/session-context";
import {
  connectMcpBearer,
  createProjectMcpServer,
  deleteMcpServer,
  getMcpOAuthFlowState,
  revokeMcpCredential,
  setMcpServerEnabled,
  startMcpOAuth,
  updateProjectMcpServer,
} from "@/domains/mcp/api/mcp-client";
import { mcpKeys, useMcpRegistryQuery } from "@/domains/mcp/query/mcp-queries";
import { useTranslation } from "@/shared/i18n";

export function useMcpRegistry() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const projectId = useActiveProject().id;
  const registryQuery = useMcpRegistryQuery(projectId);

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: mcpKeys.registry(projectId) });
  }

  async function addServer(
    input: Omit<CreateProjectMcpServerInput, "projectId">,
  ): Promise<McpServerWithCredential> {
    const created = await createProjectMcpServer({ ...input, projectId });
    await refresh();
    return created;
  }

  async function updateServer(input: Omit<UpdateProjectMcpServerInput, "projectId">) {
    await updateProjectMcpServer({ ...input, projectId });
    await refresh();
  }

  async function connectBearer(input: Omit<ConnectMcpBearerInput, "projectId">) {
    await connectMcpBearer({ ...input, projectId });
    await refresh();
  }

  async function revokeCredential(serverId: McpServerId) {
    await revokeMcpCredential(projectId, serverId);
    await refresh();
  }

  async function deleteServer(serverId: McpServerId) {
    await deleteMcpServer(projectId, serverId);
    await refresh();
  }

  async function setServerEnabled(serverId: McpServerId, enabled: boolean) {
    await setMcpServerEnabled(projectId, serverId, enabled);
    await refresh();
  }

  async function startOAuth(serverId: McpServerId): Promise<StartMcpOAuthPayload> {
    return startMcpOAuth({ projectId, serverId });
  }

  return {
    addServer,
    connectBearer,
    deleteServer,
    error:
      registryQuery.error instanceof Error
        ? registryQuery.error.message
        : registryQuery.error
          ? t("mcp.failedToLoad")
          : null,
    getOAuthFlowState: getMcpOAuthFlowState,
    loading: registryQuery.isLoading,
    refresh,
    revokeCredential,
    servers: registryQuery.data?.servers ?? [],
    setServerEnabled,
    startOAuth,
    updateServer,
  };
}
