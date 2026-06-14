import type { McpRegistry, McpServerWithCredential } from "@mosoo/contracts/mcp";
import type { AppId } from "@mosoo/id";

import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { toServerWithCredential } from "./mcp-mappers";
import { readAccountId } from "./mcp-platform-ids";
import { loadMcpRegistrySnapshot } from "./mcp-registry.repository";

export async function getMcpRegistry(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<McpRegistry> {
  const viewerId = readAccountId(viewer.id);
  await ensureAppOwnership(database, viewerId, appId);
  const snapshot = await loadMcpRegistrySnapshot(database, viewerId, appId);
  const servers: McpServerWithCredential[] = [];

  for (const item of snapshot.servers) {
    servers.push(toServerWithCredential(item.server, item.credential, item.hasCredential));
  }

  return {
    currentUserEmail: snapshot.currentUserEmail ?? viewer.email ?? "",
    currentUserId: viewerId,
    currentUserName: snapshot.currentUserName ?? viewer.name ?? viewer.id,
    appId,
    servers,
  };
}
