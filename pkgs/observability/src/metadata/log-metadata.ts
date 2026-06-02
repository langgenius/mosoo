import type { LogContext, LogMetadata } from "vestig";

type PrimitiveLogValue = boolean | null | number | string;
type PrimitiveLogRecord = Record<string, PrimitiveLogValue>;

interface NormalizedLogRecord {
  readonly [key: string]: NormalizedLogValue;
}

type NormalizedLogArray = readonly NormalizedLogValue[];
type NormalizedLogValue = NormalizedLogArray | NormalizedLogRecord | PrimitiveLogValue;

const CIRCULAR_REFERENCE_LABEL = "[Circular]";
const FUNCTION_VALUE_LABEL = "[Function]";
const SERIALIZATION_FAILURE_LABEL = "[Unserializable]";

function formatSymbolValue(value: symbol): string {
  return value.description === undefined ? "Symbol()" : `Symbol(${value.description})`;
}

function formatFunctionName(name: string): string {
  return name.length > 0 ? `[Function ${name}]` : FUNCTION_VALUE_LABEL;
}

function normalizeValue(
  value: unknown,
  seenObjects: WeakSet<object> = new WeakSet<object>(),
): NormalizedLogValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack ?? null,
    };
  }

  if (Array.isArray(value)) {
    if (seenObjects.has(value)) {
      return CIRCULAR_REFERENCE_LABEL;
    }

    seenObjects.add(value);
    const entries = value.flatMap((entry): NormalizedLogValue[] => {
      const normalizedEntry = normalizeValue(entry, seenObjects);
      return normalizedEntry === undefined ? [] : [normalizedEntry];
    });
    seenObjects.delete(value);

    return entries;
  }

  if (typeof value === "object") {
    if (seenObjects.has(value)) {
      return CIRCULAR_REFERENCE_LABEL;
    }

    seenObjects.add(value);
    const normalizedRecord = Object.fromEntries(
      Object.entries(value).flatMap(([key, entryValue]) => {
        const normalizedEntry = normalizeValue(entryValue, seenObjects);
        return normalizedEntry === undefined ? [] : [[key, normalizedEntry]];
      }),
    );
    seenObjects.delete(value);

    return normalizedRecord;
  }

  if (typeof value === "symbol") {
    return formatSymbolValue(value);
  }

  if (typeof value === "function") {
    return formatFunctionName(value.name);
  }

  return SERIALIZATION_FAILURE_LABEL;
}

export function formatLogValue(value: unknown): string {
  const normalized = normalizeValue(value);

  if (normalized === undefined) {
    return "";
  }

  if (normalized === null) {
    return "null";
  }

  if (typeof normalized === "boolean") {
    return normalized ? "true" : "false";
  }

  if (typeof normalized === "number") {
    return normalized.toString();
  }

  if (typeof normalized === "string") {
    return normalized;
  }

  try {
    return JSON.stringify(normalized);
  } catch {
    return SERIALIZATION_FAILURE_LABEL;
  }
}

function toPrimitiveValue(value: unknown): PrimitiveLogValue | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return value.toString();
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (Array.isArray(value) || typeof value === "object") {
    return formatLogValue(value);
  }

  if (value === undefined) {
    return undefined;
  }

  return formatLogValue(value);
}

export function normalizeLogMetadata(metadata: Record<string, unknown> = {}): LogMetadata {
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      const normalized = normalizeValue(value);
      return normalized === undefined ? [] : [[key, normalized]];
    }),
  );
}

export function normalizeLogContext(context: Record<string, unknown> = {}): LogContext {
  return normalizeLogMetadata(context) as LogContext;
}

export function toPrimitiveLogRecord(metadata: Record<string, unknown> = {}): PrimitiveLogRecord {
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      const normalized = toPrimitiveValue(value);
      return normalized === undefined ? [] : [[key, normalized]];
    }),
  );
}

export function createErrorLogContext(error: unknown): LogMetadata {
  if (error instanceof Error) {
    return {
      error,
    };
  }

  return {
    error: {
      message: typeof error === "string" ? error : "Unknown error.",
      name: "UnknownError",
    },
  };
}

export function createRequestLogMetadata(request: Request): LogMetadata {
  const url = new URL(request.url);

  return {
    cfRay: request.headers.get("cf-ray"),
    method: request.method,
    path: url.pathname,
  };
}
