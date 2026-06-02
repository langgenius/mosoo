import { parseSchemaValue } from "@mosoo/contracts/validation";
import { DriverNativeRuntimeRef } from "@mosoo/driver-protocol";
import type { DriverNativeRuntimeRef as DriverNativeRuntimeRefValue } from "@mosoo/driver-protocol";
import { readRuntimeEventPayload, readRuntimeEventString } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export function readNativeResumeRef(
  event: RuntimeEventEnvelope,
): DriverNativeRuntimeRefValue | null {
  const payload = readRuntimeEventPayload(event);

  const value = readRuntimeEventString(payload, "resumePointer");

  if (value === null) {
    return null;
  }

  const refShape = readNativeResumeRefShape(event.runtimeId);

  return parseSchemaValue(DriverNativeRuntimeRef, {
    kind: refShape.kind,
    runtimeId: refShape.runtimeId,
    value,
  });
}

function readNativeResumeRefShape(
  runtimeId: string | undefined,
): Pick<DriverNativeRuntimeRefValue, "kind" | "runtimeId"> {
  switch (runtimeId) {
    case "openai-runtime": {
      return {
        kind: "openai_thread_id",
        runtimeId,
      };
    }
    case "claude-agent-sdk": {
      return {
        kind: "claude_session_id",
        runtimeId,
      };
    }
    case "acp-fallback": {
      return {
        kind: "acp_session_id",
        runtimeId,
      };
    }
    default: {
      throw new Error(
        `Unsupported runtime native resume ref runtime id: ${runtimeId ?? "missing"}.`,
      );
    }
  }
}
