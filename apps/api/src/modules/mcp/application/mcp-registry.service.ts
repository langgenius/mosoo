import type { McpRegistry, McpServerWithCredential } from "@mosoo/contracts/mcp";
import type { ProjectId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { toServerWithCredential } from "./mcp-mappers";
import { readAccountId } from "./mcp-platform-ids";
import { loadMcpRegistrySnapshot } from "./mcp-registry.repository";

export async function getMcpRegistry(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
): Promise<McpRegistry> {
  const viewerId = readAccountId(viewer.id);
  await ensureProjectOwnership(database, viewerId, projectId);
  const snapshot = await loadMcpRegistrySnapshot(database, viewerId, projectId);
  const servers: McpServerWithCredential[] = [];

  for (const item of snapshot.servers) {
    servers.push(toServerWithCredential(item.server, item.credential, item.hasCredential));
  }

  return {
    currentUserEmail: snapshot.currentUserEmail ?? viewer.email ?? "",
    currentUserId: viewerId,
    currentUserName: snapshot.currentUserName ?? viewer.name ?? viewer.id,
    projectId,
    servers,
  };
}
