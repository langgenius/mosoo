import type { McpRegistry } from "@mosoo/contracts/mcp";
import { accountsTable, mcpCredentialsTable, mcpServersTable } from "@mosoo/db";
import type { ProjectId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { credentialColumns } from "./mcp-credential.repository";
import { toServerWithCredential } from "./mcp-mappers";
import { serverColumns } from "./mcp-server.repository";

export async function getMcpRegistry(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
): Promise<McpRegistry> {
  await ensureProjectOwnership(database, viewer.id, projectId);
  const rows = await getAppDatabase(database)
    .select({ credential: credentialColumns, server: serverColumns })
    .from(mcpServersTable)
    .leftJoin(accountsTable, eq(accountsTable.id, mcpServersTable.ownerId))
    .leftJoin(
      mcpCredentialsTable,
      and(
        eq(mcpCredentialsTable.serverId, mcpServersTable.id),
        eq(mcpCredentialsTable.scope, "app"),
      ),
    )
    .where(eq(mcpServersTable.projectId, projectId))
    .orderBy(desc(mcpServersTable.updatedAt))
    .all();

  return {
    projectId,
    servers: rows.map((row) => toServerWithCredential(row.server, row.credential)),
  };
}
