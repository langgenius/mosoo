import { RUNTIME_RUN_RETENTION_MS } from "../../domain/runtime-config";

export type { DriverInstanceStatus } from "@mosoo/contracts/sandbox";

export function parseDriverTimestampMs(value: string, label: string): number {
  const timestampMs = Date.parse(value);

  if (Number.isNaN(timestampMs)) {
    throw new TypeError(`${label} is invalid.`);
  }

  return timestampMs;
}

export function driverInstanceExpiresAt(timestampMs: number): number {
  return timestampMs + RUNTIME_RUN_RETENTION_MS;
}
