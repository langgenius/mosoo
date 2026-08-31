import {
  parseDriverHeartbeatInput,
  parseDriverHelloInput,
  parseDriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import type {
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverHelloOutput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import { parseRuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";

import { parseDriverHelloOutput } from "./rpc-wire";
import type { DriverInstanceCloseSnapshot, DriverInstanceConnectionEpoch } from "./state";

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
  helloOutput: DriverHelloOutput | null;
  lastHeartbeat: DriverHeartbeatInput | null;
  pendingHello: DriverInstancePendingHello | null;
  pendingReady: DriverInstancePendingReady | null;
  ready: DriverReadyInput | null;
  terminalCleanupComplete: boolean;
  terminalSessionRunId: SessionRunId | null;
  traceId: string | null;
}

export interface DriverInstancePendingHello {
  epoch: DriverInstanceConnectionEpoch;
  input: DriverHelloInput;
  output: DriverHelloOutput;
}

export interface DriverInstancePendingReady {
  epoch: DriverInstanceConnectionEpoch;
  input: DriverReadyInput;
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
    helloOutput: parseOptionalNullableHelloOutput(value["helloOutput"]),
    lastHeartbeat: parseNullableHeartbeat(value["lastHeartbeat"]),
    pendingHello: parseOptionalPendingHello(value["pendingHello"]),
    pendingReady: parseOptionalPendingReady(value["pendingReady"]),
    ready: parseNullableReady(value["ready"]),
    terminalCleanupComplete: readOptionalBoolean(value, "terminalCleanupComplete", false),
    terminalSessionRunId: readOptionalNullableSessionRunId(value, "terminalSessionRunId"),
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
    helloOutput: null,
    lastHeartbeat: null,
    pendingHello: null,
    pendingReady: null,
    ready: null,
    terminalCleanupComplete: false,
    terminalSessionRunId: null,
    traceId: null,
  };
}

function readOptionalBoolean(
  value: Record<string, unknown>,
  field: string,
  defaultValue: boolean,
): boolean {
  const entry = value[field];

  if (entry === undefined) {
    return defaultValue;
  }
  if (typeof entry !== "boolean") {
    throw new TypeError(`Driver instance stored state ${field} must be a boolean.`);
  }

  return entry;
}

function readOptionalNullableSessionRunId(
  value: Record<string, unknown>,
  field: string,
): SessionRunId | null {
  const entry = value[field];

  return entry === undefined || entry === null ? null : parsePlatformId<SessionRunId>(entry, field);
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

function parseOptionalNullableHelloOutput(value: unknown): DriverHelloOutput | null {
  return value === undefined || value === null ? null : parseDriverHelloOutput(value);
}

function parseConnectionEpoch(value: unknown): DriverInstanceConnectionEpoch {
  if (!isRecord(value)) {
    throw new TypeError("Driver instance connection epoch must be an object.");
  }

  const connectionId = readRequiredString(value, "connectionId");
  const generation = readRequiredNumber(value, "generation");

  if (connectionId.length === 0 || !Number.isSafeInteger(generation)) {
    throw new TypeError("Driver instance connection epoch is invalid.");
  }

  return { connectionId, generation };
}

function parseOptionalPendingHello(value: unknown): DriverInstancePendingHello | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new TypeError("Pending Driver hello must be an object.");
  }

  return {
    epoch: parseConnectionEpoch(value["epoch"]),
    input: parseDriverHelloInput(value["input"]),
    output: parseDriverHelloOutput(value["output"]),
  };
}

function parseOptionalPendingReady(value: unknown): DriverInstancePendingReady | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new TypeError("Pending Driver ready must be an object.");
  }

  return {
    epoch: parseConnectionEpoch(value["epoch"]),
    input: parseDriverReadyInput(value["input"]),
  };
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
