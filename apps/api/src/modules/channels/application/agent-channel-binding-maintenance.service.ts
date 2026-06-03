import {
  agentChannelBindingsTable,
  agentsTable,
  vaultSecretsTable,
  wechatChannelAccountsTable,
} from "@mosoo/db";
import type { ChannelBindingId, PlatformId } from "@mosoo/id";
import { and, asc, eq, isNull, like } from "drizzle-orm";

import {
  createErrorLogContext,
  logError,
  logInfo,
  logWarn,
} from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { notFoundError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { stopDiscordGatewayConnection } from "../discord/discord-gateway-connection-client";
import { deleteWeChatChannelAccountRuntime } from "../wechat/wechat-runtime-store";
import type { DeleteAgentChannelBindingInput } from "./agent-channel-binding.types";
import {
  CHANNEL_BINDING_CREDENTIAL_SECRET_KIND_PREFIX,
  cleanupStoredAgentChannelBindingCredentialSecret,
  parseAgentChannelBindingCredentialSecretKind,
} from "./channel-credential-secret-resolution";
import { stopLarkLongConnection } from "./lark-long-connection-maintenance.service";

const CHANNEL_CREDENTIAL_ORPHAN_CLEANUP_BATCH_SIZE = 50;

export interface ChannelCredentialOrphanCleanupResult {
  deleted: number;
  failed: number;
  skipped: number;
  total: number;
}

async function stopDiscordGatewayConnectionBeforeDeletingBinding(
  bindings: ApiBindings,
  bindingId: ChannelBindingId,
): Promise<void> {
  try {
    await stopDiscordGatewayConnection(bindings, { bindingId });
  } catch (error) {
    logError("agent-channel-binding.discord_gateway_stop_before_delete_failed", {
      ...createErrorLogContext(error),
      bindingId,
      provider: "discord",
    });
  }
}

async function stopLarkLongConnectionBeforeDeletingBinding(
  bindings: ApiBindings,
  bindingId: ChannelBindingId,
): Promise<void> {
  try {
    await stopLarkLongConnection({ bindingId, bindings });
  } catch (error) {
    logError("agent-channel-binding.lark_gateway_stop_before_delete_failed", {
      ...createErrorLogContext(error),
      bindingId,
      provider: "lark",
    });
  }
}

async function markDiscordGatewayBindingDeleting(
  database: D1Database,
  bindingId: ChannelBindingId,
): Promise<void> {
  await getAppDatabase(database)
    .update(agentChannelBindingsTable)
    .set({
      lastErrorCode: "binding_deleting",
      status: "error",
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(agentChannelBindingsTable.id, bindingId),
        eq(agentChannelBindingsTable.provider, "discord"),
      ),
    )
    .run();
}

async function listOrphanChannelCredentialSecrets(input: {
  bindings: ApiBindings;
  limit: number;
}): Promise<Array<{ id: PlatformId; kind: string }>> {
  return getAppDatabase(input.bindings.DB)
    .select({
      id: vaultSecretsTable.id,
      kind: vaultSecretsTable.kind,
    })
    .from(vaultSecretsTable)
    .leftJoin(
      agentChannelBindingsTable,
      eq(agentChannelBindingsTable.encryptedCredsSecretId, vaultSecretsTable.id),
    )
    .leftJoin(
      wechatChannelAccountsTable,
      eq(wechatChannelAccountsTable.encryptedCredsSecretId, vaultSecretsTable.id),
    )
    .where(
      and(
        like(vaultSecretsTable.kind, `${CHANNEL_BINDING_CREDENTIAL_SECRET_KIND_PREFIX}%`),
        isNull(agentChannelBindingsTable.id),
        isNull(wechatChannelAccountsTable.id),
      ),
    )
    .orderBy(asc(vaultSecretsTable.id))
    .limit(input.limit)
    .all();
}

export async function cleanupOrphanChannelBindingCredentialSecrets(
  bindings: ApiBindings,
  _scheduledAt: Date,
  options: { limit?: number } = {},
): Promise<ChannelCredentialOrphanCleanupResult> {
  const rows = await listOrphanChannelCredentialSecrets({
    bindings,
    limit: options.limit ?? CHANNEL_CREDENTIAL_ORPHAN_CLEANUP_BATCH_SIZE,
  });
  let deleted = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const owner = parseAgentChannelBindingCredentialSecretKind(row.kind);

    if (owner === null) {
      skipped += 1;
      logWarn("agent-channel-binding.credential-secret-orphan-cleanup.skipped", {
        kind: row.kind,
        reason: "invalid_channel_credential_secret_kind",
        secretId: row.id,
      });
      continue;
    }

    const cleanupSucceeded = await cleanupStoredAgentChannelBindingCredentialSecret({
      command: {
        ...owner,
        purpose: "channel_binding_orphan_maintenance",
        secretId: row.id,
      },
      database: bindings.DB,
    });

    if (cleanupSucceeded) {
      deleted += 1;
    } else {
      failed += 1;
    }
  }

  if (rows.length > 0) {
    logInfo("agent-channel-binding.credential-secret-orphan-cleanup.completed", {
      deleted,
      failed,
      skipped,
      total: rows.length,
    });
  }

  return {
    deleted,
    failed,
    skipped,
    total: rows.length,
  };
}

export async function deleteAgentChannelBinding(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: DeleteAgentChannelBindingInput,
): Promise<void> {
  const row = await getAppDatabase(bindings.DB)
    .select({
      agentId: agentChannelBindingsTable.agentId,
      encryptedCredsSecretId: agentChannelBindingsTable.encryptedCredsSecretId,
      id: agentChannelBindingsTable.id,
      organizationId: agentsTable.organizationId,
      provider: agentChannelBindingsTable.provider,
    })
    .from(agentChannelBindingsTable)
    .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
    .where(eq(agentChannelBindingsTable.id, input.bindingId))
    .limit(1)
    .get();

  if (!row) {
    throw notFoundError("Agent channel binding not found.");
  }

  await ensureAgentEditor(bindings.DB, viewer.id, row.agentId);

  if (row.provider === "discord") {
    await markDiscordGatewayBindingDeleting(bindings.DB, row.id);
    await stopDiscordGatewayConnectionBeforeDeletingBinding(bindings, row.id);
  }

  if (row.provider === "lark") {
    await stopLarkLongConnectionBeforeDeletingBinding(bindings, row.id);
  }

  if (row.provider === "wechat") {
    await deleteWeChatChannelAccountRuntime(bindings, { accountId: row.id });
  }

  await getAppDatabase(bindings.DB)
    .delete(agentChannelBindingsTable)
    .where(
      and(
        eq(agentChannelBindingsTable.id, input.bindingId),
        eq(agentChannelBindingsTable.provider, row.provider),
      ),
    )
    .run();
  await cleanupStoredAgentChannelBindingCredentialSecret({
    command: {
      agentId: row.agentId,
      organizationId: row.organizationId,
      provider: row.provider,
      purpose: "channel_binding_delete",
      secretId: row.encryptedCredsSecretId,
    },
    database: bindings.DB,
  });
}
