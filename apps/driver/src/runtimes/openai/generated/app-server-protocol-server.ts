import {
  expectRecord,
  parseFileUpdateChanges,
  parseOptionalNotificationNumber,
  parseOptionalNotificationString,
  parseOptionalTextRange,
  parseThread,
  parseThreadItem,
  parseThreadStatus,
  parseThreadTokenUsage,
  parseThreadTurnIds,
  parseTurn,
  parseTurnPlan,
  readOptionalNullableString,
  readRequiredBoolean,
  readRequiredString,
} from "./app-server-protocol-common";
import type {
  ConfigWarningNotification,
  ErrorNotification,
  FileChangePatchUpdatedNotification,
  ItemNotificationBase,
  JsonObject,
  PlanDeltaNotification,
  ReasoningSummaryPartAddedNotification,
  ReasoningSummaryTextDeltaNotification,
  ReasoningTextDeltaNotification,
  RemoteControlConnectionStatus,
  RemoteControlStatusChangedNotification,
  ServerNotificationMethod,
  ServerNotificationParams,
  ThreadSettingsUpdatedNotification,
  TurnDiffUpdatedNotification,
  TurnError,
  TurnPlanUpdatedNotification,
  WarningNotification,
} from "./app-server-protocol-types";

function readParams(value: unknown, method: string): JsonObject {
  return expectRecord(value ?? {}, `${method} params`);
}

function parseConfigWarningNotification(value: unknown): ConfigWarningNotification {
  const label = "configWarning params";
  const record = readParams(value, "configWarning");
  const details = readOptionalNullableString(record, "details", label);
  const path = readOptionalNullableString(record, "path", label);
  const range = parseOptionalTextRange(record, "range", label);

  return {
    ...(details === undefined ? {} : { details }),
    ...(path === undefined ? {} : { path }),
    ...(range === undefined ? {} : { range }),
    summary: readRequiredString(record, "summary", label),
  };
}

function parseWarningNotification(value: unknown): WarningNotification {
  const label = "warning params";
  const record = readParams(value, "warning");

  return {
    message: readRequiredString(record, "message", label),
    threadId: readOptionalNullableString(record, "threadId", label) ?? null,
  };
}

function parseTurnErrorPayload(value: unknown, label: string): TurnError {
  const record = expectRecord(value, label);

  return {
    additionalDetails: readOptionalNullableString(record, "additionalDetails", label) ?? null,
    message: readRequiredString(record, "message", label),
  };
}

function parseErrorNotification(value: unknown): ErrorNotification {
  const label = "error params";
  const record = readParams(value, "error");

  return {
    error: parseTurnErrorPayload(record["error"], `${label}.error`),
    threadId: readRequiredString(record, "threadId", label),
    turnId: readRequiredString(record, "turnId", label),
    willRetry: readRequiredBoolean(record, "willRetry", label),
  };
}

function parseRemoteControlConnectionStatus(value: unknown): RemoteControlConnectionStatus {
  if (
    value === "disabled" ||
    value === "connecting" ||
    value === "connected" ||
    value === "errored"
  ) {
    return value;
  }

  throw new Error("remoteControl/status/changed params.status is unsupported.");
}

function parseRemoteControlStatusChangedNotification(
  value: unknown,
): RemoteControlStatusChangedNotification {
  const label = "remoteControl/status/changed params";
  const record = readParams(value, "remoteControl/status/changed");
  const environmentId = readOptionalNullableString(record, "environmentId", label);

  return {
    ...(environmentId === undefined ? {} : { environmentId }),
    installationId: readRequiredString(record, "installationId", label),
    serverName: readRequiredString(record, "serverName", label),
    status: parseRemoteControlConnectionStatus(record["status"]),
  };
}

function parseThreadSettingsUpdatedNotification(value: unknown): ThreadSettingsUpdatedNotification {
  const label = "thread/settings/updated params";
  const record = readParams(value, "thread/settings/updated");

  return {
    threadId: readRequiredString(record, "threadId", label),
    threadSettings: expectRecord(record["threadSettings"], `${label}.threadSettings`),
  };
}

function parseOptionalDeltaNotification(
  value: unknown,
  method: string,
): { delta?: string; threadId?: string; turnId?: string } {
  const record = readParams(value, method);

  return {
    ...parseOptionalNotificationString(record, "delta", `${method} params`),
    ...parseOptionalNotificationString(record, "threadId", `${method} params`),
    ...parseOptionalNotificationString(record, "turnId", `${method} params`),
  };
}

function parseOptionalToolDeltaNotification(
  value: unknown,
  method: string,
): { delta?: string; itemId?: string; threadId?: string; turnId?: string } {
  const record = readParams(value, method);

  return {
    ...parseOptionalNotificationString(record, "delta", `${method} params`),
    ...parseOptionalNotificationString(record, "itemId", `${method} params`),
    ...parseOptionalNotificationString(record, "threadId", `${method} params`),
    ...parseOptionalNotificationString(record, "turnId", `${method} params`),
  };
}

function parseItemNotificationBase(value: unknown, method: string): ItemNotificationBase {
  const record = readParams(value, method);

  return {
    ...parseOptionalNotificationNumber(record, "completedAtMs", `${method} params`),
    ...(record["item"] === undefined
      ? {}
      : { item: parseThreadItem(record["item"], `${method} params.item`) }),
    ...parseOptionalNotificationString(record, "itemId", `${method} params`),
    ...parseOptionalNotificationNumber(record, "startedAtMs", `${method} params`),
    ...parseOptionalNotificationString(record, "threadId", `${method} params`),
    ...parseOptionalNotificationString(record, "turnId", `${method} params`),
  };
}

function parsePlanDeltaNotification(value: unknown): PlanDeltaNotification {
  const label = "item/plan/delta params";
  const record = readParams(value, "item/plan/delta");

  return {
    delta: readRequiredString(record, "delta", label),
    itemId: readRequiredString(record, "itemId", label),
    threadId: readRequiredString(record, "threadId", label),
    turnId: readRequiredString(record, "turnId", label),
  };
}

function parseReasoningTextDeltaNotification(value: unknown): ReasoningTextDeltaNotification {
  const label = "item/reasoning/textDelta params";
  const record = readParams(value, "item/reasoning/textDelta");

  return {
    delta: readRequiredString(record, "delta", label),
    itemId: readRequiredString(record, "itemId", label),
    threadId: readRequiredString(record, "threadId", label),
    turnId: readRequiredString(record, "turnId", label),
  };
}

function parseReasoningSummaryPartAddedNotification(
  value: unknown,
): ReasoningSummaryPartAddedNotification {
  const label = "item/reasoning/summaryPartAdded params";
  const record = readParams(value, "item/reasoning/summaryPartAdded");

  return {
    itemId: readRequiredString(record, "itemId", label),
    part: readRequiredString(record, "part", label),
    threadId: readRequiredString(record, "threadId", label),
    turnId: readRequiredString(record, "turnId", label),
  };
}

function parseReasoningSummaryTextDeltaNotification(
  value: unknown,
): ReasoningSummaryTextDeltaNotification {
  const label = "item/reasoning/summaryTextDelta params";
  const record = readParams(value, "item/reasoning/summaryTextDelta");

  return {
    delta: readRequiredString(record, "delta", label),
    itemId: readRequiredString(record, "itemId", label),
    threadId: readRequiredString(record, "threadId", label),
    turnId: readRequiredString(record, "turnId", label),
  };
}

function parseThreadStarted(value: unknown): ServerNotificationParams["thread/started"] {
  const record = readParams(value, "thread/started");

  return {
    thread: parseThread(record["thread"], "thread/started params.thread"),
  };
}

function parseThreadStatusChanged(
  value: unknown,
): ServerNotificationParams["thread/status/changed"] {
  const label = "thread/status/changed params";
  const record = readParams(value, "thread/status/changed");

  return {
    status: parseThreadStatus(record["status"], `${label}.status`),
    threadId: readRequiredString(record, "threadId", label),
  };
}

function parseThreadTokenUsageUpdated(
  value: unknown,
): ServerNotificationParams["thread/tokenUsage/updated"] {
  const label = "thread/tokenUsage/updated params";
  const record = readParams(value, "thread/tokenUsage/updated");

  return {
    threadId: readRequiredString(record, "threadId", label),
    tokenUsage: parseThreadTokenUsage(record["tokenUsage"], `${label}.tokenUsage`),
    turnId: readRequiredString(record, "turnId", label),
  };
}

function parseTurnNotification(
  value: unknown,
  method: "turn/completed" | "turn/started",
): ServerNotificationParams[typeof method] {
  const label = `${method} params`;
  const record = readParams(value, method);

  return {
    threadId: readRequiredString(record, "threadId", label),
    turn: parseTurn(record["turn"], `${label}.turn`),
  };
}

function parseTurnPlanUpdated(value: unknown): TurnPlanUpdatedNotification {
  const label = "turn/plan/updated params";
  const record = readParams(value, "turn/plan/updated");

  return {
    ...parseThreadTurnIds(record, label),
    explanation: readOptionalNullableString(record, "explanation", label) ?? null,
    plan: parseTurnPlan(record["plan"], `${label}.plan`),
  };
}

function parseTurnDiffUpdated(value: unknown): TurnDiffUpdatedNotification {
  const label = "turn/diff/updated params";
  const record = readParams(value, "turn/diff/updated");

  return {
    ...parseThreadTurnIds(record, label),
    diff: readRequiredString(record, "diff", label),
  };
}

function parseFileChangePatchUpdated(value: unknown): FileChangePatchUpdatedNotification {
  const label = "item/fileChange/patchUpdated params";
  const record = readParams(value, "item/fileChange/patchUpdated");

  return {
    ...parseThreadTurnIds(record, label),
    changes: parseFileUpdateChanges(record["changes"], `${label}.changes`),
    itemId: readRequiredString(record, "itemId", label),
  };
}

const SERVER_NOTIFICATION_PARAM_PARSERS: {
  [Method in ServerNotificationMethod]: (value: unknown) => ServerNotificationParams[Method];
} = {
  configWarning: parseConfigWarningNotification,
  error: parseErrorNotification,
  "item/agentMessage/delta": (value) =>
    parseOptionalDeltaNotification(value, "item/agentMessage/delta"),
  "item/commandExecution/outputDelta": (value) =>
    parseOptionalToolDeltaNotification(value, "item/commandExecution/outputDelta"),
  "item/completed": (value) => parseItemNotificationBase(value, "item/completed"),
  "item/fileChange/outputDelta": (value) =>
    parseOptionalToolDeltaNotification(value, "item/fileChange/outputDelta"),
  "item/fileChange/patchUpdated": parseFileChangePatchUpdated,
  "item/plan/delta": parsePlanDeltaNotification,
  "item/reasoning/summaryPartAdded": parseReasoningSummaryPartAddedNotification,
  "item/reasoning/summaryTextDelta": parseReasoningSummaryTextDeltaNotification,
  "item/reasoning/textDelta": parseReasoningTextDeltaNotification,
  "item/started": (value) => parseItemNotificationBase(value, "item/started"),
  "remoteControl/status/changed": parseRemoteControlStatusChangedNotification,
  "thread/settings/updated": parseThreadSettingsUpdatedNotification,
  "thread/started": parseThreadStarted,
  "thread/status/changed": parseThreadStatusChanged,
  "thread/tokenUsage/updated": parseThreadTokenUsageUpdated,
  "turn/completed": (value) => parseTurnNotification(value, "turn/completed"),
  "turn/diff/updated": parseTurnDiffUpdated,
  "turn/plan/updated": parseTurnPlanUpdated,
  "turn/started": (value) => parseTurnNotification(value, "turn/started"),
  warning: parseWarningNotification,
};

export function parseServerNotificationParams<M extends ServerNotificationMethod>(
  method: M,
  value: unknown,
): ServerNotificationParams[M] {
  return SERVER_NOTIFICATION_PARAM_PARSERS[method](value);
}
