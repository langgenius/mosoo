export type JsonRpcId = number | string;

export interface JsonRpcObject {
  readonly [key: string]: unknown;
}

export interface PhaseRecord {
  readonly durationMs: number;
  readonly name: string;
  readonly ok: boolean;
}

export interface RuntimeTurn {
  readonly durationMs: number | null;
  readonly error: string | null;
  readonly id: string;
  readonly status: string | null;
}

export interface RuntimeThread {
  readonly id: string;
}

export interface RuntimeProbeOptions {
  readonly commandTimeoutMs: number;
  readonly cwd: string;
  readonly executable: string;
  readonly keepHome: boolean;
  readonly model: string;
  readonly prompt: string;
  readonly requestTimeoutMs: number;
  readonly showStderr: boolean;
  readonly threadOnly: boolean;
}

export const DEFAULT_EXECUTABLE = ["co", "dex"].join("");
export const RUNTIME_HOME_ENV_NAME = ["CODE", "X_HOME"].join("");
export const LOCAL_RUNTIME_EXECUTABLE_ENV = "MOSOO_OPENAI_RUNTIME_EXECUTABLE";

export function isRecord(value: unknown): value is JsonRpcObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readString(record: JsonRpcObject, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: JsonRpcObject, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

export function readObject(record: JsonRpcObject, key: string): JsonRpcObject | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

export function readId(record: JsonRpcObject): JsonRpcId | null {
  const value = record["id"];
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  return null;
}

function requiredString(record: JsonRpcObject, key: string, label: string): string {
  const value = readString(record, key);
  if (value === null || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string.`);
  }
  return value;
}

export function parseThread(value: unknown, label: string): RuntimeThread {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const thread = readObject(value, "thread");
  if (thread === null) {
    throw new Error(`${label}.thread must be an object.`);
  }
  return {
    id: requiredString(thread, "id", `${label}.thread`),
  };
}

export function parseTurn(value: unknown, label: string): RuntimeTurn {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const turn = readObject(value, "turn");
  if (turn === null) {
    throw new Error(`${label}.turn must be an object.`);
  }
  const error = readObject(turn, "error");
  return {
    durationMs: readNumber(turn, "durationMs"),
    error: error === null ? null : redactSensitiveText(readString(error, "message")),
    id: requiredString(turn, "id", `${label}.turn`),
    status: readString(turn, "status"),
  };
}

export function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

export function redactSensitiveText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey || apiKey.length === 0) {
    return value;
  }

  return value.split(apiKey).join("[redacted]");
}

function nowMs(): number {
  return performance.now();
}

export async function measure<T>(
  phases: PhaseRecord[],
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  const startedAtMs = nowMs();
  try {
    const result = await action();
    phases.push({
      durationMs: nowMs() - startedAtMs,
      name,
      ok: true,
    });
    return result;
  } catch (error) {
    phases.push({
      durationMs: nowMs() - startedAtMs,
      name,
      ok: false,
    });
    throw error;
  }
}
