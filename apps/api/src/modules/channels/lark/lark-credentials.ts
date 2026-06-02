import { API_ERROR_CODE, validationError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import type { LarkDomain } from "./lark-events";

export type LarkConnectionMode = "webhook" | "websocket";

export interface LarkChannelCredentials {
  appId: string;
  appSecret: string;
  connectionMode: LarkConnectionMode;
  domain: LarkDomain;
  encryptKey: string | null;
  verificationToken: string | null;
}

export interface NormalizeLarkCredentialsInput {
  appId: string;
  appSecret: string;
  connectionMode: LarkConnectionMode;
  domain: LarkDomain;
  encryptKey: string | null;
  verificationToken: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRequiredString(value: string, label: string): string {
  const normalized = value.trim();

  if (!isTruthy(normalized)) {
    throw validationError(`${label} is required.`);
  }

  return normalized;
}

function normalizeOptionalString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRequiredString(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }

  throw new Error(`Lark channel credential ${field} is required.`);
}

function readOptionalString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }

  return null;
}

function readConnectionMode(value: Record<string, unknown>): LarkConnectionMode {
  const candidate = value["connectionMode"];

  if (candidate === "websocket" || candidate === "webhook") {
    return candidate;
  }

  throw new Error("Lark channel credential connectionMode must be websocket or webhook.");
}

function normalizeLarkDomainValue(value: unknown): LarkDomain {
  if (value === "feishu" || value === "lark") {
    return value;
  }

  throw validationError("Lark domain must be lark or feishu.", "LARK_DOMAIN_INVALID");
}

function normalizeConnectionModeValue(value: unknown): LarkConnectionMode {
  if (value === "webhook") {
    return value;
  }

  if (value === "websocket") {
    throw validationError(
      "Lark WebSocket mode is disabled until the sidecar path is end-to-end ready. Use webhook mode.",
      API_ERROR_CODE.larkConnectionModeInvalid,
    );
  }

  throw validationError(
    "Lark connection mode must be websocket or webhook.",
    "LARK_CONNECTION_MODE_INVALID",
  );
}

export function normalizeLarkCredentials(
  input: NormalizeLarkCredentialsInput,
): LarkChannelCredentials {
  const connectionMode = normalizeConnectionModeValue(input.connectionMode);
  const appId = normalizeRequiredString(input.appId, "Lark app id");
  const appSecret = normalizeRequiredString(input.appSecret, "Lark app secret");
  const domain = normalizeLarkDomainValue(input.domain);

  if (connectionMode === "websocket") {
    return {
      appId,
      appSecret,
      connectionMode,
      domain,
      encryptKey: normalizeOptionalString(input.encryptKey),
      verificationToken: normalizeOptionalString(input.verificationToken),
    };
  }

  return {
    appId,
    appSecret,
    connectionMode,
    domain,
    encryptKey: normalizeRequiredString(input.encryptKey ?? "", "Lark encrypt key"),
    verificationToken: normalizeRequiredString(
      input.verificationToken ?? "",
      "Lark verification token",
    ),
  };
}

export function serializeLarkCredentials(input: LarkChannelCredentials): string {
  return JSON.stringify(input);
}

export function parseLarkCredentials(value: string): LarkChannelCredentials {
  const parsed: unknown = JSON.parse(value);

  if (!isRecord(parsed)) {
    throw new Error("Lark channel credentials must be a JSON object.");
  }

  const connectionMode = readConnectionMode(parsed);

  return {
    appId: readRequiredString(parsed, "appId"),
    appSecret: readRequiredString(parsed, "appSecret"),
    connectionMode,
    domain: normalizeLarkDomainValue(readRequiredString(parsed, "domain")),
    encryptKey:
      connectionMode === "webhook"
        ? readRequiredString(parsed, "encryptKey")
        : readOptionalString(parsed, "encryptKey"),
    verificationToken:
      connectionMode === "webhook"
        ? readRequiredString(parsed, "verificationToken")
        : readOptionalString(parsed, "verificationToken"),
  };
}
