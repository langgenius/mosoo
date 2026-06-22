import type { RunError, SessionRunStatus, SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { createFailedSessionRunRuntimeEvent } from "../../application/session-runs/session-run-view-events.service";
import { isTerminalSessionRunStatus } from "../../domain/session-run-status";
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

function createFinalizedDriverRunError(input: {
  readonly driverInstanceId: DriverInstanceId;
  readonly status: "failed" | "stopped";
}): RunError {
  if (input.status === "stopped") {
    return {
      code: "runtime.turn_interrupted",
      details: {
        driverInstanceId: input.driverInstanceId,
      },
      message: "本轮已中断。工作区和上下文已保留，请重新发送刚才的请求。",
      retryable: true,
    };
  }

  return {
    code: "runtime.driver_failed",
    details: {
      driverInstanceId: input.driverInstanceId,
    },
    message: "Runtime driver failed before the run completed.",
    retryable: true,
  };
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

function finalizedDriverRunSourceEventId(input: {
  readonly driverInstanceId: DriverInstanceId;
  readonly sessionRunId: SessionRunId;
}): string {
  return `driver-terminal:${input.driverInstanceId}:${input.sessionRunId}:turn-interrupted`;
}

async function appendFinalizedDriverRunEvent(
  bindings: ApiBindings,
  input: {
    readonly driverInstanceId: DriverInstanceId;
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
        sourceEventId: finalizedDriverRunSourceEventId({
          driverInstanceId: input.driverInstanceId,
          sessionRunId: input.run.id,
        }),
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
    const runError = createFinalizedDriverRunError(input);
    const outcome = await setSessionRunStatus(bindings.DB, {
      error: runError,
      runId: link.sessionRunId,
      source: "driver",
      status: "failed",
    });
    const run = toFinalizedDriverRunTransitionRun(outcome);

    if (link.sessionId !== null && run !== null) {
      await appendFinalizedDriverRunEvent(bindings, {
        driverInstanceId: input.driverInstanceId,
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
