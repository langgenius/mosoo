import { formatLogValue } from "@mosoo/observability";

export type JsonObject = Record<string, unknown>;
export type JsonRpcId = number | string;

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readString(value: JsonObject | null, key: string): string | null {
  const entry = value?.[key];
  return typeof entry === "string" ? entry : null;
}

export function readNonEmptyString(value: JsonObject | null, key: string): string | null {
  const entry = readString(value, key);

  return entry !== null && entry.length > 0 ? entry : null;
}

export function readRecord(value: JsonObject | null, key: string): JsonObject | null {
  const entry = value?.[key];
  return isRecord(entry) ? entry : null;
}

export function readArray(value: JsonObject | null, key: string): unknown[] {
  const entry = value?.[key];
  return Array.isArray(entry) ? entry : [];
}

export function stringifyForDisplay(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return formatLogValue(value);
}

export function toJsonRpcId(value: unknown): JsonRpcId | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return null;
}
