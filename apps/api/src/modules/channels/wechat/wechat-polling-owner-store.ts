import { wechatChannelAccountsTable, wechatContextTokensTable } from "@mosoo/db";
import type { WeChatChannelAccountRow, WeChatContextTokenId } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ChannelBindingId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { deleteSecret } from "../../mcp/application/mcp-secret-store";
import { storeWeChatContextTokenSecret } from "./wechat-context-token-secret-store";
import type {
  WeChatPollingOwnerContextTokenRecord,
  WeChatPollingOwnerCursorRecord,
  WeChatPollingOwnerRuntimeStateRecord,
  WeChatPollingOwnerStorageKey,
  WeChatPollingOwnerStore,
} from "./wechat-polling-owner";

type WeChatChannelAccountPatch = Partial<
  Pick<
    typeof wechatChannelAccountsTable.$inferInsert,
    | "cursor"
    | "lastErrorCode"
    | "lastHeartbeatAt"
    | "lastInboundAt"
    | "lastPollAt"
    | "runtimeStateJson"
    | "status"
    | "statusChangedAt"
    | "updatedAt"
  >
>;

async function requireWeChatChannelAccountRow(
  database: D1Database,
  input: WeChatPollingOwnerStorageKey,
): Promise<WeChatChannelAccountRow> {
  const row =
    (await getAppDatabase(database)
      .select()
      .from(wechatChannelAccountsTable)
      .where(
        and(
          eq(wechatChannelAccountsTable.id, input.bindingId),
          eq(wechatChannelAccountsTable.externalAccountId, input.accountId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("WeChat channel account not found.");
  }

  return row;
}

async function updateWeChatAccountOrThrow(
  database: D1Database,
  input: {
    bindingId: ChannelBindingId;
    externalAccountId: string;
    fields: WeChatChannelAccountPatch;
  },
): Promise<void> {
  const result = await getAppDatabase(database)
    .update(wechatChannelAccountsTable)
    .set(input.fields)
    .where(
      and(
        eq(wechatChannelAccountsTable.id, input.bindingId),
        eq(wechatChannelAccountsTable.externalAccountId, input.externalAccountId),
      ),
    )
    .run();

  if (getD1ChangeCount(result) === 0) {
    throw new Error("WeChat channel account not found.");
  }
}

function getSnapshotUpdatedAtMs(
  snapshot: WeChatPollingOwnerRuntimeStateRecord["snapshot"],
): number {
  return Math.max(
    snapshot.statusChangedAtMs,
    snapshot.lastHeartbeatAtMs ?? 0,
    snapshot.lastInboundAtMs ?? 0,
    snapshot.lastPollAtMs ?? 0,
  );
}

export function createWeChatPollingOwnerDatabaseStore(
  bindings: ApiBindings,
): WeChatPollingOwnerStore {
  return {
    async readCursor(input: WeChatPollingOwnerStorageKey): Promise<string | null> {
      const row = await requireWeChatChannelAccountRow(bindings.DB, input);
      return row.cursor;
    },
    async writeContextToken(input: WeChatPollingOwnerContextTokenRecord): Promise<void> {
      const row = await requireWeChatChannelAccountRow(bindings.DB, input);
      const database = getAppDatabase(bindings.DB);
      const existing =
        (await database
          .select({
            encryptedContextTokenSecretId: wechatContextTokensTable.encryptedContextTokenSecretId,
          })
          .from(wechatContextTokensTable)
          .where(
            and(
              eq(wechatContextTokensTable.accountId, row.id),
              eq(wechatContextTokensTable.externalAccountId, input.accountId),
              eq(wechatContextTokensTable.peerId, input.peerId),
            ),
          )
          .limit(1)
          .get()) ?? null;
      const encryptedContextTokenSecretId = await storeWeChatContextTokenSecret(bindings, {
        accountId: row.id,
        peerId: input.peerId,
        value: input.contextTokenValue,
      });

      try {
        await database
          .insert(wechatContextTokensTable)
          .values({
            accountId: row.id,
            contextTokenKey: input.contextTokenKey,
            createdAt: input.updatedAtMs,
            encryptedContextTokenSecretId,
            externalAccountId: input.accountId,
            id: createPlatformId<WeChatContextTokenId>(),
            peerId: input.peerId,
            toUserId: input.toUserId,
            updatedAt: input.updatedAtMs,
          })
          .onConflictDoUpdate({
            set: {
              contextTokenKey: input.contextTokenKey,
              encryptedContextTokenSecretId,
              toUserId: input.toUserId,
              updatedAt: input.updatedAtMs,
            },
            target: [
              wechatContextTokensTable.accountId,
              wechatContextTokensTable.externalAccountId,
              wechatContextTokensTable.peerId,
            ],
          })
          .run();
      } catch (error) {
        await deleteSecret(bindings.DB, encryptedContextTokenSecretId);
        throw error;
      }

      if (existing) {
        await deleteSecret(bindings.DB, existing.encryptedContextTokenSecretId);
      }
    },
    async writeCursor(input: WeChatPollingOwnerCursorRecord): Promise<void> {
      await updateWeChatAccountOrThrow(bindings.DB, {
        bindingId: input.bindingId,
        externalAccountId: input.accountId,
        fields: {
          cursor: input.cursor,
          updatedAt: input.updatedAtMs,
        },
      });
    },
    async writeRuntimeState(input: WeChatPollingOwnerRuntimeStateRecord): Promise<void> {
      await updateWeChatAccountOrThrow(bindings.DB, {
        bindingId: input.bindingId,
        externalAccountId: input.accountId,
        fields: {
          lastErrorCode: input.snapshot.lastErrorCode,
          lastHeartbeatAt: input.snapshot.lastHeartbeatAtMs,
          lastInboundAt: input.snapshot.lastInboundAtMs,
          lastPollAt: input.snapshot.lastPollAtMs,
          runtimeStateJson: input.runtimeStateJson,
          status: input.snapshot.status,
          statusChangedAt: input.snapshot.statusChangedAtMs,
          updatedAt: getSnapshotUpdatedAtMs(input.snapshot),
        },
      });
    },
  };
}
