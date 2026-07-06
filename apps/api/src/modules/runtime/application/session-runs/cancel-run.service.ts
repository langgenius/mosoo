import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionRunsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  DriverCommandId,
  DriverInstanceId,
  AppId,
  RuntimeEventId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { isTruthy } from "../../../../shared/truthiness";
import { ensureAppOwnership } from "../../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { sessionParticipantCondition } from "../../../sessions/domain/session-access.policy";
import { sendDriverInstanceCommand } from "../../infrastructure/driver-instance/client";
import { isDriverControlSocketMissingError } from "../../infrastructure/driver-session-stop-errors";
import { expireUndeliveredInputStartCommandsForRun } from "../../infrastructure/session-runs/runtime-command-store.repository";
import { toSessionRunSummary } from "../../infrastructure/session-runs/session-run-row.mapper";
import type { SessionRunRow } from "../../infrastructure/session-runs/session-run-row.mapper";
import {
  getSessionRunSummary,
  setSessionRunStatus,
} from "../../infrastructure/session-runs/session-run-store.repository";
import { createCancelledSessionRunRuntimeEvent } from "./session-run-view-events.service";
interface CancelSessionRunInput {
  appId: AppId;
  runId: SessionRunId;
  sessionId: SessionId;
}

async function getOwnedSessionRun(
  database: D1Database,
  viewerId: AccountId,
  input: CancelSessionRunInput,
): Promise<{
  driverInstanceId: DriverInstanceId | null;
  run: SessionRunSummary;
  sessionId: SessionId;
} | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        completed_at: sessionRunsTable.completedAt,
        created_at: sessionRunsTable.createdAt,
        deployment_version_id: sessionRunsTable.deploymentVersionId,
        deployment_version_number: sessionRunsTable.deploymentVersionNumber,
        driver_instance_id: sessionRunsTable.driverInstanceId,
        error_code: sessionRunsTable.errorCode,
        error_details_json: sessionRunsTable.errorDetailsJson,
        error_message: sessionRunsTable.errorMessage,
        id: sessionRunsTable.id,
        model: sessionRunsTable.model,
        provider: sessionRunsTable.provider,
        session_id: sessionRunsTable.sessionId,
        started_at: sessionRunsTable.startedAt,
        status: sessionRunsTable.status,
        trace_id: sessionRunsTable.traceId,
        trigger: sessionRunsTable.trigger,
        updated_at: sessionRunsTable.updatedAt,
      })
      .from(sessionRunsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .where(
        and(
          eq(sessionRunsTable.id, input.runId),
          eq(sessionRunsTable.sessionId, input.sessionId),
          eq(sessionsTable.appId, input.appId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    driverInstanceId: row.driver_instance_id,
    run: toSessionRunSummary(row satisfies SessionRunRow),
    sessionId: row.session_id,
  };
}

export async function cancelRun(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CancelSessionRunInput,
): Promise<{ run: SessionRunSummary }> {
  const database = bindings.DB;
  const runId = parsePlatformId<SessionRunId>(input.runId, "run id");
  const sessionId = parsePlatformId<SessionId>(input.sessionId, "session id");
  const appId = parsePlatformId<AppId>(input.appId, "app id");
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer id");
  await ensureAppOwnership(database, viewerId, appId);
  const run = await getOwnedSessionRun(database, viewerId, { appId, runId, sessionId });

  if (run === null) {
    throw new Error("Session run not found.");
  }

  const currentRun = run.run;

  if (
    currentRun.status === "completed" ||
    currentRun.status === "failed" ||
    currentRun.status === "cancelled" ||
    currentRun.status === "expired"
  ) {
    logInfo("session.turn.cancel.ignored", {
      driverInstanceId: run.driverInstanceId,
      runId,
      sessionId: run.sessionId,
      status: currentRun.status,
      traceId: currentRun.traceId,
      viewerId: viewer.id,
    });

    if (isTruthy(run.driverInstanceId)) {
      await expireUndeliveredInputStartCommandsForRun(database, {
        driverInstanceId: run.driverInstanceId,
        runId,
      });
    }

    return {
      run: currentRun,
    };
  }

  if (isTruthy(run.driverInstanceId)) {
    const command: RuntimeCommand = {
      commandId: createPlatformId<DriverCommandId>(),
      kind: "turn.cancel",
      reason: "viewer.cancelled",
    };

    try {
      await sendDriverInstanceCommand(bindings, run.driverInstanceId, command);
    } catch (error) {
      if (!isDriverControlSocketMissingError(error)) {
        throw error;
      }
    }
  }

  const outcome = await setSessionRunStatus(database, {
    runId,
    source: "viewer",
    status: "cancelled",
  });

  if (outcome.kind === "repair_needed") {
    throw new Error("Session lifecycle projection needs repair.");
  }

  if (outcome.kind === "duplicate") {
    if (isTruthy(run.driverInstanceId)) {
      await expireUndeliveredInputStartCommandsForRun(database, {
        driverInstanceId: run.driverInstanceId,
        runId,
      });
    }

    return {
      run: outcome.run,
    };
  }

  if (outcome.kind === "rejected" || outcome.kind === "stale") {
    const latestRun = await getSessionRunSummary(database, runId);

    return {
      run: latestRun ?? currentRun,
    };
  }

  const updatedRun = outcome.run;

  if (isTruthy(run.driverInstanceId)) {
    await expireUndeliveredInputStartCommandsForRun(database, {
      driverInstanceId: run.driverInstanceId,
      runId,
    });
  }

  const cancelledEvent = createCancelledSessionRunRuntimeEvent({
    eventId: createPlatformId<RuntimeEventId>(),
    run: updatedRun,
    sessionId: run.sessionId,
    sourceEventId: `viewer-cancel:${runId}:cancelled`,
  });
  await appendSessionRuntimeEvents({
    bindings,
    events: [cancelledEvent],
    sessionId: run.sessionId,
  });

  logInfo("session.turn.cancelled", {
    driverInstanceId: run.driverInstanceId,
    runId,
    sessionId: run.sessionId,
    traceId: currentRun.traceId,
    viewerId: viewer.id,
  });

  return {
    run: updatedRun,
  };
}
