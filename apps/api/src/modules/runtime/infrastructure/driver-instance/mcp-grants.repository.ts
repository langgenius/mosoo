import type { McpAuthType, McpAuthorizationState } from "@mosoo/contracts/mcp";
import { driverInstanceMcpGrantsTable, sessionRunsTable, sessionRunSkillsTable } from "@mosoo/db";
import type { CredentialId, DriverInstanceId, McpServerId, SkillSnapshotId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";

export interface DriverInstanceMcpGrantRecord {
  authType: McpAuthType;
  authorizationState: McpAuthorizationState;
  canInvalidate: boolean;
  canRefresh: boolean;
  credentialId: CredentialId | null;
  serverId: McpServerId;
}

type DriverInstanceGrantRequest =
  | {
      credentialId: CredentialId;
      driverInstanceId: DriverInstanceId;
      requireAction: "invalidate" | "refresh";
    }
  | {
      driverInstanceId: DriverInstanceId;
      requireAction: "mcp_proxy";
      serverId: McpServerId;
    }
  | {
      driverInstanceId: DriverInstanceId;
      requireAction: "skill_snapshot";
      snapshotId: SkillSnapshotId;
    };

async function readDriverInstanceMcpProxyGrant(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    serverId: McpServerId;
  },
): Promise<DriverInstanceMcpGrantRecord | null> {
  const grant =
    (await getAppDatabase(database)
      .select({
        authType: driverInstanceMcpGrantsTable.authType,
        authorizationState: driverInstanceMcpGrantsTable.authorizationState,
        canInvalidate: driverInstanceMcpGrantsTable.canInvalidate,
        canRefresh: driverInstanceMcpGrantsTable.canRefresh,
        credentialId: driverInstanceMcpGrantsTable.credentialId,
        driverInstanceId: driverInstanceMcpGrantsTable.driverInstanceId,
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
      .get()) ?? null;

  if (grant === null) {
    return null;
  }

  return {
    authType: grant.authType,
    authorizationState: grant.authorizationState,
    canInvalidate: grant.canInvalidate,
    canRefresh: grant.canRefresh,
    credentialId: grant.credentialId,
    serverId: grant.serverId,
  };
}

export async function requireDriverInstanceGrant(
  database: D1Database,
  input: DriverInstanceGrantRequest,
): Promise<void> {
  if (input.requireAction === "mcp_proxy") {
    await requireDriverInstanceMcpProxyGrant(database, {
      driverInstanceId: input.driverInstanceId,
      serverId: input.serverId,
    });
    return;
  }

  if (input.requireAction === "skill_snapshot") {
    const allowedSnapshot =
      (await getAppDatabase(database)
        .select({ snapshotId: sessionRunSkillsTable.snapshotId })
        .from(sessionRunsTable)
        .innerJoin(
          sessionRunSkillsTable,
          eq(sessionRunSkillsTable.sessionRunId, sessionRunsTable.id),
        )
        .where(
          and(
            eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
            inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
            eq(sessionRunSkillsTable.snapshotId, input.snapshotId),
          ),
        )
        .limit(1)
        .get()) ?? null;

    if (!allowedSnapshot) {
      throw new Error("Snapshot is not available for this driver instance.");
    }

    return;
  }

  const grant =
    (await getAppDatabase(database)
      .select({
        authType: driverInstanceMcpGrantsTable.authType,
        authorizationState: driverInstanceMcpGrantsTable.authorizationState,
        canInvalidate: driverInstanceMcpGrantsTable.canInvalidate,
        canRefresh: driverInstanceMcpGrantsTable.canRefresh,
        credentialId: driverInstanceMcpGrantsTable.credentialId,
        driverInstanceId: driverInstanceMcpGrantsTable.driverInstanceId,
        serverId: driverInstanceMcpGrantsTable.serverId,
      })
      .from(driverInstanceMcpGrantsTable)
      .where(
        and(
          eq(driverInstanceMcpGrantsTable.driverInstanceId, input.driverInstanceId),
          eq(driverInstanceMcpGrantsTable.credentialId, input.credentialId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!grant) {
    throw new Error("Credential is not available for this driver instance.");
  }

  if (grant.authorizationState !== "active") {
    throw new Error("Credential grant is not active for this driver instance.");
  }

  if (grant.authType !== "oauth") {
    throw new Error("Only OAuth credentials can be managed by the driver.");
  }

  if (input.requireAction === "refresh" && !grant.canRefresh) {
    throw new Error("Credential refresh is not allowed for this driver instance.");
  }

  if (input.requireAction === "invalidate" && !grant.canInvalidate) {
    throw new Error("Credential invalidation is not allowed for this driver instance.");
  }
}

async function requireDriverInstanceMcpProxyGrant(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    serverId: McpServerId;
  },
): Promise<DriverInstanceMcpGrantRecord> {
  const grant = await readDriverInstanceMcpProxyGrant(database, input);

  if (!grant) {
    throw new Error("MCP server is not available for this driver instance.");
  }

  if (grant.authorizationState !== "active") {
    throw new Error("MCP server grant is not active for this driver instance.");
  }

  if (grant.credentialId === null || grant.credentialId.length === 0) {
    throw new Error("MCP server grant is missing a credential.");
  }

  return {
    authType: grant.authType,
    authorizationState: grant.authorizationState,
    canInvalidate: grant.canInvalidate,
    canRefresh: grant.canRefresh,
    credentialId: grant.credentialId,
    serverId: grant.serverId,
  };
}

export async function getDriverInstanceMcpProxyGrant(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    serverId: McpServerId;
  },
): Promise<DriverInstanceMcpGrantRecord | null> {
  return readDriverInstanceMcpProxyGrant(database, input);
}
