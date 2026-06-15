import {
  agentChannelBindingsTable,
  wechatChannelAccountsTable,
  wechatContextTokensTable,
} from "@mosoo/db";
import type { WeChatChannelAccountRow } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, AgentId, ChannelBindingId, PlatformId, AppId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import { ensureAppAgentOwner } from "../../agents/application/agent-access.service";
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
  appId: AppId;
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
    appId: row.appId,
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

async function cleanupStoredWeChatCredentialSecrets(input: {
  agentId: AgentId;
  database: D1Database;
  purpose: "channel_binding_replace_cleanup" | "channel_binding_write_rollback";
  appId: AppId;
  secretIds: readonly PlatformId[];
}): Promise<boolean> {
  let cleanupSucceeded = true;

  for (const secretId of new Set(input.secretIds)) {
    cleanupSucceeded =
      (await cleanupStoredAgentChannelBindingCredentialSecret({
        command: {
          agentId: input.agentId,
          provider: "wechat",
          appId: input.appId,
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

  const credentials = parseWeChatChannelCredentials(
    await readAgentChannelBindingCredentialSecret(bindings, {
      bindingId: row.id,
      expectedOwner: {
        agentId: row.agentId,
        appId: row.appId,
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
    appId: AppId;
    snapshot: WeChatQrPairingSnapshot;
  },
): Promise<WeChatChannelAccount> {
  const viewerId = viewer.id;
  const access = await ensureAppAgentOwner(bindings.DB, viewer.id, {
    agentId: input.agentId,
    appId: input.appId,
  });

  if (access.agent.status !== "published") {
    throw validationError("Publish the Agent before connecting WeChat.", "AGENT_NOT_PUBLISHED");
  }

  const credentials = normalizeWeChatChannelCredentialsFromSnapshot(input.snapshot);
  const database = getAppDatabase(bindings.DB);
  const existingForAgent =
    (await database
      .select()
      .from(wechatChannelAccountsTable)
      .where(
        and(
          eq(wechatChannelAccountsTable.agentId, input.agentId),
          eq(wechatChannelAccountsTable.appId, input.appId),
        ),
      )
      .limit(1)
      .get()) ?? null;
  const existingBinding =
    (await database
      .select()
      .from(agentChannelBindingsTable)
      .where(
        and(
          eq(agentChannelBindingsTable.agentId, input.agentId),
          eq(agentChannelBindingsTable.appId, input.appId),
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
        appId: wechatChannelAccountsTable.appId,
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

  if (
    existingForRuntime &&
    (existingForRuntime.agentId !== input.agentId || existingForRuntime.appId !== input.appId)
  ) {
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
    provider: "wechat",
    appId: input.appId,
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
              appId: input.appId,
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
            appId: input.appId,
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
            appId: input.appId,
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
          appId: input.appId,
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
      purpose: "channel_binding_write_rollback",
      appId: input.appId,
      secretIds: [encryptedCredsSecretId],
    });
    throw error;
  }

  await cleanupStoredWeChatCredentialSecrets({
    agentId: input.agentId,
    database: bindings.DB,
    purpose: "channel_binding_replace_cleanup",
    appId: input.appId,
    secretIds: staleCredentialSecretIds,
  });
  await deleteSecretsById(bindings.DB, staleContextTokenSecretIds);

  const row = await readWeChatChannelAccountRow(bindings.DB, { accountId });

  if (!row) {
    throw new Error("WeChat channel account could not be loaded.");
  }

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
