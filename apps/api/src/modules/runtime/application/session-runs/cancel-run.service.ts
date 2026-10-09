import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { DriverCommandId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { isTruthy } from "../../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { isTerminalSessionRunStatus } from "../../domain/session-run-lifecycle.machine";
import { sendDriverInstanceCommand } from "../../infrastructure/driver-instance/client";
import { isDriverControlSocketMissingError } from "../../infrastructure/driver-session-stop-errors";
import { expireUndeliveredInputStartCommandsForRun } from "../../infrastructure/session-runs/runtime-command-store.repository";
import { sessionRunSummaryColumns } from "../../infrastructure/session-runs/session-run-read.repository";
import { toSessionRunSummary } from "../../infrastructure/session-runs/session-run-row.mapper";
import {
  getSessionRunSummary,
  setSessionRunStatus,
} from "../../infrastructure/session-runs/session-run-store.repository";
import { createCancelledSessionRunRuntimeEvent } from "./session-run-view-events.service";
interface CancelSessionRunInput {
  runId: SessionRunId;
  sessionId: SessionId;
}

// The caller authorized the Session; the Run id can come from the client, so scope it to that Session.
async function getSessionRun(database: D1Database, input: CancelSessionRunInput) {
  const row =
    (await getAppDatabase(database)
      .select({
        ...sessionRunSummaryColumns(),
        driver_instance_id: sessionRunsTable.driverInstanceId,
      })
      .from(sessionRunsTable)
      .where(
        and(eq(sessionRunsTable.id, input.runId), eq(sessionRunsTable.sessionId, input.sessionId)),
      )
      .limit(1)
      .get()) ?? null;

  return row === null
    ? null
    : { driverInstanceId: row.driver_instance_id, run: toSessionRunSummary(row) };
}

export async function cancelRun(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CancelSessionRunInput,
): Promise<{ run: SessionRunSummary }> {
  const database = bindings.DB;
  const { runId, sessionId } = input;
  const sessionRun = await getSessionRun(database, input);

  if (sessionRun === null) {
    throw new Error("Session run not found.");
  }

  const { driverInstanceId, run: currentRun } = sessionRun;
  const alreadyTerminal = isTerminalSessionRunStatus(currentRun.status);

  if (!alreadyTerminal && isTruthy(driverInstanceId)) {
    const command: RuntimeCommand = {
      commandId: createPlatformId<DriverCommandId>(),
      kind: "turn.cancel",
      reason: "viewer.cancelled",
    };

    try {
      await sendDriverInstanceCommand(bindings, driverInstanceId, command);
    } catch (error) {
      if (!isDriverControlSocketMissingError(error)) {
        throw error;
      }
    }
  }

  const outcome = alreadyTerminal
    ? null
    : await setSessionRunStatus(database, {
        runId,
        source: "viewer",
        status: "cancelled",
      });

  if (isTruthy(driverInstanceId)) {
    await expireUndeliveredInputStartCommandsForRun(database, { driverInstanceId, runId });
  }

  if (outcome === null) {
    logInfo("session.turn.cancel.ignored", {
      driverInstanceId,
      runId,
      sessionId,
      status: currentRun.status,
      traceId: currentRun.traceId,
      viewerId: viewer.id,
    });

    return { run: currentRun };
  }

  if (outcome.kind === "duplicate") {
    return { run: outcome.run };
  }

  if (outcome.kind === "rejected" || outcome.kind === "stale") {
    return { run: (await getSessionRunSummary(database, runId)) ?? currentRun };
  }

  await appendSessionRuntimeEvents({
    bindings,
    events: [
      createCancelledSessionRunRuntimeEvent({
        run: outcome.run,
        sessionId,
        sourceEventId: `viewer-cancel:${runId}:cancelled`,
      }),
    ],
    sessionId,
  });

  logInfo("session.turn.cancelled", {
    driverInstanceId,
    runId,
    sessionId,
    traceId: currentRun.traceId,
    viewerId: viewer.id,
  });

  return { run: outcome.run };
}
