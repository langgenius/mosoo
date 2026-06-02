import { validationError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";

export interface SlackChannelCredentials {
  appLevelToken: string | null;
  botToken: string;
  signingSecret: string;
  threadRepliesRequireMention: boolean;
}

export interface NormalizeSlackCredentialsInput {
  appLevelToken?: string | null;
  botToken: string;
  signingSecret: string;
  threadRepliesRequireMention?: boolean | null;
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

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return isTruthy(normalized) ? normalized : null;
}

function readRequiredString(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }

  throw new Error(`Slack channel credential ${field} is required.`);
}

function readOptionalString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

export function normalizeSlackCredentials(
  input: NormalizeSlackCredentialsInput,
): SlackChannelCredentials {
  return {
    appLevelToken: normalizeOptionalString(input.appLevelToken),
    botToken: normalizeRequiredString(input.botToken, "Slack bot token"),
    signingSecret: normalizeRequiredString(input.signingSecret, "Slack signing secret"),
    threadRepliesRequireMention: input.threadRepliesRequireMention === true,
  };
}

export function serializeSlackCredentials(input: SlackChannelCredentials): string {
  return JSON.stringify(input);
}

export function parseSlackCredentials(value: string): SlackChannelCredentials {
  const parsed: unknown = JSON.parse(value);

  if (!isRecord(parsed)) {
    throw new Error("Slack channel credentials must be a JSON object.");
  }

  return {
    appLevelToken: readOptionalString(parsed, "appLevelToken"),
    botToken: readRequiredString(parsed, "botToken"),
    signingSecret: readRequiredString(parsed, "signingSecret"),
    threadRepliesRequireMention: parsed["threadRepliesRequireMention"] === true,
  };
}
