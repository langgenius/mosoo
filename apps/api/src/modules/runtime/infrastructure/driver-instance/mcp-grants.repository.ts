import type { McpAuthType, McpAuthorizationState } from "@mosoo/contracts/mcp";
import { driverInstanceMcpGrantsTable } from "@mosoo/db";
import type { CredentialId, DriverInstanceId, McpServerId, ProjectId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";

export interface DriverInstanceMcpGrantRecord {
  authType: McpAuthType;
  authorizationState: McpAuthorizationState;
  canInvalidate: boolean;
  canRefresh: boolean;
  credentialId: CredentialId | null;
  projectId: ProjectId;
  serverId: McpServerId;
}

export async function getDriverInstanceMcpProxyGrant(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    serverId: McpServerId;
  },
): Promise<DriverInstanceMcpGrantRecord | null> {
  return (
    (await getAppDatabase(database)
      .select({
        authType: driverInstanceMcpGrantsTable.authType,
        authorizationState: driverInstanceMcpGrantsTable.authorizationState,
        canInvalidate: driverInstanceMcpGrantsTable.canInvalidate,
        canRefresh: driverInstanceMcpGrantsTable.canRefresh,
        credentialId: driverInstanceMcpGrantsTable.credentialId,
        projectId: driverInstanceMcpGrantsTable.projectId,
        serverId: driverInstanceMcpGrantsTable.serverId,
      })
      .from(driverInstanceMcpGrantsTable)
      .where(
        and(
          eq(driverInstanceMcpGrantsTable.driverInstanceId, input.driverInstanceId),
          eq(driverInstanceMcpGrantsTable.serverId, input.serverId),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}
