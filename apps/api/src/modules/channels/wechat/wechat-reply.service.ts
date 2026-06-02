import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { ChannelBindingId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { WeChatIlinkClient } from "./wechat-ilink-client";
import {
  readWeChatChannelAccountWithCredentials,
  readWeChatContextTokenForPeer,
} from "./wechat-runtime-store";
import type { WeChatChannelAccount } from "./wechat-runtime-store";

export interface SendWeChatStoredContextReplyInput {
  accountId: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
  peerId: string;
  text: string;
}

export type WeChatReplyErrorCode =
  | "account_not_found"
  | "account_not_running"
  | "context_token_not_found";

export class WeChatReplyError extends Error {
  readonly code: WeChatReplyErrorCode;

  constructor(code: WeChatReplyErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "WeChatReplyError";
  }
}

function createWeChatReplyClientId(): string {
  return `mosoo-wechat-${createPlatformId()}`;
}

// Replies are outbound (sendmessage) and only need valid credentials; they must NOT be gated
// on the polling (getUpdates, inbound) runtime status. Transient polling states like `starting`
// / `reconnecting` churn rapidly — especially under a fast scheduled-pump cadence — and a strict
// `status === "running"` check made them surface as spurious `account_not_running` retries that
// delayed reply delivery. Block only states where credentials are genuinely unusable
// (`relogin_required`) or the channel was stopped (`stopped`).
function ensureWeChatAccountCanSendReply(account: WeChatChannelAccount): void {
  if (account.status === "relogin_required" || account.status === "stopped") {
    throw new WeChatReplyError(
      "account_not_running",
      `WeChat channel account is "${account.status}"; cannot send reply until it recovers.`,
    );
  }
}

export async function sendWeChatStoredContextReply(
  bindings: ApiBindings,
  input: SendWeChatStoredContextReplyInput,
): Promise<void> {
  const accountId = parsePlatformId<ChannelBindingId>(input.accountId, "WeChat account ID");
  const account = await readWeChatChannelAccountWithCredentials(bindings, {
    accountId,
  });

  if (!account) {
    throw new WeChatReplyError("account_not_found", "WeChat channel account not found.");
  }

  ensureWeChatAccountCanSendReply(account.account);

  const contextToken = await readWeChatContextTokenForPeer(bindings, {
    accountId,
    peerId: input.peerId,
  });

  if (!contextToken) {
    throw new WeChatReplyError("context_token_not_found", "WeChat context token not found.");
  }

  const client = new WeChatIlinkClient({
    baseUrl: account.credentials.baseUrl,
    botToken: account.credentials.botToken,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });

  await client.sendText({
    clientId: input.clientId?.trim() || createWeChatReplyClientId(),
    contextToken: contextToken.contextToken,
    text: input.text,
    toUserId: contextToken.toUserId,
  });
}
