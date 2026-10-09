import type { McpServerId, ProjectId } from "@mosoo/id";

import type { DriverResolvedMcpServer } from "../../runtime/domain/driver-snapshot";
import { listProjectCredentialRowsByServerId } from "./mcp-credential.repository";
import {
  getCredentialStatus,
  toAuthorizationState,
  toUnavailableCredentialStatus,
} from "./mcp-mappers";
import { listServerRowsById } from "./mcp-server.repository";
import type { CredentialRow, ServerRow } from "./mcp-types";

function toRuntimeResolvedMcpServer(
  server: ServerRow,
  credential: CredentialRow | null,
): DriverResolvedMcpServer {
  const authorizationState = toAuthorizationState(server, credential);
  const base = {
    authType: server.authType,
    credentialScope: server.credentialScope,
    name: server.name,
    projectId: server.projectId,
    serverId: server.id,
    subjectLabel: credential?.subjectLabel ?? null,
  } as const;

  if (authorizationState === "active") {
    return {
      ...base,
      authorizationState,
      credentialId: credential!.id,
      credentialStatus: "active",
    };
  }

  return {
    ...base,
    authorizationState,
    credentialStatus: toUnavailableCredentialStatus(
      authorizationState,
      getCredentialStatus(credential),
    ),
  };
}

export async function resolveRuntimeMcpServersForSnapshot(
  database: D1Database,
  input: {
    projectId: ProjectId;
    serverIds: readonly McpServerId[];
  },
): Promise<DriverResolvedMcpServer[]> {
  const [serversById, credentialsByServerId] = await Promise.all([
    listServerRowsById(database, input.serverIds),
    listProjectCredentialRowsByServerId(database, input.serverIds),
  ]);

  return input.serverIds.map((serverId) => {
    const server = serversById.get(serverId);

    if (!server) {
      throw new Error("MCP server not found.");
    }

    if (server.projectId !== input.projectId) {
      throw new Error("MCP server is not available in this project.");
    }

    return toRuntimeResolvedMcpServer(server, credentialsByServerId.get(serverId) ?? null);
  });
}

export type { DriverResolvedMcpServer };
