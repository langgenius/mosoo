import { isSupportedDriverRuntime } from "@mosoo/agent-driver/runtime";
import type { DriverRuntime } from "@mosoo/agent-driver/runtime";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

export const DRIVER_BOOT_TOKEN_TTL_MS = 60_000;
export const RUNTIME_ACTION_TOKEN_TTL_MS = 10 * 60_000;
// Every heartbeat is a billed Durable Object WebSocket invocation, a log event
// and a D1 write. Staleness compares the persisted heartbeat against
// RUNTIME_SOCKET_TIMEOUT_MS, which still tolerates two missed beats.
export const DRIVER_HEARTBEAT_INTERVAL_MS = 10_000;
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
