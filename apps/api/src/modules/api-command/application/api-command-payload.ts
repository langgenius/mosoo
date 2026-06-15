import type { ApiCommandKind } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  ChannelBindingId,
  FileId,
  AppId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { DiscordWorkTrigger } from "../../channels/discord/discord-events";
import type { LarkWorkTrigger } from "../../channels/lark/lark-events";
import type { SlackWorkTrigger } from "../../channels/slack/slack-events";
import type { TelegramWorkTrigger } from "../../channels/telegram/telegram-events";

type ApiCommandPayload =
  | ChannelWorkTriggerCommandPayload
  | ScheduledMaintenanceCommandPayload
  | SessionRunDispatchCommandPayload;

type JsonRecord = Record<string, unknown>;

export type ChannelWorkTriggerProvider = "discord" | "lark" | "slack" | "telegram";

export type ChannelWorkTriggerCommandPayload =
  | {
      bindingId: ChannelBindingId;
      provider: "discord";
      requestUrl: string;
      trigger: DiscordWorkTrigger;
    }
  | {
      bindingId: ChannelBindingId;
      provider: "lark";
      requestUrl: string;
      trigger: LarkWorkTrigger;
    }
  | {
      bindingId: ChannelBindingId;
      provider: "slack";
      requestUrl: string;
      trigger: SlackWorkTrigger;
    }
  | {
      bindingId: ChannelBindingId;
      provider: "telegram";
      requestUrl: string;
      trigger: TelegramWorkTrigger;
    };

export interface ScheduledMaintenanceCommandPayload {
  scheduledTime: number;
}

export interface SessionRunDispatchCommandPayload {
  accessViewer?: AuthenticatedViewer;
  attachmentIds: FileId[];
  prompt: string;
  queuedAtMs: number;
  requestUrl: string;
  session: {
    id: SessionId;
    app_id: AppId;
  };
  sessionRunId: SessionRunId;
  traceId: string;
  viewer: AuthenticatedViewer;
}

export class ApiCommandPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiCommandPayloadError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new ApiCommandPayloadError(`${label} must be an object.`);
  }

  return value;
}

function readString(record: JsonRecord, field: string, label: string): string {
  const value = record[field];

  if (typeof value !== "string") {
    throw new ApiCommandPayloadError(`${label}.${field} must be a string.`);
  }

  return value;
}

function readNonEmptyString(record: JsonRecord, field: string, label: string): string {
  const value = readString(record, field, label);

  if (value.trim().length === 0) {
    throw new ApiCommandPayloadError(`${label}.${field} must not be empty.`);
  }

  return value;
}

function readOptionalString(record: JsonRecord, field: string, label: string): string | null {
  const value = record[field];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiCommandPayloadError(`${label}.${field} must be a string or null.`);
  }

  return value;
}

function readBoolean(record: JsonRecord, field: string, label: string): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw new ApiCommandPayloadError(`${label}.${field} must be a boolean.`);
  }

  return value;
}

function readInteger(record: JsonRecord, field: string, label: string): number {
  const value = record[field];

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ApiCommandPayloadError(`${label}.${field} must be an integer.`);
  }

  return value;
}

function readOptionalInteger(record: JsonRecord, field: string, label: string): number | null {
  const value = record[field];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ApiCommandPayloadError(`${label}.${field} must be an integer or null.`);
  }

  return value;
}

function readStringArray(record: JsonRecord, field: string, label: string): string[] {
  const value = record[field];

  if (!Array.isArray(value)) {
    throw new ApiCommandPayloadError(`${label}.${field} must be an array.`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new ApiCommandPayloadError(`${label}.${field}[${index}] must be a string.`);
    }

    return item;
  });
}

function readViewer(value: unknown, label: string): AuthenticatedViewer {
  const record = requireRecord(value, label);
  return {
    email: readNonEmptyString(record, "email", label),
    emailVerified: readBoolean(record, "emailVerified", label),
    id: parsePlatformId<AccountId>(record["id"], `${label}.id`),
    imageUrl: readOptionalString(record, "imageUrl", label),
    name: readString(record, "name", label),
  };
}

function parseSessionRunDispatchPayload(value: unknown): SessionRunDispatchCommandPayload {
  const record = requireRecord(value, "session_run_dispatch payload");
  const session = requireRecord(record["session"], "session_run_dispatch payload.session");
  const accessViewer = record["accessViewer"];

  return {
    ...(accessViewer === undefined
      ? {}
      : { accessViewer: readViewer(accessViewer, "session_run_dispatch payload.accessViewer") }),
    attachmentIds: readStringArray(record, "attachmentIds", "session_run_dispatch payload").map(
      (id, index) => parsePlatformId<FileId>(id, `attachmentIds[${index}]`),
    ),
    prompt: readString(record, "prompt", "session_run_dispatch payload"),
    queuedAtMs: readInteger(record, "queuedAtMs", "session_run_dispatch payload"),
    requestUrl: readNonEmptyString(record, "requestUrl", "session_run_dispatch payload"),
    session: {
      id: parsePlatformId<SessionId>(session["id"], "session_run_dispatch payload.session.id"),
      app_id: parsePlatformId<AppId>(
        session["app_id"],
        "session_run_dispatch payload.session.app_id",
      ),
    },
    sessionRunId: parsePlatformId<SessionRunId>(
      record["sessionRunId"],
      "session_run_dispatch payload.sessionRunId",
    ),
    traceId: readNonEmptyString(record, "traceId", "session_run_dispatch payload"),
    viewer: readViewer(record["viewer"], "session_run_dispatch payload.viewer"),
  };
}

function readSlackTrigger(value: unknown): SlackWorkTrigger {
  const record = requireRecord(value, "channel_work_trigger payload.trigger");
  const triggerType = readNonEmptyString(
    record,
    "triggerType",
    "channel_work_trigger payload.trigger",
  );

  if (
    triggerType !== "app_mention" &&
    triggerType !== "channel_thread_message" &&
    triggerType !== "dm_message"
  ) {
    throw new ApiCommandPayloadError(
      "channel_work_trigger payload.trigger.triggerType is invalid.",
    );
  }

  return {
    botUserId: readOptionalString(record, "botUserId", "channel_work_trigger payload.trigger"),
    channelId: readNonEmptyString(record, "channelId", "channel_work_trigger payload.trigger"),
    enterpriseId: readOptionalString(
      record,
      "enterpriseId",
      "channel_work_trigger payload.trigger",
    ),
    eventId: readNonEmptyString(record, "eventId", "channel_work_trigger payload.trigger"),
    isEnterpriseInstall: readBoolean(
      record,
      "isEnterpriseInstall",
      "channel_work_trigger payload.trigger",
    ),
    messageTs: readNonEmptyString(record, "messageTs", "channel_work_trigger payload.trigger"),
    requiresExistingSession: readBoolean(
      record,
      "requiresExistingSession",
      "channel_work_trigger payload.trigger",
    ),
    teamId: readOptionalString(record, "teamId", "channel_work_trigger payload.trigger"),
    text: readString(record, "text", "channel_work_trigger payload.trigger"),
    threadTs: readNonEmptyString(record, "threadTs", "channel_work_trigger payload.trigger"),
    triggerType,
    userId: readNonEmptyString(record, "userId", "channel_work_trigger payload.trigger"),
  };
}

function readTelegramTrigger(value: unknown): TelegramWorkTrigger {
  const record = requireRecord(value, "channel_work_trigger payload.trigger");

  return {
    chatId: readNonEmptyString(record, "chatId", "channel_work_trigger payload.trigger"),
    chatTitle: readOptionalString(record, "chatTitle", "channel_work_trigger payload.trigger"),
    chatType: readOptionalString(record, "chatType", "channel_work_trigger payload.trigger"),
    eventId: readNonEmptyString(record, "eventId", "channel_work_trigger payload.trigger"),
    externalActorId: readNonEmptyString(
      record,
      "externalActorId",
      "channel_work_trigger payload.trigger",
    ),
    externalMessageId: readNonEmptyString(
      record,
      "externalMessageId",
      "channel_work_trigger payload.trigger",
    ),
    externalThreadId: readNonEmptyString(
      record,
      "externalThreadId",
      "channel_work_trigger payload.trigger",
    ),
    messageId: readInteger(record, "messageId", "channel_work_trigger payload.trigger"),
    messageThreadId: readOptionalInteger(
      record,
      "messageThreadId",
      "channel_work_trigger payload.trigger",
    ),
    text: readNonEmptyString(record, "text", "channel_work_trigger payload.trigger"),
    userDisplayName: readOptionalString(
      record,
      "userDisplayName",
      "channel_work_trigger payload.trigger",
    ),
    userId: readOptionalString(record, "userId", "channel_work_trigger payload.trigger"),
    username: readOptionalString(record, "username", "channel_work_trigger payload.trigger"),
  };
}

function readDiscordTrigger(value: unknown): DiscordWorkTrigger {
  const record = requireRecord(value, "channel_work_trigger payload.trigger");

  return {
    authorDisplayName: readOptionalString(
      record,
      "authorDisplayName",
      "channel_work_trigger payload.trigger",
    ),
    authorId: readNonEmptyString(record, "authorId", "channel_work_trigger payload.trigger"),
    channelId: readNonEmptyString(record, "channelId", "channel_work_trigger payload.trigger"),
    channelType: readOptionalInteger(record, "channelType", "channel_work_trigger payload.trigger"),
    eventId: readNonEmptyString(record, "eventId", "channel_work_trigger payload.trigger"),
    externalActorId: readNonEmptyString(
      record,
      "externalActorId",
      "channel_work_trigger payload.trigger",
    ),
    externalMessageId: readNonEmptyString(
      record,
      "externalMessageId",
      "channel_work_trigger payload.trigger",
    ),
    externalThreadId: readNonEmptyString(
      record,
      "externalThreadId",
      "channel_work_trigger payload.trigger",
    ),
    guildId: readOptionalString(record, "guildId", "channel_work_trigger payload.trigger"),
    messageId: readNonEmptyString(record, "messageId", "channel_work_trigger payload.trigger"),
    text: readNonEmptyString(record, "text", "channel_work_trigger payload.trigger"),
  };
}

function readLarkTrigger(value: unknown): LarkWorkTrigger {
  const record = requireRecord(value, "channel_work_trigger payload.trigger");

  return {
    chatId: readNonEmptyString(record, "chatId", "channel_work_trigger payload.trigger"),
    chatType: readOptionalString(record, "chatType", "channel_work_trigger payload.trigger"),
    eventId: readNonEmptyString(record, "eventId", "channel_work_trigger payload.trigger"),
    externalActorId: readNonEmptyString(
      record,
      "externalActorId",
      "channel_work_trigger payload.trigger",
    ),
    externalMessageId: readNonEmptyString(
      record,
      "externalMessageId",
      "channel_work_trigger payload.trigger",
    ),
    externalThreadId: readNonEmptyString(
      record,
      "externalThreadId",
      "channel_work_trigger payload.trigger",
    ),
    messageId: readNonEmptyString(record, "messageId", "channel_work_trigger payload.trigger"),
    parentId: readOptionalString(record, "parentId", "channel_work_trigger payload.trigger"),
    rootId: readOptionalString(record, "rootId", "channel_work_trigger payload.trigger"),
    senderOpenId: readNonEmptyString(
      record,
      "senderOpenId",
      "channel_work_trigger payload.trigger",
    ),
    senderType: readNonEmptyString(record, "senderType", "channel_work_trigger payload.trigger"),
    senderUnionId: readOptionalString(
      record,
      "senderUnionId",
      "channel_work_trigger payload.trigger",
    ),
    senderUserId: readOptionalString(
      record,
      "senderUserId",
      "channel_work_trigger payload.trigger",
    ),
    tenantKey: readNonEmptyString(record, "tenantKey", "channel_work_trigger payload.trigger"),
    text: readString(record, "text", "channel_work_trigger payload.trigger"),
  };
}

function readProvider(record: JsonRecord): ChannelWorkTriggerProvider {
  const provider = readNonEmptyString(record, "provider", "channel_work_trigger payload");

  if (
    provider !== "discord" &&
    provider !== "lark" &&
    provider !== "slack" &&
    provider !== "telegram"
  ) {
    throw new ApiCommandPayloadError("channel_work_trigger payload.provider is invalid.");
  }

  return provider;
}

function parseChannelWorkTriggerPayload(value: unknown): ChannelWorkTriggerCommandPayload {
  const record = requireRecord(value, "channel_work_trigger payload");
  const provider = readProvider(record);
  const base = {
    bindingId: parsePlatformId<ChannelBindingId>(
      record["bindingId"],
      "channel_work_trigger payload.bindingId",
    ),
    requestUrl: readNonEmptyString(record, "requestUrl", "channel_work_trigger payload"),
  };

  switch (provider) {
    case "discord": {
      return { ...base, provider, trigger: readDiscordTrigger(record["trigger"]) };
    }
    case "lark": {
      return { ...base, provider, trigger: readLarkTrigger(record["trigger"]) };
    }
    case "slack": {
      return { ...base, provider, trigger: readSlackTrigger(record["trigger"]) };
    }
    case "telegram": {
      return { ...base, provider, trigger: readTelegramTrigger(record["trigger"]) };
    }
  }
}

function parseScheduledMaintenancePayload(value: unknown): ScheduledMaintenanceCommandPayload {
  const record = requireRecord(value, "scheduled_maintenance payload");

  return {
    scheduledTime: readInteger(record, "scheduledTime", "scheduled_maintenance payload"),
  };
}

function parsePayloadJson(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch (error) {
    throw new ApiCommandPayloadError("API command payload JSON is invalid.", { cause: error });
  }
}

export function parseApiCommandPayload(
  kind: ApiCommandKind,
  payloadJson: string,
): ApiCommandPayload {
  const parsed = parsePayloadJson(payloadJson);

  switch (kind) {
    case "channel_work_trigger": {
      return parseChannelWorkTriggerPayload(parsed);
    }
    case "scheduled_maintenance": {
      return parseScheduledMaintenancePayload(parsed);
    }
    case "session_run_dispatch": {
      return parseSessionRunDispatchPayload(parsed);
    }
  }
}
