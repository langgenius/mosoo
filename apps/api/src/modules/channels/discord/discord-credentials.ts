import { validationError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";

export interface DiscordChannelCredentials {
  applicationId: string;
  botToken: string;
  relaySecret: string;
}

export interface NormalizeDiscordCredentialsInput {
  applicationId: string;
  botToken: string;
  relaySecret: string;
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

  throw new Error(`Discord channel credential ${field} is required.`);
}

export function normalizeDiscordCredentials(
  input: NormalizeDiscordCredentialsInput,
): DiscordChannelCredentials {
  return {
    applicationId: normalizeRequiredString(input.applicationId, "Discord application ID"),
    botToken: normalizeRequiredString(input.botToken, "Discord bot token"),
    relaySecret: normalizeRequiredString(input.relaySecret, "Discord relay secret"),
  };
}

export function serializeDiscordCredentials(input: DiscordChannelCredentials): string {
  return JSON.stringify(input);
}

export function parseDiscordCredentials(value: string): DiscordChannelCredentials {
  const parsed: unknown = JSON.parse(value);

  if (!isRecord(parsed)) {
    throw new Error("Discord channel credentials must be a JSON object.");
  }

  return {
    applicationId: readRequiredString(parsed, "applicationId"),
    botToken: readRequiredString(parsed, "botToken"),
    relaySecret: readRequiredString(parsed, "relaySecret"),
  };
}
