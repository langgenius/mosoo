import type { DriverNativeRuntimeRef } from "@mosoo/agent-driver/runtime";
import {
  getExpectedDriverNativeRuntimeRefKind,
  isSupportedDriverRuntime,
} from "@mosoo/agent-driver/runtime";
import { readRuntimeEventPayload, readRuntimeEventString } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export function readNativeResumeRef(event: RuntimeEventEnvelope): DriverNativeRuntimeRef | null {
  const value = readRuntimeEventString(readRuntimeEventPayload(event), "resumePointer");

  if (value === null) {
    return null;
  }

  const { runtimeId } = event;

  if (runtimeId === undefined || !isSupportedDriverRuntime(runtimeId)) {
    throw new Error(`Unsupported runtime native resume ref runtime id: ${runtimeId ?? "missing"}.`);
  }

  return { kind: getExpectedDriverNativeRuntimeRefKind(runtimeId), runtimeId, value };
}
