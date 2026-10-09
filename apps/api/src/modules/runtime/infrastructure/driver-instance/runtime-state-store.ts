import type { DriverHeartbeatInput, DriverReadyInput } from "@mosoo/agent-driver/orpc";
import type { DriverInstanceId } from "@mosoo/id";

import type { DriverHelloInput } from "./rpc-wire";
import type { DriverInstanceCloseSnapshot } from "./state";

export const DRIVER_INSTANCE_STATE_STORAGE_KEY = "driverInstanceState";
export const DRIVER_FINALIZATION_RETRY_MS = 5_000;

export interface DriverInstanceStoredState {
  close: DriverInstanceCloseSnapshot | null;
  connectionId: string | null;
  driverGeneration: number | null;
  driverInstanceId: DriverInstanceId | null;
  errorMessage: string | null;
  finalizationCompleted: boolean;
  heartbeatCount: number;
  hello: DriverHelloInput | null;
  lastHeartbeat: DriverHeartbeatInput | null;
  ready: DriverReadyInput | null;
  traceId: string | null;
}

interface DriverInstanceRuntimeStorage {
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export interface DriverInstanceRuntimeStateContext {
  readonly storage: DriverInstanceRuntimeStorage;
}

export function createEmptyStoredState(): DriverInstanceStoredState {
  return {
    close: null,
    connectionId: null,
    driverGeneration: null,
    driverInstanceId: null,
    errorMessage: null,
    finalizationCompleted: false,
    heartbeatCount: 0,
    hello: null,
    lastHeartbeat: null,
    ready: null,
    traceId: null,
  };
}
