import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ChannelFinalDeliveryMessage } from "../src/modules/channels/application/channel-final-delivery-message";
import { parseWeChatIlinkPollEnvelope } from "../src/modules/channels/wechat/wechat-events";
import type { WeChatIlinkPollEnvelope } from "../src/modules/channels/wechat/wechat-events";
import type {
  WeChatPollingOwnerContextTokenRecord,
  WeChatPollingOwnerCursorRecord,
  WeChatPollingOwnerRuntimeStateRecord,
  WeChatPollingOwnerStorageKey,
  WeChatPollingOwnerStore,
} from "../src/modules/channels/wechat/wechat-polling-owner";
import type { WeChatQrPairingSnapshot } from "../src/modules/channels/wechat/wechat-runtime";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { readFetchUrl } from "./helpers/fetch-request-url";
import type { ChannelFinalDeliveryQueueStub } from "./helpers/public-api-http-test-fixture";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

export const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

export function createConfirmedWeChatQrSnapshot(
  overrides: Partial<WeChatQrPairingSnapshot> = {},
): WeChatQrPairingSnapshot {
  return {
    accountId: "account-1",
    baseUrl: "https://ilinkai.weixin.qq.com",
    botToken: "bot-secret",
    expiresAtMs: 1779646800000,
    ilinkBotId: "bot-1",
    ilinkUserId: "account-1",
    lastErrorCode: null,
    qrCodeImageSrc: "base64-qr",
    qrToken: "qr-token",
    status: "confirmed",
    ...overrides,
  };
}

export function parseSuccessfulWeChatPoll(body: unknown): WeChatIlinkPollEnvelope {
  const parsed = parseWeChatIlinkPollEnvelope(JSON.stringify(body));

  if (!parsed.ok) {
    throw new Error(`Expected WeChat poll parse success, got ${parsed.code}.`);
  }

  return parsed.envelope;
}

export async function createWeChatTestBindings(): Promise<ApiBindings> {
  const database = await createPublicHttpContractDatabase();
  return createPublicHttpTestBindings(database) as ApiBindings;
}

export function readChannelFinalDeliveryQueueStub(
  bindings: ApiBindings,
): ChannelFinalDeliveryQueueStub {
  return bindings.CHANNEL_FINAL_DELIVERY_QUEUE as ChannelFinalDeliveryQueueStub;
}

export function takeQueuedChannelFinalDeliveryMessageBody(
  bindings: ApiBindings,
  jobId: string,
): ChannelFinalDeliveryMessage {
  const queue = readChannelFinalDeliveryQueueStub(bindings);
  const match = queue.sent.find((entry) => entry.body.jobId === jobId);

  if (!match) {
    throw new Error(`Expected queued message for ${jobId}.`);
  }

  return match.body;
}

export class MemoryWeChatPollingOwnerStore implements WeChatPollingOwnerStore {
  readonly contextTokens: WeChatPollingOwnerContextTokenRecord[] = [];
  readonly runtimeStates: WeChatPollingOwnerRuntimeStateRecord[] = [];
  cursor: string | null = null;

  readCursor(_input: WeChatPollingOwnerStorageKey): Promise<string | null> {
    return Promise.resolve(this.cursor);
  }

  writeContextToken(input: WeChatPollingOwnerContextTokenRecord): Promise<void> {
    this.contextTokens.push(input);
    return Promise.resolve();
  }

  writeCursor(input: WeChatPollingOwnerCursorRecord): Promise<void> {
    this.cursor = input.cursor;
    return Promise.resolve();
  }

  writeRuntimeState(input: WeChatPollingOwnerRuntimeStateRecord): Promise<void> {
    this.runtimeStates.push(input);
    return Promise.resolve();
  }
}

export interface WeChatSendRequest {
  body: string | null;
  headers: Headers;
  url: string;
}

export function installWeChatSendFetch(sendRequests: WeChatSendRequest[]): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://ilinkai.weixin.qq.com/ilink/bot/sendmessage") {
      sendRequests.push({
        body: typeof init?.body === "string" ? init.body : null,
        headers: new Headers(init?.headers),
        url: requestUrl,
      });

      return Response.json({ ret: 0 });
    }

    return Response.json({
      data: [{ id: "gpt-5.4" }],
    });
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

export async function insertCompletedWeChatAssistantReply(input: {
  bindings: ApiBindings;
  messageId: string;
  runId: string;
  seq: number;
  sessionId: string;
  text: string;
}): Promise<void> {
  await input.bindings.DB.prepare(
    "update session_run set completed_at = ?, status = 'completed', updated_at = ? where id = ?",
  )
    .bind(nowMsForTest(), nowMsForTest(), input.runId)
    .run();
  await input.bindings.DB.prepare(
    [
      "insert into session_message",
      "(id, session_id, session_run_id, seq, role, content_text, segments_json, plan_json, created_by_account_id, created_at)",
      "values (?, ?, ?, ?, 'assistant', ?, null, null, '01J00000000000000000000001', ?)",
    ].join(" "),
  )
    .bind(input.messageId, input.sessionId, input.runId, input.seq, input.text, nowMsForTest())
    .run();
  await input.bindings.DB.prepare(
    "update session set last_run_id = ?, status = 'IDLE', updated_at = ? where id = ?",
  )
    .bind(input.runId, nowMsForTest(), input.sessionId)
    .run();
}

export function createWeChatDmMessage(input: {
  contextToken?: string;
  fromUserId?: string;
  messageId?: number | string;
  text?: string;
}) {
  return {
    context_token: input.contextToken ?? "ctx-secret",
    from_user_id: input.fromUserId ?? "peer-1",
    item_list: [{ text_item: { text: input.text ?? "hello Mosoo" }, type: 1 }],
    message_id: input.messageId ?? 123,
    message_state: 2,
    message_type: 1,
    to_user_id: "bot-1",
  };
}
