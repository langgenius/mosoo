import type { RunError } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  DriverCommandId,
  DriverInstanceId,
  RuntimeEventId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { and, asc, inArray, lte, sql } from "drizzle-orm";

import { createErrorLogContext, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { SESSION_RUN_TIME_LIMIT_MS } from "../../domain/session-runtime-policy";
import { sendDriverInstanceCommand } from "../../infrastructure/driver-instance/client";
import { isDriverControlSocketMissingError } from "../../infrastructure/driver-session-stop-errors";
import { recordRuntimeRunLeaseReleasedOutcome } from "../../infrastructure/runtime-subject-lifecycle/runtime-run-lease-store";
import { expireUndeliveredInputStartCommandsForRun } from "../../infrastructure/session-runs/runtime-command-store.repository";
import { setSessionRunStatus } from "../../infrastructure/session-runs/session-run-store.repository";
import { createCancelledSessionRunRuntimeEvent } from "./session-run-view-events.service";

const ACTIVE_SESSION_RUN_STATUSES = ["queued", "booting", "running", "waiting_input"] as const;

export const SESSION_RUN_TIME_LIMIT_ERROR = {
  code: "run.time_limit_exceeded",
  details: { limitMs: SESSION_RUN_TIME_LIMIT_MS },
  message: `This turn reached the ${SESSION_RUN_TIME_LIMIT_MS / 3_600_000}-hour limit and was stopped.`,
  retryable: false,
} as const satisfies RunError;

interface OverdueSessionRun {
  readonly driverInstanceId: DriverInstanceId | null;
  readonly runId: SessionRunId;
  readonly sessionId: SessionId;
  readonly traceId: string;
}

async function findOverdueSessionRuns(
  database: D1Database,
  input: { readonly limit: number; readonly nowMs: number },
): Promise<OverdueSessionRun[]> {
  const runStartedAt = sql<number>`COALESCE(${sessionRunsTable.startedAt}, ${sessionRunsTable.createdAt})`;

  return getAppDatabase(database)
    .select({
      driverInstanceId: sessionRunsTable.driverInstanceId,
      runId: sessionRunsTable.id,
      sessionId: sessionRunsTable.sessionId,
      traceId: sessionRunsTable.traceId,
    })
    .from(sessionRunsTable)
    .where(
      and(
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        lte(runStartedAt, input.nowMs - SESSION_RUN_TIME_LIMIT_MS),
      ),
    )
    .orderBy(asc(runStartedAt), asc(sessionRunsTable.id))
    .limit(input.limit)
    .all();
}

async function requestDriverTurnCancel(
  bindings: ApiBindings,
  run: OverdueSessionRun & { readonly driverInstanceId: DriverInstanceId },
): Promise<void> {
  try {
    await sendDriverInstanceCommand(bindings, run.driverInstanceId, {
      commandId: createPlatformId<DriverCommandId>(),
      kind: "turn.cancel",
      reason: SESSION_RUN_TIME_LIMIT_ERROR.code,
    });
  } catch (error) {
    // A hung driver is the usual reason a turn runs this long. Ending the run
    // and its lease below still lets reclamation destroy the container.
    if (!isDriverControlSocketMissingError(error)) {
      logWarn("session.run.time_limit.cancel_command_failed", {
        ...createErrorLogContext(error),
        driverInstanceId: run.driverInstanceId,
        runId: run.runId,
      });
    }
  }
}

// Ending the run alone leaves the subject without an inactive deadline; only
// the lease release re-arms it for reclamation.
async function releaseOverdueRunLease(
  database: D1Database,
  run: OverdueSessionRun & { readonly driverInstanceId: DriverInstanceId },
): Promise<void> {
  const outcome = await recordRuntimeRunLeaseReleasedOutcome(database, {
    driverInstanceId: run.driverInstanceId,
    expectedSessionRunId: run.runId,
  });

  if (outcome.status !== "applied") {
    logWarn("runtime.terminal.lease_release_skipped", {
      driverInstanceId: run.driverInstanceId,
      reason: "reason" in outcome ? outcome.reason : outcome.status,
      sessionRunId: run.runId,
      source: "run_time_limit",
      status: outcome.status,
    });
  }
}

async function stopOverdueSessionRun(
  bindings: ApiBindings,
  run: OverdueSessionRun,
): Promise<boolean> {
  const { driverInstanceId } = run;

  if (driverInstanceId !== null) {
    await requestDriverTurnCancel(bindings, { ...run, driverInstanceId });
  }

  const outcome = await setSessionRunStatus(bindings.DB, {
    error: SESSION_RUN_TIME_LIMIT_ERROR,
    runId: run.runId,
    source: "maintenance",
    status: "cancelled",
  });

  if (outcome.kind === "repair_needed") {
    throw new Error("Run time limit left the session lifecycle projection stale.");
  }

  if (outcome.kind === "rejected" || outcome.kind === "stale") {
    return false;
  }

  if (driverInstanceId !== null) {
    await expireUndeliveredInputStartCommandsForRun(bindings.DB, {
      driverInstanceId,
      runId: run.runId,
    });
    await releaseOverdueRunLease(bindings.DB, { ...run, driverInstanceId });
  }

  if (outcome.kind === "duplicate") {
    return false;
  }

  await appendSessionRuntimeEvents({
    bindings,
    events: [
      createCancelledSessionRunRuntimeEvent({
        eventId: createPlatformId<RuntimeEventId>(),
        run: outcome.run,
        runError: SESSION_RUN_TIME_LIMIT_ERROR,
        sessionId: run.sessionId,
        sourceEventId: `time-limit:${run.runId}:cancelled`,
      }),
    ],
    sessionId: run.sessionId,
  });

  logInfo("session.run.time_limit_exceeded", {
    driverInstanceId,
    limitMs: SESSION_RUN_TIME_LIMIT_MS,
    runId: run.runId,
    sessionId: run.sessionId,
    traceId: run.traceId,
  });

  return true;
}

/**
 * Cancels turns that have run past the time limit, the same way a viewer
 * cancellation ends them: history and saved outputs stay, while the stopped
 * turn does not advance the workspace checkpoint.
 */
export async function stopOverdueSessionRuns(
  bindings: ApiBindings,
  input: { readonly limit: number; readonly nowMs: number },
): Promise<SessionRunId[]> {
  const stoppedRunIds: SessionRunId[] = [];

  for (const run of await findOverdueSessionRuns(bindings.DB, input)) {
    try {
      if (await stopOverdueSessionRun(bindings, run)) {
        stoppedRunIds.push(run.runId);
      }
    } catch (error) {
      logWarn("session.run.time_limit.stop_failed", {
        ...createErrorLogContext(error),
        runId: run.runId,
        sessionId: run.sessionId,
      });
    }
  }

  return stoppedRunIds;
}
