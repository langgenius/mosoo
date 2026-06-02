import { validationError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";

export interface TelegramChannelCredentials {
  botToken: string;
  webhookSecret: string;
}

export interface NormalizeTelegramCredentialsInput {
  botToken: string;
  webhookSecret: string;
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

function readRequiredString(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }

  throw new Error(`Telegram channel credential ${field} is required.`);
}

export function normalizeTelegramCredentials(
  input: NormalizeTelegramCredentialsInput,
): TelegramChannelCredentials {
  return {
    botToken: normalizeRequiredString(input.botToken, "Telegram bot token"),
    webhookSecret: normalizeRequiredString(input.webhookSecret, "Telegram webhook secret"),
  };
}

export function serializeTelegramCredentials(input: TelegramChannelCredentials): string {
  return JSON.stringify(input);
}

export function parseTelegramCredentials(value: string): TelegramChannelCredentials {
  const parsed: unknown = JSON.parse(value);

  if (!isRecord(parsed)) {
    throw new Error("Telegram channel credentials must be a JSON object.");
  }

  return {
    botToken: readRequiredString(parsed, "botToken"),
    webhookSecret: readRequiredString(parsed, "webhookSecret"),
  };
}
