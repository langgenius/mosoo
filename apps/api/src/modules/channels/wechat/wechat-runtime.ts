import type { ChannelBindingId } from "@mosoo/id";

import { normalizeWeChatIlinkBaseUrl } from "./wechat-ilink-base-url";

export type WeChatQrPairingStatus =
  | "confirmed"
  | "expired"
  | "failed"
  | "idle"
  | "qr_pending"
  | "scanned";

export interface WeChatQrPairingSnapshot {
  accountId: string | null;
  baseUrl: string | null;
  botToken: string | null;
  expiresAtMs: number | null;
  ilinkBotId: string | null;
  ilinkUserId: string | null;
  lastErrorCode: string | null;
  qrCodeImageSrc: string | null;
  qrToken: string | null;
  status: WeChatQrPairingStatus;
}

export interface WeChatIlinkQrStatusResponse {
  baseurl?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  status: "confirmed" | "expired" | "scaned" | "wait";
}

export interface WeChatContextTokenStoreKeyInput {
  accountId: string;
  bindingId: ChannelBindingId;
  peerId: string;
}

export interface WeChatReplyRoute {
  contextTokenKey: string;
  contextTokenValue: string;
  toUserId: string;
}

function normalizeOptionalString(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function createWeChatContextTokenStoreKey(input: WeChatContextTokenStoreKeyInput): string {
  assertNonEmpty(input.bindingId, "WeChat binding id");
  assertNonEmpty(input.accountId, "WeChat account id");
  assertNonEmpty(input.peerId, "WeChat peer id");

  return [
    "wechat",
    encodeKeyPart(input.bindingId),
    encodeKeyPart(input.accountId),
    encodeKeyPart(input.peerId),
  ].join(":");
}

export function applyWeChatQrStatusResponse(
  current: WeChatQrPairingSnapshot,
  response: WeChatIlinkQrStatusResponse,
): WeChatQrPairingSnapshot {
  switch (response.status) {
    case "wait":
      return {
        ...current,
        lastErrorCode: null,
        status: "qr_pending",
      };
    case "scaned":
      return {
        ...current,
        lastErrorCode: null,
        status: "scanned",
      };
    case "expired":
      return {
        ...current,
        lastErrorCode: "qr_expired",
        status: "expired",
      };
    case "confirmed": {
      const baseUrlValue = normalizeOptionalString(response.baseurl);
      const botToken = normalizeOptionalString(response.bot_token);
      const ilinkBotId = normalizeOptionalString(response.ilink_bot_id);
      const ilinkUserId = normalizeOptionalString(response.ilink_user_id);

      if (!baseUrlValue || !botToken || !ilinkBotId || !ilinkUserId) {
        return {
          ...current,
          lastErrorCode: "confirmed_missing_credentials",
          status: "failed",
        };
      }

      let baseUrl: string;

      try {
        baseUrl = normalizeWeChatIlinkBaseUrl(baseUrlValue);
      } catch {
        return {
          ...current,
          lastErrorCode: "confirmed_untrusted_base_url",
          status: "failed",
        };
      }

      return {
        ...current,
        accountId: ilinkUserId,
        baseUrl,
        botToken,
        ilinkBotId,
        ilinkUserId,
        lastErrorCode: null,
        status: "confirmed",
      };
    }
  }
}

export function createWeChatReplyRoute(input: {
  accountId: string;
  bindingId: ChannelBindingId;
  contextToken: string;
  peerId: string;
}): WeChatReplyRoute {
  assertNonEmpty(input.contextToken, "WeChat context token");

  return {
    contextTokenKey: createWeChatContextTokenStoreKey({
      accountId: input.accountId,
      bindingId: input.bindingId,
      peerId: input.peerId,
    }),
    contextTokenValue: input.contextToken,
    toUserId: input.peerId,
  };
}
