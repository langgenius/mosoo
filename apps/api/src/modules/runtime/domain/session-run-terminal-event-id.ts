import type { SessionRunId } from "@mosoo/id";
import type { RuntimeEventKind } from "@mosoo/runtime-events";

type TerminalSessionRunEventKind = Extract<
  RuntimeEventKind,
  "run.cancelled" | "run.completed" | "run.failed"
>;

export function createSessionRunTerminalSourceId(
  runId: SessionRunId,
  kind: TerminalSessionRunEventKind,
): string {
  return `session-run-terminal:${runId}:${kind}`;
}

export function createSessionRunTerminalFailureSourceId(runId: SessionRunId): string {
  return createSessionRunTerminalSourceId(runId, "run.failed");
}
