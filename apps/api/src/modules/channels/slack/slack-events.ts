import { isTruthy } from "../../../shared/truthiness";
export interface SlackUrlVerificationEnvelope {
  challenge: string;
  type: "url_verification";
}

export interface SlackEventCallbackEnvelope {
  botUserId: string | null;
  enterpriseId: string | null;
  event: Record<string, unknown>;
  eventId: string;
  isEnterpriseInstall: boolean;
  teamId: string | null;
  type: "event_callback";
}

export type SlackEventsEnvelope = SlackEventCallbackEnvelope | SlackUrlVerificationEnvelope;

export interface SlackWorkTrigger {
  botUserId: string | null;
  channelId: string;
  enterpriseId: string | null;
  eventId: string;
  isEnterpriseInstall: boolean;
  messageTs: string;
  requiresExistingSession: boolean;
  teamId: string | null;
  text: string;
  threadTs: string;
  triggerType: "app_mention" | "channel_thread_message" | "dm_message";
  userId: string;
}

export interface SlackEventsParseFailure {
  code:
    | "invalid_json"
    | "missing_challenge"
    | "missing_event"
    | "missing_event_id"
    | "unsupported_type";
  message: string;
  ok: false;
}

export interface SlackEventsParseSuccess {
  envelope: SlackEventsEnvelope;
  ok: true;
}

export type SlackEventsParseResult = SlackEventsParseFailure | SlackEventsParseSuccess;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];

  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function readText(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];

  return typeof candidate === "string" ? candidate : "";
}

function readOptionalString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];

  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function readBotUserId(parsed: Record<string, unknown>): string | null {
  const authorizations = parsed["authorizations"];

  if (!Array.isArray(authorizations)) {
    return null;
  }

  for (const authorization of authorizations) {
    if (isRecord(authorization)) {
      const userId = readOptionalString(authorization, "user_id");

      if (isTruthy(userId)) {
        return userId;
      }
    }
  }

  return null;
}

function stripLeadingBotMentions(text: string): string {
  return text.replace(/^(?:<@[A-Z0-9-]+>\s*)+/u, "").trim();
}

function containsBotMention(text: string, botUserId: string | null): boolean {
  return isTruthy(botUserId) && text.includes(`<@${botUserId}>`);
}

export function parseSlackEventsEnvelope(body: string): SlackEventsParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      code: "invalid_json",
      message: "Slack request body must be valid JSON.",
      ok: false,
    };
  }

  if (!isRecord(parsed)) {
    return {
      code: "invalid_json",
      message: "Slack request body must be a JSON object.",
      ok: false,
    };
  }

  if (parsed["type"] === "url_verification") {
    const challenge = readString(parsed, "challenge");

    if (!isTruthy(challenge)) {
      return {
        code: "missing_challenge",
        message: "Slack url_verification challenge is required.",
        ok: false,
      };
    }

    return {
      envelope: {
        challenge,
        type: "url_verification",
      },
      ok: true,
    };
  }

  if (parsed["type"] !== "event_callback") {
    return {
      code: "unsupported_type",
      message: "Slack request type is not supported by this adapter spike.",
      ok: false,
    };
  }

  const { event } = parsed;
  const eventId = readString(parsed, "event_id");

  if (!isRecord(event)) {
    return {
      code: "missing_event",
      message: "Slack event_callback requires event.",
      ok: false,
    };
  }

  if (!isTruthy(eventId)) {
    return {
      code: "missing_event_id",
      message: "Slack event_callback requires event_id.",
      ok: false,
    };
  }

  return {
    envelope: {
      botUserId: readBotUserId(parsed),
      enterpriseId: readOptionalString(parsed, "enterprise_id"),
      event,
      eventId,
      isEnterpriseInstall: parsed["is_enterprise_install"] === true,
      teamId: readOptionalString(parsed, "team_id"),
      type: "event_callback",
    },
    ok: true,
  };
}

export function normalizeSlackWorkTrigger(
  envelope: SlackEventCallbackEnvelope,
): SlackWorkTrigger | null {
  const eventType = readString(envelope.event, "type");
  const channelId = readString(envelope.event, "channel");
  const messageTs = readString(envelope.event, "ts");
  const userId = readString(envelope.event, "user");
  const text = readText(envelope.event, "text");

  if (!isTruthy(channelId) || !isTruthy(messageTs) || !isTruthy(userId)) {
    return null;
  }

  if (
    (readOptionalString(envelope.event, "bot_id") !== null &&
      readOptionalString(envelope.event, "bot_id") !== undefined &&
      readOptionalString(envelope.event, "bot_id") !== "") ||
    (readOptionalString(envelope.event, "subtype") !== null &&
      readOptionalString(envelope.event, "subtype") !== undefined &&
      readOptionalString(envelope.event, "subtype") !== "")
  ) {
    return null;
  }

  const threadTs = readOptionalString(envelope.event, "thread_ts") ?? messageTs;

  if (eventType === "app_mention") {
    return {
      botUserId: envelope.botUserId,
      channelId,
      enterpriseId: envelope.enterpriseId,
      eventId: envelope.eventId,
      isEnterpriseInstall: envelope.isEnterpriseInstall,
      messageTs,
      requiresExistingSession: false,
      teamId: envelope.teamId,
      text: stripLeadingBotMentions(text),
      threadTs,
      triggerType: "app_mention",
      userId,
    };
  }

  if (eventType === "message" && readOptionalString(envelope.event, "channel_type") === "im") {
    return {
      botUserId: envelope.botUserId,
      channelId,
      enterpriseId: envelope.enterpriseId,
      eventId: envelope.eventId,
      isEnterpriseInstall: envelope.isEnterpriseInstall,
      messageTs,
      requiresExistingSession: false,
      teamId: envelope.teamId,
      text: text.trim(),
      threadTs,
      triggerType: "dm_message",
      userId,
    };
  }

  if (
    eventType === "message" &&
    threadTs !== messageTs &&
    !containsBotMention(text, envelope.botUserId)
  ) {
    return {
      botUserId: envelope.botUserId,
      channelId,
      enterpriseId: envelope.enterpriseId,
      eventId: envelope.eventId,
      isEnterpriseInstall: envelope.isEnterpriseInstall,
      messageTs,
      requiresExistingSession: true,
      teamId: envelope.teamId,
      text: text.trim(),
      threadTs,
      triggerType: "channel_thread_message",
      userId,
    };
  }

  return null;
}
