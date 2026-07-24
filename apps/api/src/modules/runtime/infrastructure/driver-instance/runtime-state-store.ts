import {
  parseDriverHeartbeatInput,
  parseDriverHelloInput,
  parseDriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import type {
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import { parseRuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId } from "@mosoo/id";

import type { DriverInstanceCloseSnapshot } from "./state";

export const HEARTBEAT_STATE_PERSIST_INTERVAL_MS = 10_000;
export const DRIVER_INSTANCE_STATE_STORAGE_KEY = "driverInstanceState";

export interface DriverInstanceStoredState {
  close: DriverInstanceCloseSnapshot | null;
  commandQueue: RuntimeCommand[];
  connectedAt: number | null;
  connectionId: string | null;
  driverGeneration: number | null;
  driverInstanceId: DriverInstanceId | null;
  errorMessage: string | null;
  heartbeatCount: number;
  hello: DriverHelloInput | null;
  lastHeartbeat: DriverHeartbeatInput | null;
  ready: DriverReadyInput | null;
  traceId: string | null;
}

interface DriverInstanceRuntimeStorage {
  deleteAll(): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface DriverInstanceRuntimeStateContext {
  readonly storage: DriverInstanceRuntimeStorage;
}

export function parseHeartbeatTimestampMs(value: string): number {
  const timestampMs = Date.parse(value);

  if (Number.isNaN(timestampMs)) {
    throw new TypeError("Driver heartbeat timestamp is invalid.");
  }

  return timestampMs;
}

export function parseStoredState(value: unknown): DriverInstanceStoredState {
  if (value === undefined) {
    return createEmptyStoredState();
  }

  if (!isRecord(value)) {
    throw new TypeError("Driver instance stored state must be an object.");
  }

  return {
    close: parseCloseSnapshot(value["close"]),
    commandQueue: parseCommandQueue(value["commandQueue"]),
    connectedAt: readNullableNumber(value, "connectedAt"),
    connectionId: readNullableString(value, "connectionId"),
    driverGeneration: readNullableNumber(value, "driverGeneration"),
    driverInstanceId: readNullableDriverInstanceId(value, "driverInstanceId"),
    errorMessage: readNullableString(value, "errorMessage"),
    heartbeatCount: readRequiredNumber(value, "heartbeatCount"),
    hello: parseNullableHello(value["hello"]),
    lastHeartbeat: parseNullableHeartbeat(value["lastHeartbeat"]),
    ready: parseNullableReady(value["ready"]),
    traceId: readNullableString(value, "traceId"),
  };
}

export function createEmptyStoredState(): DriverInstanceStoredState {
  return {
    close: null,
    commandQueue: [],
    connectedAt: null,
    connectionId: null,
    driverGeneration: null,
    driverInstanceId: null,
    errorMessage: null,
    heartbeatCount: 0,
    hello: null,
    lastHeartbeat: null,
    ready: null,
    traceId: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredNumber(value: Record<string, unknown>, field: string): number {
  const entry = value[field];

  if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) {
    throw new TypeError(`Driver instance stored state ${field} must be a non-negative number.`);
  }

  return entry;
}

function readNullableNumber(value: Record<string, unknown>, field: string): number | null {
  const entry = value[field];

  if (entry === null) {
    return null;
  }

  if (typeof entry !== "number" || !Number.isFinite(entry)) {
    throw new TypeError(`Driver instance stored state ${field} must be a finite number or null.`);
  }

  return entry;
}

function readNullableString(value: Record<string, unknown>, field: string): string | null {
  const entry = value[field];

  if (entry === null) {
    return null;
  }

  if (typeof entry !== "string") {
    throw new TypeError(`Driver instance stored state ${field} must be a string or null.`);
  }

  return entry;
}

function readNullableDriverInstanceId(
  value: Record<string, unknown>,
  field: string,
): DriverInstanceId | null {
  const entry = value[field];

  return entry === null ? null : parsePlatformId<DriverInstanceId>(entry, field);
}

function readRequiredString(value: Record<string, unknown>, field: string): string {
  const entry = value[field];

  if (typeof entry !== "string") {
    throw new TypeError(`Driver instance stored state ${field} must be a string.`);
  }

  return entry;
}

function parseCloseSnapshot(value: unknown): DriverInstanceCloseSnapshot | null {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new TypeError("Driver instance close snapshot must be an object or null.");
  }

  return {
    at: readRequiredString(value, "at"),
    code: readRequiredNumber(value, "code"),
    reason: readRequiredString(value, "reason"),
  };
}

function parseCommandQueue(value: unknown): RuntimeCommand[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Driver instance command queue must be an array.");
  }

  return value.map((command) => parseRuntimeCommand(command));
}

function parseNullableHeartbeat(value: unknown): DriverHeartbeatInput | null {
  return value === null ? null : parseDriverHeartbeatInput(value);
}

function parseNullableHello(value: unknown): DriverHelloInput | null {
  return value === null ? null : parseDriverHelloInput(value);
}

function parseNullableReady(value: unknown): DriverReadyInput | null {
  if (value === null) {
    return null;
  }

  const ready = parseDriverReadyInput(value);

  return {
    ...ready,
    driverInstanceId: parsePlatformId<DriverInstanceId>(
      ready.driverInstanceId,
      "Driver ready driver instance id",
    ),
  };
}
