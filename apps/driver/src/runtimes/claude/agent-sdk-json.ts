import { formatLogValue } from "@mosoo/observability";

export type JsonObject = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readString(value: JsonObject | null, key: string): string | null {
  const entry = value?.[key];
  return typeof entry === "string" ? entry : null;
}

export function readNumber(value: JsonObject | null, key: string): number | null {
  const entry = value?.[key];
  return typeof entry === "number" ? entry : null;
}

export function readRecord(value: JsonObject | null, key: string): JsonObject | null {
  const entry = value?.[key];
  return isRecord(entry) ? entry : null;
}

export function stringifyForDisplay(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return formatLogValue(value);
}

export function toErrorMessage(error: unknown, defaultMessage: string): string {
  return error instanceof Error ? error.message : defaultMessage;
}

export function readProcessEnvString(key: string): string | undefined {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
