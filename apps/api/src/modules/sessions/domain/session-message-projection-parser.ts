import type { SessionMessagePlanEntry, SessionMessageSegment } from "@mosoo/contracts/session";

export interface StoredSessionMessageProjectionInput {
  planJson: string | null;
  segmentsJson: string | null;
}

export interface StoredSessionMessageProjection {
  plan: SessionMessagePlanEntry[];
  segments: SessionMessageSegment[];
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type JsonRecord = Record<string, unknown>;

function parseJsonArrayField(raw: string | null, fieldName: string): unknown[] {
  if (raw === null || raw.length === 0) {
    return [];
  }

  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new TypeError(`Stored session message ${fieldName} must be a JSON array.`);
  }

  return parsed;
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Stored session message ${fieldName} must be a string.`);
  }

  return value;
}

function readNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Stored session message ${fieldName} must be a string or null.`);
  }

  return value;
}

function readPlanPriority(value: unknown): SessionMessagePlanEntry["priority"] {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  throw new Error("Stored session message plan priority is invalid.");
}

function readPlanStatus(value: unknown): SessionMessagePlanEntry["status"] {
  if (value === "pending" || value === "in_progress" || value === "completed") {
    return value;
  }

  throw new Error("Stored session message plan status is invalid.");
}

function parsePlanEntry(raw: unknown): SessionMessagePlanEntry {
  if (!isRecord(raw)) {
    throw new Error("Stored session message plan entry must be an object.");
  }

  return {
    content: readString(raw["content"], "plan content"),
    priority: readPlanPriority(raw["priority"]),
    status: readPlanStatus(raw["status"]),
  };
}

function parseMessageSegment(raw: unknown): SessionMessageSegment {
  if (!isRecord(raw)) {
    throw new Error("Stored session message segment must be an object.");
  }

  const { kind } = raw;

  if (kind === "text") {
    return { kind: "text", text: readString(raw["text"], "text segment text") };
  }

  const tool = readString(raw["tool"], "tool segment tool");
  const toolCallId = readString(raw["toolCallId"], "tool segment toolCallId");

  if (kind === "tool_use") {
    return {
      argsText: readString(raw["argsText"], "tool_use argsText"),
      kind: "tool_use",
      path: readNullableString(raw["path"], "tool_use path"),
      tool,
      toolCallId,
    };
  }

  if (kind === "tool_result") {
    return {
      kind: "tool_result",
      output: readString(raw["output"], "tool_result output"),
      tool,
      toolCallId,
    };
  }

  throw new Error("Stored session message segment kind is invalid.");
}

export function parseStoredSessionMessageProjection(
  input: StoredSessionMessageProjectionInput,
): StoredSessionMessageProjection {
  const plan = parseJsonArrayField(input.planJson, "plan").map(parsePlanEntry);
  const segments = parseJsonArrayField(input.segmentsJson, "segments").map(parseMessageSegment);

  return { plan, segments };
}
