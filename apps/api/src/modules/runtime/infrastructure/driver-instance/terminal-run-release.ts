import type { RunError, SessionRunStatus, SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { createFailedSessionRunRuntimeEvent } from "../../application/session-runs/session-run-view-events.service";
import { classifyReclaim, decideReclaimRecovery } from "../../domain/session-run-reclaim-recovery";
import { isTerminalSessionRunStatus } from "../../domain/session-run-status";
import { createSessionRunTerminalFailureSourceId } from "../../domain/session-run-terminal-event-id";
import { recordRuntimeRunLeaseReleasedOutcome } from "../runtime-subject-lifecycle/runtime-run-lease-store";
import { failAcceptedRuntimeCommandsForTerminalDriver } from "../session-runs/runtime-command-store.repository";
import { setSessionRunStatus } from "../session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../session-runs/session-run-store.repository";
import type { RuntimeSessionLink } from "./event-types";
import { getRuntimeSessionLink } from "./session-link.repository";
import { closeReleasedTerminalRuntimeLeaseIfNeeded } from "./terminal-runtime-lease";

interface LinkedSessionRunStatusRow {
  readonly sessionRunId: SessionRunId | null;
  readonly status: SessionRunStatus | null;
}

export interface TerminalDriverInstanceSessionRunReleaseResult {
  readonly link: RuntimeSessionLink | null;
  readonly released: boolean;
}

function toFinalizedDriverRunTransitionRun(
  outcome: SessionRunTransitionOutcome,
): SessionRunSummary | null {
  switch (outcome.kind) {
    case "applied":
    case "duplicate": {
      return outcome.run;
    }
    case "stale": {
      if (outcome.reason === "terminal_run") {
        return null;
      }
      throw new Error("Finalized driver repair lost a concurrent run transition.");
    }
    case "repair_needed": {
      throw new Error("Finalized driver repair left the session lifecycle projection stale.");
    }
    case "rejected": {
      throw new Error(`Finalized driver repair run transition was rejected: ${outcome.reason}.`);
    }
  }
}

async function appendFinalizedDriverRunEvent(
  bindings: ApiBindings,
  input: {
    readonly run: SessionRunSummary;
    readonly runError: RunError;
    readonly sessionId: SessionId;
  },
): Promise<void> {
  await appendSessionRuntimeEvents({
    bindings,
    events: [
      createFailedSessionRunRuntimeEvent({
        run: input.run,
        runError: input.runError,
        sessionId: input.sessionId,
        sourceEventId: createSessionRunTerminalFailureSourceId(input.run.id),
      }),
    ],
    sessionId: input.sessionId,
  });
}

export async function releaseTerminalDriverInstanceSessionRun(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    sessionRunId: SessionRunId;
  },
): Promise<TerminalDriverInstanceSessionRunReleaseResult> {
  const database = bindings.DB;
  const link = await getRuntimeSessionLink(database, input.driverInstanceId);
  const outcome = await recordRuntimeRunLeaseReleasedOutcome(database, {
    driverInstanceId: input.driverInstanceId,
    expectedSessionRunId: input.sessionRunId,
  });
  const released = outcome.status === "applied";

  if (!released) {
    logWarn("runtime.terminal.lease_release_skipped", {
      driverInstanceId: input.driverInstanceId,
      reason: "reason" in outcome ? outcome.reason : outcome.status,
      sessionRunId: input.sessionRunId,
      status: outcome.status,
    });
  }

  await closeReleasedTerminalRuntimeLeaseIfNeeded(bindings, { link, released });

  return { link, released };
}

export async function repairFinalizedTerminalDriverRunState(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    status: "failed" | "stopped";
  },
): Promise<TerminalDriverInstanceSessionRunReleaseResult> {
  await failAcceptedRuntimeCommandsForTerminalDriver(bindings.DB, {
    driverInstanceId: input.driverInstanceId,
  });

  const link = await getRuntimeSessionLink(bindings.DB, input.driverInstanceId);

  if (link.sessionRunId === null || link.sessionRunStatus === null) {
    return { link, released: false };
  }

  if (!isTerminalSessionRunStatus(link.sessionRunStatus)) {
    const runError = classifyReclaim({
      driverInstanceId: input.driverInstanceId,
      driverTerminalStatus: input.status,
      reclaimReason: "socket_closed",
    });
    const outcome = await setSessionRunStatus(bindings.DB, {
      error: runError,
      runId: link.sessionRunId,
      source: "driver",
      status: "failed",
    });
    const run = toFinalizedDriverRunTransitionRun(outcome);

    if (link.sessionId !== null && run !== null) {
      await appendFinalizedDriverRunEvent(bindings, {
        run,
        runError,
        sessionId: link.sessionId,
      });

      // Decide recovery for the reclaimed run. v1 records the decision so it is
      // observable and unit-testable; executing the auto-requeue (a fresh
      // `resume` run + re-dispatch) is a follow-up because this DO finalize
      // context lacks the viewer + requestUrl that enqueueSessionRunDispatchCommand
      // needs to rebuild the sandbox's action-token callback URLs.
      const recovery = decideReclaimRecovery({
        driverTerminalStatus: input.status,
        priorTrigger: run.trigger,
        reclaimReason: "socket_closed",
        runStatus: link.sessionRunStatus,
      });
      logInfo("runtime.reclaim.recovery.decided", {
        action: recovery.kind,
        driverInstanceId: input.driverInstanceId,
        priorTrigger: run.trigger,
        runId: run.id,
        sessionId: link.sessionId,
      });
    }
  }

  return releaseTerminalDriverInstanceSessionRun(bindings, {
    driverInstanceId: input.driverInstanceId,
    sessionRunId: link.sessionRunId,
  });
}

export async function releaseLinkedTerminalDriverInstanceSessionRun(
  bindings: ApiBindings,
  driverInstanceId: DriverInstanceId,
): Promise<TerminalDriverInstanceSessionRunReleaseResult> {
  const database = bindings.DB;
  const row: LinkedSessionRunStatusRow | null =
    (await getAppDatabase(database)
      .select({
        sessionRunId: sessionRunsTable.id,
        status: sessionRunsTable.status,
      })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.driverInstanceId, driverInstanceId),
          inArray(sessionRunsTable.status, ["cancelled", "completed", "expired", "failed"]),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null || row.sessionRunId === null || !isTerminalSessionRunStatus(row.status)) {
    return { link: null, released: false };
  }

  return releaseTerminalDriverInstanceSessionRun(bindings, {
    driverInstanceId,
    sessionRunId: row.sessionRunId,
  });
}
