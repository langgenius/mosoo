import { mcpOauthFlowsTable } from "@mosoo/db";
import type { McpOAuthFlowId, McpServerId } from "@mosoo/id";
import { and, eq, inArray, lte, or } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { deleteSecret } from "../../vault/application/vault-secret-store";
import { OAUTH_FLOW_RESULT_RETENTION_MS } from "./mcp-oauth.constants";
import type { OAuthFlowRow } from "./mcp-types";

const oauthFlowColumns = {
  codeVerifier: mcpOauthFlowsTable.codeVerifier,
  errorMessage: mcpOauthFlowsTable.errorMessage,
  expiresAt: mcpOauthFlowsTable.expiresAt,
  id: mcpOauthFlowsTable.id,
  initiatorUserId: mcpOauthFlowsTable.initiatorUserId,
  oauthClientId: mcpOauthFlowsTable.oauthClientId,
  oauthClientSecretSecretId: mcpOauthFlowsTable.oauthClientSecretSecretId,
  projectId: mcpOauthFlowsTable.projectId,
  scopeValuesJson: mcpOauthFlowsTable.scopeValuesJson,
  serverId: mcpOauthFlowsTable.serverId,
  status: mcpOauthFlowsTable.status,
  subjectLabel: mcpOauthFlowsTable.subjectLabel,
  tokenEndpoint: mcpOauthFlowsTable.tokenEndpoint,
};

type OAuthFlowSecretOwner = Pick<OAuthFlowRow, "id" | "oauthClientSecretSecretId">;

export async function listOAuthFlowsForCleanup(
  database: D1Database,
  now: number,
): Promise<OAuthFlowRow[]> {
  return getAppDatabase(database)
    .select(oauthFlowColumns)
    .from(mcpOauthFlowsTable)
    .where(
      and(
        lte(mcpOauthFlowsTable.cleanupAfter, now),
        or(
          inArray(mcpOauthFlowsTable.status, ["succeeded", "failed", "expired"]),
          and(eq(mcpOauthFlowsTable.status, "pending"), lte(mcpOauthFlowsTable.expiresAt, now)),
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
  flow: OAuthFlowSecretOwner,
  input: {
    errorMessage: string | null;
    status: Exclude<OAuthFlowRow["status"], "pending">;
    subjectLabel: string | null;
  },
): Promise<void> {
  const now = currentTimestampMs();

  // Delete the vault row before dropping its last reference, so a failure
  // leaves a retryable reference instead of orphaned ciphertext.
  await deleteSecret(database, flow.oauthClientSecretSecretId);
  await getAppDatabase(database)
    .update(mcpOauthFlowsTable)
    .set({
      cleanupAfter: now + OAUTH_FLOW_RESULT_RETENTION_MS,
      completedAt: now,
      errorMessage: input.errorMessage,
      oauthClientSecretSecretId: null,
      status: input.status,
      subjectLabel: input.subjectLabel,
      updatedAt: now,
    })
    .where(eq(mcpOauthFlowsTable.id, flow.id))
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

// Best effort and never rejects: a flow whose secret cannot be deleted keeps
// its row, and so its reference, for the next cleanup to retry.
export async function destroyOAuthFlowArtifactsBatch(
  database: D1Database,
  flows: readonly OAuthFlowSecretOwner[],
): Promise<void> {
  const results = await Promise.allSettled(
    flows.map(async (flow) => deleteSecret(database, flow.oauthClientSecretSecretId)),
  );
  const removableFlowIds = flows.flatMap((flow, index) => {
    const result = results[index];

    if (result?.status === "rejected") {
      logError("mcp-oauth.flow-client-secret-cleanup.failed", {
        ...createErrorLogContext(result.reason),
        flowId: flow.id,
      });
      return [];
    }

    return [flow.id];
  });

  if (removableFlowIds.length === 0) {
    return;
  }

  try {
    await getAppDatabase(database)
      .delete(mcpOauthFlowsTable)
      .where(inArray(mcpOauthFlowsTable.id, removableFlowIds))
      .run();
  } catch (error) {
    logError("mcp-oauth.flow-cleanup.failed", {
      ...createErrorLogContext(error),
      flowCount: removableFlowIds.length,
    });
  }
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
