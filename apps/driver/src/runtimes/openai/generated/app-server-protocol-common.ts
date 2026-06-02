import type {
  FileUpdateChange,
  JsonObject,
  PatchChangeKind,
  TextPosition,
  TextRange,
  Thread,
  ThreadActiveFlag,
  ThreadItem,
  ThreadStatus,
  ThreadTokenUsage,
  TokenUsageBreakdown,
  Turn,
  TurnPlanStep,
  TurnPlanStepStatus,
  TurnStatus,
} from "./app-server-protocol-types";

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function expectRecord(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

export function readString(value: JsonObject, key: string): string | null {
  const entry = value[key];
  return typeof entry === "string" ? entry : null;
}

export function readRequiredString(value: JsonObject, key: string, label: string): string {
  const entry = readString(value, key);

  if (entry === null) {
    throw new Error(`${label}.${key} must be a string.`);
  }

  return entry;
}

export function readRequiredBoolean(value: JsonObject, key: string, label: string): boolean {
  const entry = value[key];

  if (typeof entry !== "boolean") {
    throw new Error(`${label}.${key} must be a boolean.`);
  }

  return entry;
}

function readOptionalString(value: JsonObject, key: string, label: string): string | undefined {
  const entry = value[key];

  if (entry === undefined) {
    return undefined;
  }

  if (typeof entry === "string") {
    return entry;
  }

  throw new Error(`${label}.${key} must be a string.`);
}

function readOptionalNumber(value: JsonObject, key: string, label: string): number | undefined {
  const entry = value[key];

  if (entry === undefined) {
    return undefined;
  }

  if (typeof entry === "number" && Number.isFinite(entry)) {
    return entry;
  }

  throw new Error(`${label}.${key} must be a finite number.`);
}

function readOptionalNullableNumber(
  value: JsonObject,
  key: string,
  label: string,
): number | null | undefined {
  const entry = value[key];

  if (entry === undefined) {
    return undefined;
  }

  if (entry === null) {
    return null;
  }

  if (typeof entry === "number" && Number.isFinite(entry)) {
    return entry;
  }

  throw new Error(`${label}.${key} must be a finite number or null.`);
}

export function readOptionalNullableString(
  value: JsonObject,
  key: string,
  label: string,
): string | null | undefined {
  const entry = value[key];

  if (entry === undefined) {
    return undefined;
  }

  if (entry === null || typeof entry === "string") {
    return entry;
  }

  throw new Error(`${label}.${key} must be a string or null.`);
}

function parseUint(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
}

function parseOptionalJsonObject(value: unknown, label: string): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectRecord(value, label);
}

function parseOptionalJsonValue(value: unknown, label: string): unknown {
  if (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => parseOptionalJsonValue(entry, `${label}.${String(index)}`));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, parseOptionalJsonValue(entry, key)]),
    );
  }

  throw new Error(`${label} must be JSON-compatible.`);
}

function parseTextPosition(value: unknown, label: string): TextPosition {
  const record = expectRecord(value, label);

  return {
    column: parseUint(record["column"], `${label}.column`),
    line: parseUint(record["line"], `${label}.line`),
  };
}

export function parseOptionalTextRange(
  value: JsonObject,
  key: string,
  label: string,
): TextRange | null | undefined {
  const entry = value[key];

  if (entry === undefined) {
    return undefined;
  }

  if (entry === null) {
    return null;
  }

  const record = expectRecord(entry, `${label}.${key}`);

  return {
    end: parseTextPosition(record["end"], `${label}.${key}.end`),
    start: parseTextPosition(record["start"], `${label}.${key}.start`),
  };
}

function parsePatchChangeKind(value: unknown, label: string): PatchChangeKind {
  const record = expectRecord(value, label);
  const type = readRequiredString(record, "type", label);

  if (type === "add" || type === "delete") {
    return { type };
  }

  if (type === "update") {
    return {
      move_path: readOptionalNullableString(record, "move_path", label) ?? null,
      type,
    };
  }

  throw new Error(`${label}.type is unsupported.`);
}

function parseFileUpdateChange(value: unknown, label: string): FileUpdateChange {
  const record = expectRecord(value, label);

  return {
    diff: readRequiredString(record, "diff", label),
    kind: parsePatchChangeKind(record["kind"], `${label}.kind`),
    path: readRequiredString(record, "path", label),
  };
}

export function parseFileUpdateChanges(value: unknown, label: string): FileUpdateChange[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((change, index) => parseFileUpdateChange(change, `${label}.${String(index)}`));
}

function parseTurnPlanStepStatus(value: unknown, label: string): TurnPlanStepStatus {
  if (value === "pending" || value === "inProgress" || value === "completed") {
    return value;
  }

  throw new Error(`${label} is unsupported.`);
}

function parseTurnPlanStep(value: unknown, label: string): TurnPlanStep {
  const record = expectRecord(value, label);

  return {
    status: parseTurnPlanStepStatus(record["status"], `${label}.status`),
    step: readRequiredString(record, "step", label),
  };
}

export function parseTurnPlan(value: unknown, label: string): TurnPlanStep[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((step, index) => parseTurnPlanStep(step, `${label}.${String(index)}`));
}

export function parseThreadTurnIds(
  value: JsonObject,
  label: string,
): { threadId: string; turnId: string } {
  return {
    threadId: readRequiredString(value, "threadId", label),
    turnId: readRequiredString(value, "turnId", label),
  };
}

export function parseThread(value: unknown, label: string): Thread {
  const record = expectRecord(value, label);
  const id = readString(record, "id");

  if (id === null || id.length === 0) {
    throw new Error(`${label}.id must be a non-empty string.`);
  }

  return {
    id,
    ...(record["status"] === undefined
      ? {}
      : { status: parseThreadStatus(record["status"], `${label}.status`) }),
  };
}

function parseThreadActiveFlag(value: unknown, label: string): ThreadActiveFlag {
  if (value === "waitingOnApproval" || value === "waitingOnUserInput") {
    return value;
  }

  throw new Error(`${label} is unsupported.`);
}

export function parseThreadStatus(value: unknown, label: string): ThreadStatus {
  const record = expectRecord(value, label);
  const statusType = readString(record, "type");

  if (statusType === "notLoaded" || statusType === "idle" || statusType === "systemError") {
    return { type: statusType };
  }

  if (statusType === "active") {
    const activeFlags = record["activeFlags"];

    if (!Array.isArray(activeFlags)) {
      throw new Error(`${label}.activeFlags must be an array.`);
    }

    return {
      activeFlags: activeFlags.map((flag, index) =>
        parseThreadActiveFlag(flag, `${label}.activeFlags.${String(index)}`),
      ),
      type: "active",
    };
  }

  throw new Error(`${label}.type is unsupported.`);
}

export function parseThreadItem(value: unknown, label: string): ThreadItem {
  const record = expectRecord(value, label);
  const type = readRequiredString(record, "type", label);
  const id = readOptionalString(record, "id", label);
  const { id: _id, type: _type, ...rest } = record;
  const passthrough = Object.fromEntries(
    Object.entries(rest).map(([key, entry]) => [key, parseOptionalJsonValue(entry, key)]),
  );

  return {
    ...passthrough,
    ...(id === undefined ? {} : { id }),
    type,
  };
}

function parseOptionalThreadItems(value: unknown, label: string): ThreadItem[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((item, index) => parseThreadItem(item, `${label}.${String(index)}`));
}

function parseTurnStatus(value: unknown, label: string): TurnStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "completed" ||
    value === "interrupted" ||
    value === "failed" ||
    value === "inProgress"
  ) {
    return value;
  }

  throw new Error(`${label} is unsupported.`);
}

export function parseTurn(value: unknown, label: string): Turn {
  const record = expectRecord(value, label);
  const id = readString(record, "id");

  if (id === null || id.length === 0) {
    throw new Error(`${label}.id must be a non-empty string.`);
  }

  const error = record["error"];
  const parsedError =
    error === undefined || error === null ? null : expectRecord(error, `${label}.error`);
  const errorMessage = parsedError === null ? null : readString(parsedError, "message");
  const items = parseOptionalThreadItems(record["items"], `${label}.items`);
  const startedAt = readOptionalNullableNumber(record, "startedAt", label);
  const completedAt = readOptionalNullableNumber(record, "completedAt", label);
  const durationMs = readOptionalNullableNumber(record, "durationMs", label);
  const status = parseTurnStatus(record["status"], `${label}.status`);

  return {
    id,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(errorMessage === null ? {} : { error: { message: errorMessage } }),
    ...(items === undefined ? {} : { items }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(status === undefined ? {} : { status }),
  };
}

function parseTokenUsageBreakdown(value: unknown, label: string): TokenUsageBreakdown {
  const record = expectRecord(value, label);

  return {
    cachedInputTokens: parseUint(record["cachedInputTokens"], `${label}.cachedInputTokens`),
    inputTokens: parseUint(record["inputTokens"], `${label}.inputTokens`),
    outputTokens: parseUint(record["outputTokens"], `${label}.outputTokens`),
    reasoningOutputTokens: parseUint(
      record["reasoningOutputTokens"],
      `${label}.reasoningOutputTokens`,
    ),
    totalTokens: parseUint(record["totalTokens"], `${label}.totalTokens`),
  };
}

export function parseThreadTokenUsage(value: unknown, label: string): ThreadTokenUsage {
  const record = expectRecord(value, label);
  const modelContextWindow =
    record["modelContextWindow"] === null
      ? null
      : parseUint(record["modelContextWindow"], `${label}.modelContextWindow`);

  return {
    last: parseTokenUsageBreakdown(record["last"], `${label}.last`),
    modelContextWindow,
    total: parseTokenUsageBreakdown(record["total"], `${label}.total`),
  };
}

export function parseOptionalNotificationString(
  value: JsonObject,
  key: string,
  label: string,
): { readonly [field: string]: string } {
  const entry = readOptionalString(value, key, label);
  return entry === undefined ? {} : { [key]: entry };
}

export function parseOptionalNotificationNumber(
  value: JsonObject,
  key: string,
  label: string,
): { readonly [field: string]: number } {
  const entry = readOptionalNumber(value, key, label);
  return entry === undefined ? {} : { [key]: entry };
}

export function parseOptionalNotificationRecord(
  value: JsonObject,
  key: string,
  label: string,
): { readonly [field: string]: JsonObject } {
  const entry = parseOptionalJsonObject(value[key], `${label}.${key}`);
  return entry === undefined ? {} : { [key]: entry };
}
