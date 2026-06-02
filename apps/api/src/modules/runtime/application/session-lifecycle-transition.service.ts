import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";
import type { SessionRunId } from "@mosoo/id";

import { setSessionRunStatus } from "../infrastructure/session-runs/session-run-store.repository";

export { createSessionStatusTransitionPatch } from "../infrastructure/session-runs/session-lifecycle-projection.repository";
export type { SessionRunTransitionOutcome } from "../infrastructure/session-runs/session-run-store.repository";

export async function setSystemSessionRunStatus(
  database: D1Database,
  input: {
    error?: RunError | null;
    runId: SessionRunId;
    status: SessionRunStatus;
  },
) {
  return setSessionRunStatus(database, {
    ...(input.error !== undefined ? { error: input.error } : {}),
    runId: input.runId,
    source: "system",
    status: input.status,
  });
}
