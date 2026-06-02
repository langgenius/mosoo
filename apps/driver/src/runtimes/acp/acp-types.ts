import { formatLogValue } from "@mosoo/observability";

export type JsonObject = Record<string, unknown>;

export interface AcpAuthMethod {
  readonly description?: string | null;
  readonly id: string;
  readonly name?: string | null;
  readonly type?: string | null;
}

export interface AcpInitializeResult {
  readonly agentCapabilities: JsonObject | null;
  readonly agentInfo: unknown;
  readonly authMethods: readonly AcpAuthMethod[];
  readonly protocolVersion: number | string | null;
}

export interface AcpSessionSetupResult {
  readonly raw: JsonObject;
  readonly sessionId: string | null;
}

const ACP_STOP_REASONS = [
  "cancelled",
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
] as const;

type AcpStopReason = (typeof ACP_STOP_REASONS)[number];
export type AcpPromptStopReason = AcpStopReason;

export interface AcpPromptResult {
  readonly raw: JsonObject;
  readonly stopReason: AcpPromptStopReason;
  readonly usage: unknown;
  readonly userMessageId: string | null;
}

export interface AcpMcpServer {
  readonly _meta?: JsonObject;
  readonly headers: readonly { name: string; value: string }[];
  readonly name: string;
  readonly type: "http";
  readonly url: string;
}

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readArray(value: JsonObject | null, key: string): unknown[] {
  const entry = value?.[key];
  return Array.isArray(entry) ? entry : [];
}

export function readNonEmptyString(value: JsonObject | null, key: string): string | null {
  const entry = readString(value, key);
  return entry !== null && entry.length > 0 ? entry : null;
}

export function readNullableString(
  value: JsonObject | null,
  key: string,
): string | null | undefined {
  const entry = value?.[key];

  if (entry === null) {
    return null;
  }

  return typeof entry === "string" ? entry : undefined;
}

export function readNumber(value: JsonObject | null, key: string): number | null {
  const entry = value?.[key];
  return typeof entry === "number" && Number.isFinite(entry) ? entry : null;
}

export function readRecord(value: JsonObject | null, key: string): JsonObject | null {
  const entry = value?.[key];
  return isRecord(entry) ? entry : null;
}

export function readString(value: JsonObject | null, key: string): string | null {
  const entry = value?.[key];
  return typeof entry === "string" ? entry : null;
}

export function stringifyForDisplay(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return formatLogValue(value);
}

export function toJsonRpcId(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseAcpInitializeResult(value: unknown): AcpInitializeResult {
  if (!isRecord(value)) {
    throw new Error("ACP initialize result must be an object.");
  }

  const record = value;
  const authMethods = readArray(record, "authMethods").flatMap((method): AcpAuthMethod[] => {
    if (!isRecord(method)) {
      return [];
    }

    const id = readNonEmptyString(method, "id");

    if (id === null) {
      return [];
    }

    const description = readNullableString(method, "description");
    const name = readNullableString(method, "name");
    const methodType = readNullableString(method, "type");

    return [
      {
        ...(description === undefined ? {} : { description }),
        id,
        ...(name === undefined ? {} : { name }),
        ...(methodType === undefined ? {} : { type: methodType }),
      },
    ];
  });
  const protocolVersion = record["protocolVersion"];

  return {
    agentCapabilities: readRecord(record, "agentCapabilities"),
    agentInfo: record["agentInfo"],
    authMethods,
    protocolVersion:
      typeof protocolVersion === "number" || typeof protocolVersion === "string"
        ? protocolVersion
        : null,
  };
}

function parseAcpStopReason(value: unknown): AcpPromptStopReason {
  switch (value) {
    case "cancelled":
    case "end_turn":
    case "max_tokens":
    case "max_turn_requests":
    case "refusal":
      return value;
    default:
      throw new Error(
        `ACP session/prompt stopReason must be one of: ${ACP_STOP_REASONS.join(", ")}.`,
      );
  }
}

export function parseAcpPromptResult(value: unknown): AcpPromptResult {
  if (!isRecord(value)) {
    throw new Error("ACP session/prompt result must be an object.");
  }

  return {
    raw: value,
    stopReason: parseAcpStopReason(value["stopReason"]),
    usage: value["usage"],
    userMessageId: readNonEmptyString(value, "userMessageId"),
  };
}

export function parseAcpSessionSetupResult(value: unknown): AcpSessionSetupResult {
  if (!isRecord(value)) {
    throw new Error("ACP session setup result must be an object.");
  }

  const record = value;

  return {
    raw: record,
    sessionId: readNonEmptyString(record, "sessionId"),
  };
}
