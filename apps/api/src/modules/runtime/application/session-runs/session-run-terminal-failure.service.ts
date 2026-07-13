import type { RunError } from "@mosoo/contracts/session-run";
import type { SessionId, SessionRunId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { createSessionRunTerminalFailureSourceId } from "../../domain/session-run-terminal-event-id";
import {
  getSessionRunSummary,
  setSessionRunStatus,
} from "../../infrastructure/session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../../infrastructure/session-runs/session-run-store.repository";
import { createFailedSessionRunRuntimeEvent } from "./session-run-view-events.service";

export type CanonicalSessionRunFailureOutcome =
  | {
      kind: "failed";
    }
  | {
      kind: "not_failed";
      transition: SessionRunTransitionOutcome;
    }
  | {
      kind: "repair_needed";
      transition: Extract<SessionRunTransitionOutcome, { kind: "repair_needed" }>;
    };

export async function recordCanonicalSessionRunFailure(
  bindings: ApiBindings,
  input: {
    error: RunError;
    runId: SessionRunId;
    sessionId: SessionId;
    source: "api" | "driver";
  },
): Promise<CanonicalSessionRunFailureOutcome> {
  const outcome = await setSessionRunStatus(bindings.DB, {
    error: input.error,
    runId: input.runId,
    source: input.source,
    status: "failed",
  });

  if (outcome.kind === "repair_needed") {
    return { kind: "repair_needed", transition: outcome };
  }

  const run =
    outcome.kind === "applied" || outcome.kind === "duplicate"
      ? outcome.run
      : await getSessionRunSummary(bindings.DB, input.runId);

  if (run?.status !== "failed" || run.error === null) {
    return { kind: "not_failed", transition: outcome };
  }

  await appendSessionRuntimeEvents({
    bindings,
    events: [
      createFailedSessionRunRuntimeEvent({
        run,
        runError: run.error,
        sessionId: input.sessionId,
        sourceEventId: createSessionRunTerminalFailureSourceId(input.runId),
      }),
    ],
    sessionId: input.sessionId,
  });

  return { kind: "failed" };
}
