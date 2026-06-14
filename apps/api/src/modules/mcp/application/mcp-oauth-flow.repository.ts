import { mcpOauthFlowsTable } from "@mosoo/db";
import type { McpOAuthFlowId, McpServerId } from "@mosoo/id";
import { and, eq, inArray, lte, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { cleanupStoredMcpOAuthFlowClientSecret } from "./mcp-oauth-secret-resolution";
import type { McpOAuthSecretActor } from "./mcp-oauth-secret-resolution";
import { OAUTH_FLOW_RESULT_RETENTION_MS } from "./mcp-oauth.constants";
import type { OAuthFlowRow } from "./mcp-types";

const oauthFlowColumns = {
  codeVerifier: mcpOauthFlowsTable.codeVerifier,
  createdAt: mcpOauthFlowsTable.createdAt,
  errorMessage: mcpOauthFlowsTable.errorMessage,
  expiresAt: mcpOauthFlowsTable.expiresAt,
  id: mcpOauthFlowsTable.id,
  initiatorUserId: mcpOauthFlowsTable.initiatorUserId,
  oauthClientId: mcpOauthFlowsTable.oauthClientId,
  oauthClientSecretSecretId: mcpOauthFlowsTable.oauthClientSecretSecretId,
  organizationId: mcpOauthFlowsTable.organizationId,
  appId: mcpOauthFlowsTable.appId,
  returnUrl: mcpOauthFlowsTable.returnUrl,
  scopeValuesJson: mcpOauthFlowsTable.scopeValuesJson,
  serverId: mcpOauthFlowsTable.serverId,
  status: mcpOauthFlowsTable.status,
  subjectLabel: mcpOauthFlowsTable.subjectLabel,
  tokenEndpoint: mcpOauthFlowsTable.tokenEndpoint,
};

export async function listOAuthFlowsForCleanup(
  database: D1Database,
  input: {
    cleanupAfterLte: number;
    includePendingExpired: boolean;
  },
): Promise<OAuthFlowRow[]> {
  return getAppDatabase(database)
    .select(oauthFlowColumns)
    .from(mcpOauthFlowsTable)
    .where(
      and(
        lte(mcpOauthFlowsTable.cleanupAfter, input.cleanupAfterLte),
        or(
          inArray(mcpOauthFlowsTable.status, ["succeeded", "failed", "expired"]),
          input.includePendingExpired
            ? and(
                eq(mcpOauthFlowsTable.status, "pending"),
                lte(mcpOauthFlowsTable.expiresAt, input.cleanupAfterLte),
              )
            : undefined,
        ),
      ),
    )
    .all();
}

export async function listOAuthFlowRowsByServerId(
  database: D1Database,
  serverId: McpServerId,
): Promise<OAuthFlowRow[]> {
  return getAppDatabase(database)
    .select(oauthFlowColumns)
    .from(mcpOauthFlowsTable)
    .where(eq(mcpOauthFlowsTable.serverId, serverId))
    .all();
}

export async function markOAuthFlowTerminal(
  database: D1Database,
  input: {
    errorMessage: string | null;
    flowId: McpOAuthFlowId;
    status: Exclude<OAuthFlowRow["status"], "pending">;
    subjectLabel?: string | null;
  },
): Promise<void> {
  const now = currentTimestampMs();

  await getAppDatabase(database)
    .update(mcpOauthFlowsTable)
    .set({
      cleanupAfter: now + OAUTH_FLOW_RESULT_RETENTION_MS,
      completedAt: now,
      errorMessage: input.errorMessage,
      status: input.status,
      subjectLabel: input.subjectLabel ?? null,
      updatedAt: now,
    })
    .where(eq(mcpOauthFlowsTable.id, input.flowId))
    .run();
}

export async function markOAuthFlowsExpiredBatch(
  database: D1Database,
  flows: readonly Pick<OAuthFlowRow, "id">[],
): Promise<void> {
  const flowIds = [...new Set(flows.map((flow) => flow.id))];

  if (flowIds.length === 0) {
    return;
  }

  const now = currentTimestampMs();

  await getAppDatabase(database)
    .update(mcpOauthFlowsTable)
    .set({
      cleanupAfter: now + OAUTH_FLOW_RESULT_RETENTION_MS,
      completedAt: now,
      errorMessage: "OAuth flow expired.",
      status: "expired",
      updatedAt: now,
    })
    .where(inArray(mcpOauthFlowsTable.id, flowIds))
    .run();
}

export async function destroyOAuthFlowArtifactsBatch(
  database: D1Database,
  flows: readonly Pick<
    OAuthFlowRow,
    "id" | "initiatorUserId" | "oauthClientSecretSecretId" | "organizationId" | "appId" | "serverId"
  >[],
  actor: McpOAuthSecretActor = {
    name: "mcp_oauth_flow_retention_cleanup",
    type: "system",
  },
): Promise<void> {
  const removableFlowIds: McpOAuthFlowId[] = [];

  for (const flow of flows) {
    const cleanupSucceeded = await cleanupStoredMcpOAuthFlowClientSecret({
      command: {
        actor,
        flow,
        purpose: "oauth_flow_artifact_cleanup",
        appId: flow.appId,
        secretId: flow.oauthClientSecretSecretId,
        secretKind: "flow_client_secret",
      },
      database,
    });

    if (cleanupSucceeded) {
      removableFlowIds.push(flow.id);
    }
  }

  const uniqueFlowIds = [...new Set(removableFlowIds)];

  if (uniqueFlowIds.length === 0) {
    return;
  }

  await getAppDatabase(database)
    .delete(mcpOauthFlowsTable)
    .where(inArray(mcpOauthFlowsTable.id, uniqueFlowIds))
    .run();
}

export async function clearOAuthFlowSecret(
  database: D1Database,
  flow: Pick<
    OAuthFlowRow,
    "id" | "initiatorUserId" | "oauthClientSecretSecretId" | "organizationId" | "appId" | "serverId"
  >,
): Promise<void> {
  const cleanupSucceeded = await cleanupStoredMcpOAuthFlowClientSecret({
    command: {
      actor: {
        name: "mcp_oauth_flow_terminal_cleanup",
        type: "system",
      },
      flow,
      purpose: "oauth_flow_terminal_cleanup",
      appId: flow.appId,
      secretId: flow.oauthClientSecretSecretId,
      secretKind: "flow_client_secret",
    },
    database,
  });

  if (!cleanupSucceeded) {
    return;
  }

  await getAppDatabase(database)
    .update(mcpOauthFlowsTable)
    .set({
      oauthClientSecretSecretId: null,
      updatedAt: currentTimestampMs(),
    })
    .where(eq(mcpOauthFlowsTable.id, flow.id))
    .run();
}

export async function getOAuthFlowRowById(
  database: D1Database,
  flowId: McpOAuthFlowId,
): Promise<OAuthFlowRow | null> {
  return (
    (await getAppDatabase(database)
      .select(oauthFlowColumns)
      .from(mcpOauthFlowsTable)
      .where(eq(mcpOauthFlowsTable.id, flowId))
      .limit(1)
      .get()) ?? null
  );
}
