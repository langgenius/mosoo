import type { SessionRunId } from "@mosoo/id";
import { createSessionRunTerminalSourceId } from "@mosoo/runtime-events";

export { createSessionRunTerminalSourceId };

export function createSessionRunTerminalFailureSourceId(runId: SessionRunId): string {
  return createSessionRunTerminalSourceId(runId, "run.failed");
}
