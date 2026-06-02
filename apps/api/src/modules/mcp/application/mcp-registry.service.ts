import type { McpRegistry, McpServerWithCredential } from "@mosoo/contracts/mcp";
import { Permission, can } from "@mosoo/contracts/permission";
import type { OrganizationId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { toServerWithCredential } from "./mcp-mappers";
import { readAccountId } from "./mcp-platform-ids";
import { loadMcpRegistrySnapshot } from "./mcp-registry.repository";

export async function getMcpRegistry(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<McpRegistry> {
  const viewerId = readAccountId(viewer.id);
  const snapshot = await loadMcpRegistrySnapshot(database, viewerId, organizationId);
  const personal: McpServerWithCredential[] = [];
  const organizationShared: McpServerWithCredential[] = [];

  for (const item of snapshot.servers) {
    const entry = toServerWithCredential(item.server, item.credential, item.hasSharedCredential);

    if (item.server.source === "personal") {
      personal.push(entry);
      continue;
    }

    organizationShared.push(entry);
  }

  return {
    currentUserEmail: snapshot.currentUserEmail ?? viewer.email ?? "",
    currentUserId: viewerId,
    currentUserName: snapshot.currentUserName ?? viewer.name ?? viewer.id,
    isAdmin: can(snapshot.viewerRole, Permission.McpOrganizationManage),
    organizationId,
    organizationShared,
    personal,
  };
}
