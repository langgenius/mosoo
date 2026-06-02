import { vaultSecretsTable, wechatChannelAccountsTable, wechatContextTokensTable } from "@mosoo/db";
import type { ChannelBindingId, PlatformId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { readSecretOutcome, storeSecret } from "../../mcp/application/mcp-secret-store";

export type WeChatContextTokenSecretReadPurpose = "wechat_reply";

interface WeChatContextTokenSecretOwner {
  readonly accountId: ChannelBindingId;
  readonly peerId: string;
}

function toWeChatContextTokenSecretKind(owner: WeChatContextTokenSecretOwner): string {
  return `wechat_context_token:${owner.accountId}:${owner.peerId}`;
}

export async function storeWeChatContextTokenSecret(
  bindings: ApiBindings,
  input: WeChatContextTokenSecretOwner & {
    readonly value: string;
  },
): Promise<PlatformId> {
  return storeSecret(bindings.DB, bindings, {
    kind: toWeChatContextTokenSecretKind(input),
    value: input.value,
  });
}

export async function readWeChatContextTokenSecret(
  bindings: ApiBindings,
  input: WeChatContextTokenSecretOwner & {
    readonly externalAccountId: string;
    readonly purpose: WeChatContextTokenSecretReadPurpose;
    readonly secretId: PlatformId;
  },
): Promise<string> {
  if (input.purpose !== "wechat_reply") {
    throw validationError("WeChat context token purpose is invalid.");
  }

  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        secretKind: vaultSecretsTable.kind,
      })
      .from(wechatContextTokensTable)
      .innerJoin(
        wechatChannelAccountsTable,
        eq(wechatChannelAccountsTable.id, wechatContextTokensTable.accountId),
      )
      .innerJoin(
        vaultSecretsTable,
        eq(vaultSecretsTable.id, wechatContextTokensTable.encryptedContextTokenSecretId),
      )
      .where(
        and(
          eq(wechatContextTokensTable.accountId, input.accountId),
          eq(wechatContextTokensTable.externalAccountId, input.externalAccountId),
          eq(wechatContextTokensTable.peerId, input.peerId),
          eq(wechatContextTokensTable.encryptedContextTokenSecretId, input.secretId),
          eq(wechatChannelAccountsTable.externalAccountId, input.externalAccountId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row || row.secretKind !== toWeChatContextTokenSecretKind(input)) {
    throw validationError("WeChat context token is unavailable.");
  }

  const secret = await readSecretOutcome(bindings.DB, bindings, input.secretId);

  if (secret.status === "missing") {
    throw validationError("WeChat context token is unavailable.");
  }

  return secret.value;
}
