import type { RunError, SessionRunStatus, SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq, inArray } from "drizzle-orm";

import { logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { finalizeSessionModelCallUsage } from "../../../sessions/infrastructure/session-model-call.repository";
import { createFailedSessionRunRuntimeEvent } from "../../application/session-runs/session-run-view-events.service";
import { repairTerminalSessionRunProjections } from "../../application/session-runs/terminal-run-reconciliation.service";
import {
  isTerminalSessionRunStatus,
  TERMINAL_SESSION_RUN_STATUSES,
} from "../../domain/session-run-lifecycle.machine";
import { classifyReclaim } from "../../domain/session-run-reclaim-recovery";
import { createSessionRunTerminalFailureSourceId } from "../../domain/session-run-terminal-event-id";
import { releaseRuntimeRunLease } from "../runtime-subject-lifecycle/runtime-run-lease-store";
import {
  assertSessionRunTransition,
  getSessionRunSummary,
  setSessionRunStatus,
} from "../session-runs/session-run-store.repository";
import type { RuntimeSessionLink } from "./event-types";
import { getRuntimeSessionLink } from "./session-link.repository";

interface LinkedSessionRunStatusRow {
  readonly sessionId: SessionId;
  readonly sessionRunId: SessionRunId | null;
  readonly status: SessionRunStatus | null;
}

export interface TerminalDriverInstanceSessionRunReleaseResult {
  readonly link: RuntimeSessionLink | null;
  readonly released: boolean;
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
  const link = await getRuntimeSessionLink(database, input.driverInstanceId, {
    sessionRunId: input.sessionRunId,
  });

  await finalizeSessionModelCallUsage(database, input.sessionRunId);

  const released = await releaseRuntimeRunLease(database, {
    driverInstanceId: input.driverInstanceId,
    expectedSessionRunId: input.sessionRunId,
  });

  if (!released) {
    logWarn("runtime.terminal.lease_release_skipped", {
      driverInstanceId: input.driverInstanceId,
      sessionRunId: input.sessionRunId,
    });
  }

  return { link, released };
}

export async function repairFinalizedTerminalDriverRunState(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    status: "failed" | "stopped";
  },
): Promise<TerminalDriverInstanceSessionRunReleaseResult> {
  const link = await getRuntimeSessionLink(bindings.DB, input.driverInstanceId);

  if (link.sessionRunId === null || link.sessionRunStatus === null) {
    // A previous attempt may have committed the terminal Run before its event
    // or lease cleanup. The default link query only returns active Runs.
    return releaseLinkedTerminalDriverInstanceSessionRun(bindings, input.driverInstanceId);
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
    assertSessionRunTransition(outcome, "Finalized driver repair");
    const run = outcome.kind === "applied" || outcome.kind === "duplicate" ? outcome.run : null;

    if (link.sessionId !== null && run !== null) {
      await appendFinalizedDriverRunEvent(bindings, {
        run,
        runError,
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
        sessionId: sessionRunsTable.sessionId,
        sessionRunId: sessionRunsTable.id,
        status: sessionRunsTable.status,
      })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.driverInstanceId, driverInstanceId),
          inArray(sessionRunsTable.status, TERMINAL_SESSION_RUN_STATUSES),
        ),
      )
      .orderBy(desc(sessionRunsTable.id))
      .limit(1)
      .get()) ?? null;

  if (row === null || row.sessionRunId === null || !isTerminalSessionRunStatus(row.status)) {
    return { link: null, released: false };
  }

  const run = await getSessionRunSummary(database, row.sessionRunId);
  if (run !== null) {
    await repairTerminalSessionRunProjections(bindings, {
      preserveSessionLifecycle: true,
      run,
      sessionId: row.sessionId,
    });
  }

  return releaseTerminalDriverInstanceSessionRun(bindings, {
    driverInstanceId,
    sessionRunId: row.sessionRunId,
  });
}
