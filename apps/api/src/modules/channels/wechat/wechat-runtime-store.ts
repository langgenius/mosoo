import {
  agentChannelBindingsTable,
  agentsTable,
  wechatChannelAccountsTable,
  wechatContextTokensTable,
} from "@mosoo/db";
import type { WeChatChannelAccountRow } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, AgentId, ChannelBindingId, OrganizationId, PlatformId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import { appendAuditEvent } from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { deleteSecretsById } from "../../mcp/application/mcp-secret-store";
import {
  cleanupStoredAgentChannelBindingCredentialSecret,
  readAgentChannelBindingCredentialSecret,
  storeAgentChannelBindingCredentialSecret,
} from "../application/channel-credential-secret-resolution";
import { readWeChatContextTokenSecret } from "./wechat-context-token-secret-store";
import {
  normalizeWeChatChannelCredentialsFromSnapshot,
  parseWeChatChannelCredentials,
  serializeWeChatChannelCredentials,
} from "./wechat-credentials";
import type { WeChatChannelCredentials } from "./wechat-credentials";
import type { WeChatQrPairingSnapshot } from "./wechat-runtime";

export { createWeChatPollingOwnerDatabaseStore } from "./wechat-polling-owner-store";

export interface WeChatChannelAccount {
  agentId: AgentId;
  baseUrl: string;
  createdAt: string;
  cursor: string | null;
  externalAccountId: string;
  externalBotId: string;
  id: ChannelBindingId;
  lastErrorCode: string | null;
  ownerAccountId: AccountId;
  runtimeStateJson: string;
  status: WeChatChannelAccountRow["status"];
  updatedAt: string;
}

export interface WeChatChannelAccountWithCredentials {
  account: WeChatChannelAccount;
  credentials: WeChatChannelCredentials;
}

export interface WeChatContextTokenRecord {
  accountId: ChannelBindingId;
  contextToken: string;
  contextTokenKey: string;
  externalAccountId: string;
  peerId: string;
  toUserId: string;
}

function toWeChatChannelAccount(row: WeChatChannelAccountRow): WeChatChannelAccount {
  return {
    agentId: row.agentId,
    baseUrl: row.baseUrl,
    createdAt: toIsoString(row.createdAt),
    cursor: row.cursor,
    externalAccountId: row.externalAccountId,
    externalBotId: row.externalBotId,
    id: row.id,
    lastErrorCode: row.lastErrorCode,
    ownerAccountId: row.ownerAccountId,
    runtimeStateJson: row.runtimeStateJson,
    status: row.status,
    updatedAt: toIsoString(row.updatedAt),
  };
}

function buildWeChatBindingDisplayMetadata(input: {
  ilinkBotId: string;
  ilinkUserId: string;
}): Record<string, string> {
  return {
    ilink_bot_id: input.ilinkBotId,
    ilink_user_id: input.ilinkUserId,
  };
}

async function readWeChatChannelAccountRow(
  database: D1Database,
  input: { accountId: ChannelBindingId },
): Promise<WeChatChannelAccountRow | null> {
  return (
    (await getAppDatabase(database)
      .select()
      .from(wechatChannelAccountsTable)
      .where(eq(wechatChannelAccountsTable.id, input.accountId))
      .limit(1)
      .get()) ?? null
  );
}

async function readWeChatContextTokenSecretIdsForAccount(
  database: D1Database,
  input: { accountId: ChannelBindingId },
): Promise<PlatformId[]> {
  const rows = await getAppDatabase(database)
    .select({
      encryptedContextTokenSecretId: wechatContextTokensTable.encryptedContextTokenSecretId,
    })
    .from(wechatContextTokensTable)
    .where(eq(wechatContextTokensTable.accountId, input.accountId))
    .all();

  return rows.map((row) => row.encryptedContextTokenSecretId);
}

async function readWeChatAccountOrganizationId(
  database: D1Database,
  input: { agentId: AgentId },
): Promise<OrganizationId> {
  const row =
    (await getAppDatabase(database)
      .select({ organizationId: agentsTable.organizationId })
      .from(agentsTable)
      .where(eq(agentsTable.id, input.agentId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw validationError("WeChat channel account owner is unavailable.");
  }

  return row.organizationId as OrganizationId;
}

async function cleanupStoredWeChatCredentialSecrets(input: {
  agentId: AgentId;
  database: D1Database;
  organizationId: OrganizationId;
  purpose: "channel_binding_replace_cleanup" | "channel_binding_write_rollback";
  secretIds: readonly PlatformId[];
}): Promise<boolean> {
  let cleanupSucceeded = true;

  for (const secretId of new Set(input.secretIds)) {
    cleanupSucceeded =
      (await cleanupStoredAgentChannelBindingCredentialSecret({
        command: {
          agentId: input.agentId,
          organizationId: input.organizationId,
          provider: "wechat",
          purpose: input.purpose,
          secretId,
        },
        database: input.database,
      })) && cleanupSucceeded;
  }

  return cleanupSucceeded;
}

export async function readWeChatChannelAccountWithCredentials(
  bindings: ApiBindings,
  input: { accountId: ChannelBindingId },
): Promise<WeChatChannelAccountWithCredentials | null> {
  const row = await readWeChatChannelAccountRow(bindings.DB, input);

  if (!row) {
    return null;
  }

  const organizationId = await readWeChatAccountOrganizationId(bindings.DB, {
    agentId: row.agentId,
  });
  const credentials = parseWeChatChannelCredentials(
    await readAgentChannelBindingCredentialSecret(bindings, {
      bindingId: row.id,
      expectedOwner: {
        agentId: row.agentId,
        organizationId,
      },
      provider: "wechat",
      purpose: "channel_context",
      secretId: row.encryptedCredsSecretId,
    }),
  );

  return {
    account: toWeChatChannelAccount(row),
    credentials,
  };
}

export async function persistConfirmedWeChatQrPairing(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    snapshot: WeChatQrPairingSnapshot;
  },
): Promise<WeChatChannelAccount> {
  const viewerId = viewer.id;
  const access = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  if (access.agent.status !== "published") {
    throw validationError("Publish the Agent before connecting WeChat.", "AGENT_NOT_PUBLISHED");
  }

  const credentials = normalizeWeChatChannelCredentialsFromSnapshot(input.snapshot);
  const database = getAppDatabase(bindings.DB);
  const existingForAgent =
    (await database
      .select()
      .from(wechatChannelAccountsTable)
      .where(eq(wechatChannelAccountsTable.agentId, input.agentId))
      .limit(1)
      .get()) ?? null;
  const existingBinding =
    (await database
      .select()
      .from(agentChannelBindingsTable)
      .where(
        and(
          eq(agentChannelBindingsTable.agentId, input.agentId),
          eq(agentChannelBindingsTable.provider, "wechat"),
        ),
      )
      .limit(1)
      .get()) ?? null;
  const existingForRuntime =
    (await database
      .select({
        agentId: wechatChannelAccountsTable.agentId,
        id: wechatChannelAccountsTable.id,
      })
      .from(wechatChannelAccountsTable)
      .where(
        and(
          eq(wechatChannelAccountsTable.externalAccountId, credentials.ilinkUserId),
          eq(wechatChannelAccountsTable.externalBotId, credentials.ilinkBotId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (existingForRuntime && existingForRuntime.agentId !== input.agentId) {
    throw validationError(
      "This WeChat account is already connected to an Agent.",
      "WECHAT_ACCOUNT_BOUND",
    );
  }

  if (existingForAgent && existingBinding && existingForAgent.id !== existingBinding.id) {
    throw validationError(
      "WeChat channel binding and runtime account are inconsistent.",
      "WECHAT_BINDING_INCONSISTENT",
    );
  }

  const nowMs = currentTimestampMs();
  const encryptedCredsSecretId = await storeAgentChannelBindingCredentialSecret(bindings, {
    agentId: input.agentId,
    credentialsJson: serializeWeChatChannelCredentials(credentials),
    organizationId: access.agent.organizationId,
    provider: "wechat",
    purpose:
      existingForAgent || existingBinding ? "channel_binding_update" : "channel_binding_create",
  });
  const accountId: ChannelBindingId =
    existingForAgent?.id ?? existingBinding?.id ?? createPlatformId<ChannelBindingId>();
  const runtimeChanged =
    existingForAgent !== null &&
    (existingForAgent.externalAccountId !== credentials.ilinkUserId ||
      existingForAgent.externalBotId !== credentials.ilinkBotId);
  const staleContextTokenSecretIds = runtimeChanged
    ? await readWeChatContextTokenSecretIdsForAccount(bindings.DB, { accountId })
    : [];
  const staleCredentialSecretIds = [
    existingForAgent?.encryptedCredsSecretId,
    existingBinding?.encryptedCredsSecretId,
  ].filter(
    (secretId): secretId is PlatformId =>
      typeof secretId === "string" && secretId !== encryptedCredsSecretId,
  );
  const displayMetadataJson = JSON.stringify(
    buildWeChatBindingDisplayMetadata({
      ilinkBotId: credentials.ilinkBotId,
      ilinkUserId: credentials.ilinkUserId,
    }),
  );

  try {
    await runAppDatabaseBatch(bindings.DB, (db) => {
      const upsertBinding = existingBinding
        ? db
            .update(agentChannelBindingsTable)
            .set({
              displayMetadataJson,
              encryptedCredsSecretId,
              externalBotId: credentials.ilinkBotId,
              externalTenantId: credentials.ilinkUserId,
              lastErrorCode: null,
              status: "active",
              updatedAt: nowMs,
            })
            .where(eq(agentChannelBindingsTable.id, existingBinding.id))
        : db.insert(agentChannelBindingsTable).values({
            agentId: input.agentId,
            createdAt: nowMs,
            displayMetadataJson,
            encryptedCredsSecretId,
            externalBotId: credentials.ilinkBotId,
            externalTenantId: credentials.ilinkUserId,
            id: accountId,
            lastErrorCode: null,
            provider: "wechat",
            status: "active",
            updatedAt: nowMs,
          });

      if (existingForAgent) {
        const updateAccount = db
          .update(wechatChannelAccountsTable)
          .set({
            baseUrl: credentials.baseUrl,
            encryptedCredsSecretId,
            externalAccountId: credentials.ilinkUserId,
            externalBotId: credentials.ilinkBotId,
            lastErrorCode: null,
            ownerAccountId: viewerId,
            status: "idle",
            statusChangedAt: nowMs,
            updatedAt: nowMs,
          })
          .where(eq(wechatChannelAccountsTable.id, existingForAgent.id));

        if (!runtimeChanged) {
          return [updateAccount, upsertBinding];
        }

        return [
          updateAccount,
          db
            .delete(wechatContextTokensTable)
            .where(eq(wechatContextTokensTable.accountId, existingForAgent.id)),
          upsertBinding,
        ];
      }

      return [
        db.insert(wechatChannelAccountsTable).values({
          agentId: input.agentId,
          baseUrl: credentials.baseUrl,
          createdAt: nowMs,
          cursor: null,
          encryptedCredsSecretId,
          externalAccountId: credentials.ilinkUserId,
          externalBotId: credentials.ilinkBotId,
          id: accountId,
          lastErrorCode: null,
          lastHeartbeatAt: null,
          lastInboundAt: null,
          lastPollAt: null,
          ownerAccountId: viewerId,
          runtimeStateJson: "{}",
          status: "idle",
          statusChangedAt: nowMs,
          updatedAt: nowMs,
        }),
        upsertBinding,
      ];
    });
  } catch (error) {
    await cleanupStoredWeChatCredentialSecrets({
      agentId: input.agentId,
      database: bindings.DB,
      organizationId: access.agent.organizationId,
      purpose: "channel_binding_write_rollback",
      secretIds: [encryptedCredsSecretId],
    });
    throw error;
  }

  const credentialSecretCleanupSucceeded = await cleanupStoredWeChatCredentialSecrets({
    agentId: input.agentId,
    database: bindings.DB,
    organizationId: access.agent.organizationId,
    purpose: "channel_binding_replace_cleanup",
    secretIds: staleCredentialSecretIds,
  });
  await deleteSecretsById(bindings.DB, staleContextTokenSecretIds);

  const row = await readWeChatChannelAccountRow(bindings.DB, { accountId });

  if (!row) {
    throw new Error("WeChat channel account could not be loaded.");
  }

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.agentUpdate,
    actorDisplay: viewer.name,
    actorId: viewerId,
    actorMetadata: {},
    actorType: "user",
    metadata: {
      agentId: access.agent.id,
      bindingId: accountId,
      channel_binding_event: existingBinding ? "updated" : "created",
      credential_secret_cleanup: credentialSecretCleanupSucceeded ? "completed" : "failed",
      provider: "wechat",
    },
    organizationId: access.agent.organizationId,
    outcome: "success",
    resourceDisplay: access.agent.name,
    resourceId: access.agent.id,
    resourceType: AUDIT_RESOURCE.agent,
  });

  return toWeChatChannelAccount(row);
}

export async function deleteWeChatChannelAccountRuntime(
  bindings: ApiBindings,
  input: { accountId: ChannelBindingId },
): Promise<void> {
  const row = await readWeChatChannelAccountRow(bindings.DB, input);

  if (!row) {
    return;
  }

  const contextTokenSecretIds = await readWeChatContextTokenSecretIdsForAccount(bindings.DB, {
    accountId: row.id,
  });

  await runAppDatabaseBatch(bindings.DB, (db) => [
    db.delete(wechatContextTokensTable).where(eq(wechatContextTokensTable.accountId, row.id)),
    db.delete(wechatChannelAccountsTable).where(eq(wechatChannelAccountsTable.id, row.id)),
  ]);
  await deleteSecretsById(bindings.DB, contextTokenSecretIds);
}

export async function readWeChatContextTokenForPeer(
  bindings: ApiBindings,
  input: {
    accountId: ChannelBindingId;
    peerId: string;
  },
): Promise<WeChatContextTokenRecord | null> {
  const account = await readWeChatChannelAccountRow(bindings.DB, { accountId: input.accountId });

  if (!account) {
    return null;
  }

  const row =
    (await getAppDatabase(bindings.DB)
      .select()
      .from(wechatContextTokensTable)
      .where(
        and(
          eq(wechatContextTokensTable.accountId, account.id),
          eq(wechatContextTokensTable.externalAccountId, account.externalAccountId),
          eq(wechatContextTokensTable.peerId, input.peerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    accountId: row.accountId,
    contextToken: await readWeChatContextTokenSecret(bindings, {
      accountId: account.id,
      externalAccountId: account.externalAccountId,
      peerId: row.peerId,
      purpose: "wechat_reply",
      secretId: row.encryptedContextTokenSecretId,
    }),
    contextTokenKey: row.contextTokenKey,
    externalAccountId: row.externalAccountId,
    peerId: row.peerId,
    toUserId: row.toUserId,
  };
}
