import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";
import { isSupportedDriverRuntime } from "agent-driver/runtime";
import type { DriverRuntime } from "agent-driver/runtime";

export const DRIVER_BOOT_TOKEN_TTL_MS = 60_000;
export const RUNTIME_ACTION_TOKEN_TTL_MS = 10 * 60_000;
export const DRIVER_HEARTBEAT_INTERVAL_MS = 1000;
export const RUNTIME_RUN_RETENTION_MS = 24 * 60 * 60 * 1000;
export const RUNTIME_SOCKET_TIMEOUT_MS = 30_000;
export const DRIVER_COLD_READY_TIMEOUT_MS = 120_000;

export function getSupportedRuntimeId(runtimeId: string): DriverRuntime | null {
  const entry = getRuntimeCatalogEntry(runtimeId);

  if (entry === null) {
    return null;
  }

  if (!isSupportedDriverRuntime(entry.runtimeId)) {
    return null;
  }

  return entry.runtimeId;
}
