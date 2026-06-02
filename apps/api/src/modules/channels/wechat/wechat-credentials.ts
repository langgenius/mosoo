import { isTruthy } from "../../../shared/truthiness";
import { normalizeWeChatIlinkBaseUrl } from "./wechat-ilink-base-url";
import type { WeChatQrPairingSnapshot } from "./wechat-runtime";

export interface WeChatChannelCredentials {
  baseUrl: string;
  botToken: string;
  ilinkBotId: string;
  ilinkUserId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];

  if (typeof candidate === "string" && isTruthy(candidate.trim())) {
    return candidate.trim();
  }

  throw new Error(`WeChat credentials ${field} is required.`);
}

function normalizeRequiredString(value: string | null | undefined, field: string): string {
  const normalized = value?.trim() ?? "";

  if (!isTruthy(normalized)) {
    throw new Error(`WeChat credentials ${field} is required.`);
  }

  return normalized;
}

function normalizeWeChatChannelCredentials(input: {
  baseUrl: string | null | undefined;
  botToken: string | null | undefined;
  ilinkBotId: string | null | undefined;
  ilinkUserId: string | null | undefined;
}): WeChatChannelCredentials {
  return {
    baseUrl: normalizeWeChatIlinkBaseUrl(normalizeRequiredString(input.baseUrl, "baseUrl")),
    botToken: normalizeRequiredString(input.botToken, "botToken"),
    ilinkBotId: normalizeRequiredString(input.ilinkBotId, "ilinkBotId"),
    ilinkUserId: normalizeRequiredString(input.ilinkUserId, "ilinkUserId"),
  };
}

export function normalizeWeChatChannelCredentialsFromSnapshot(
  snapshot: WeChatQrPairingSnapshot,
): WeChatChannelCredentials {
  if (snapshot.status !== "confirmed") {
    throw new Error("WeChat QR pairing must be confirmed before credentials can be persisted.");
  }

  return normalizeWeChatChannelCredentials({
    baseUrl: snapshot.baseUrl,
    botToken: snapshot.botToken,
    ilinkBotId: snapshot.ilinkBotId,
    ilinkUserId: snapshot.ilinkUserId,
  });
}

export function serializeWeChatChannelCredentials(credentials: WeChatChannelCredentials): string {
  return JSON.stringify(credentials);
}

export function parseWeChatChannelCredentials(value: string): WeChatChannelCredentials {
  const parsed: unknown = JSON.parse(value);

  if (!isRecord(parsed)) {
    throw new Error("WeChat credentials must be a JSON object.");
  }

  return normalizeWeChatChannelCredentials({
    baseUrl: readRequiredString(parsed, "baseUrl"),
    botToken: readRequiredString(parsed, "botToken"),
    ilinkBotId: readRequiredString(parsed, "ilinkBotId"),
    ilinkUserId: readRequiredString(parsed, "ilinkUserId"),
  });
}
