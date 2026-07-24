import type { DriverNativeRuntimeRef } from "@mosoo/agent-driver/runtime";
import { parseDriverNativeRuntimeRef } from "@mosoo/agent-driver/runtime";
import { readRuntimeEventPayload, readRuntimeEventString } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export function readNativeResumeRef(event: RuntimeEventEnvelope): DriverNativeRuntimeRef | null {
  const payload = readRuntimeEventPayload(event);

  const value = readRuntimeEventString(payload, "resumePointer");

  if (value === null) {
    return null;
  }

  const refShape = readNativeResumeRefShape(event.runtimeId);

  return parseDriverNativeRuntimeRef({
    kind: refShape.kind,
    runtimeId: refShape.runtimeId,
    value,
  });
}

function readNativeResumeRefShape(
  runtimeId: string | undefined,
): Pick<DriverNativeRuntimeRef, "kind" | "runtimeId"> {
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
