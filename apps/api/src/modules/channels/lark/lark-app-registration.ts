import { fetchChannelWebApi } from "../channel-fetch";
import type { LarkDomain } from "./lark-events";

const FEISHU_ACCOUNTS_ORIGIN = "https://accounts.feishu.cn";
const LARK_ACCOUNTS_ORIGIN = "https://accounts.larksuite.com";
const LARK_APP_REGISTRATION_PATH = "/oauth/v1/app/registration";
const LARK_APP_REGISTRATION_TIMEOUT_MS = 10_000;

export type LarkAppRegistrationStatus =
  | "access_denied"
  | "confirmed"
  | "expired"
  | "failed"
  | "qr_pending"
  | "slow_down";

export interface LarkAppRegistrationStartResult {
  deviceCode: string;
  domain: LarkDomain;
  expireIn: number;
  interval: number;
  qrUrl: string;
  status: "qr_pending";
  userCode: string;
}

export interface LarkAppRegistrationPollResult {
  appId: string | null;
  appSecret: string | null;
  domain: LarkDomain;
  lastErrorCode: string | null;
  openId: string | null;
  status: Exclude<LarkAppRegistrationStatus, "failed"> | "failed";
}

interface LarkRegistrationInitResponse {
  supported_auth_methods?: unknown;
}

interface LarkRegistrationBeginResponse {
  device_code?: unknown;
  expire_in?: unknown;
  interval?: unknown;
  user_code?: unknown;
  verification_uri_complete?: unknown;
}

interface LarkRegistrationPollResponse {
  client_id?: unknown;
  client_secret?: unknown;
  error?: unknown;
  error_description?: unknown;
  user_info?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : null;
}

function accountsOrigin(domain: LarkDomain): string {
  return domain === "lark" ? LARK_ACCOUNTS_ORIGIN : FEISHU_ACCOUNTS_ORIGIN;
}

function registrationUrl(domain: LarkDomain): string {
  return `${accountsOrigin(domain)}${LARK_APP_REGISTRATION_PATH}`;
}

async function postRegistration(
  domain: LarkDomain,
  body: Record<string, string>,
): Promise<{
  ok: boolean;
  value: Record<string, unknown>;
}> {
  const response = await fetchChannelWebApi({
    init: {
      body: new URLSearchParams(body).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
    label: "Lark app registration",
    timeoutMs: LARK_APP_REGISTRATION_TIMEOUT_MS,
    url: registrationUrl(domain),
  });
  const parsed: unknown = await response.json();

  if (!isRecord(parsed)) {
    throw new Error("Lark app registration response must be a JSON object.");
  }

  return {
    ok: response.ok,
    value: parsed,
  };
}

function supportsClientSecret(response: LarkRegistrationInitResponse): boolean {
  return (
    Array.isArray(response.supported_auth_methods) &&
    response.supported_auth_methods.some((method) => method === "client_secret")
  );
}

function requireString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`${label} is required.`);
}

function readIntervalSeconds(response: LarkRegistrationBeginResponse): number {
  const interval = typeof response.interval === "number" ? response.interval : 5;
  return Number.isFinite(interval) && interval > 0 ? interval : 5;
}

function readExpireInSeconds(response: LarkRegistrationBeginResponse): number {
  const expireIn = typeof response.expire_in === "number" ? response.expire_in : 600;
  return Number.isFinite(expireIn) && expireIn > 0 ? expireIn : 600;
}

function buildQrUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("from", "mosoo_channel_setup");
  url.searchParams.set("tp", "ob_cli_app");
  return url.toString();
}

function readTenantBrand(response: LarkRegistrationPollResponse): LarkDomain | null {
  const tenantBrand = readString(response.user_info, "tenant_brand");

  if (tenantBrand === "feishu" || tenantBrand === "lark") {
    return tenantBrand;
  }

  return null;
}

function readOpenId(response: LarkRegistrationPollResponse): string | null {
  return readString(response.user_info, "open_id");
}

function toPollStatus(errorCode: string | null): LarkAppRegistrationPollResult["status"] {
  switch (errorCode) {
    case null:
    case "authorization_pending":
      return "qr_pending";
    case "slow_down":
      return "slow_down";
    case "access_denied":
      return "access_denied";
    case "expired_token":
    case "expired":
      return "expired";
    default:
      return "failed";
  }
}

export async function startLarkAppRegistration(
  domain: LarkDomain,
): Promise<LarkAppRegistrationStartResult> {
  const init = await postRegistration(domain, { action: "init" });

  if (!init.ok || !supportsClientSecret(init.value)) {
    throw new Error("Lark app registration does not support client_secret auth.");
  }

  const begin = await postRegistration(domain, {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });

  if (!begin.ok) {
    throw new Error("Lark app registration begin request failed.");
  }

  const body = begin.value as LarkRegistrationBeginResponse;

  return {
    deviceCode: requireString(body.device_code, "Lark app registration device code"),
    domain,
    expireIn: readExpireInSeconds(body),
    interval: readIntervalSeconds(body),
    qrUrl: buildQrUrl(requireString(body.verification_uri_complete, "Lark app registration URL")),
    status: "qr_pending",
    userCode: requireString(body.user_code, "Lark app registration user code"),
  };
}

export async function pollLarkAppRegistration(input: {
  deviceCode: string;
  domain: LarkDomain;
}): Promise<LarkAppRegistrationPollResult> {
  const deviceCode = input.deviceCode.trim();

  if (!deviceCode) {
    throw new Error("Lark app registration device code is required.");
  }

  const poll = await postRegistration(input.domain, {
    action: "poll",
    device_code: deviceCode,
    tp: "ob_app",
  });
  const body = poll.value as LarkRegistrationPollResponse;
  const tenantBrand = readTenantBrand(body);

  if (tenantBrand === "lark" && input.domain !== "lark") {
    return pollLarkAppRegistration({
      deviceCode,
      domain: "lark",
    });
  }

  const appId = typeof body.client_id === "string" ? body.client_id.trim() : "";
  const appSecret = typeof body.client_secret === "string" ? body.client_secret.trim() : "";

  if (appId && appSecret) {
    return {
      appId,
      appSecret,
      domain: tenantBrand ?? input.domain,
      lastErrorCode: null,
      openId: readOpenId(body),
      status: "confirmed",
    };
  }

  const errorCode =
    typeof body.error === "string" && body.error.trim().length > 0 ? body.error.trim() : null;
  const status = toPollStatus(errorCode);
  // RFC 8628 device-flow polling reuses the `error` field for non-terminal
  // signals (`authorization_pending`, `slow_down`). Only persist `lastErrorCode`
  // when the status is actually a terminal failure — otherwise the UI surfaces
  // a normal "still waiting" tick as a red error.
  const isTerminalFailure =
    status === "access_denied" || status === "expired" || status === "failed";

  return {
    appId: null,
    appSecret: null,
    domain: tenantBrand ?? input.domain,
    lastErrorCode: isTerminalFailure
      ? (errorCode ?? readString(body, "error_description") ?? "app_registration_failed")
      : null,
    openId: readOpenId(body),
    status,
  };
}
