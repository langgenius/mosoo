import type { SessionRunId } from "@mosoo/id";

export function createSessionRunTerminalFailureSourceId(runId: SessionRunId): string {
  return `session-run-terminal:${runId}:run.failed`;
}
