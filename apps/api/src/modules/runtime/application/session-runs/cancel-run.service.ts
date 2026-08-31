import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { driverInstancesTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { sleepPromise } from "@mosoo/effects";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  DriverCommandId,
  DriverInstanceId,
  ProjectId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { isTruthy } from "../../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../../projects/application/project.service";
import { sessionParticipantCondition } from "../../../sessions/domain/session-access.policy";
import { RUNTIME_SOCKET_TIMEOUT_MS } from "../../domain/runtime-config";
import { sendDriverInstanceCommand } from "../../infrastructure/driver-instance/client";
import { isDriverControlSocketMissingError } from "../../infrastructure/driver-session-stop-errors";
import { stopDriverSession } from "../../infrastructure/driver-session-stop.service";
import { expireUndeliveredInputStartCommandsForRun } from "../../infrastructure/session-runs/runtime-command-store.repository";
import { toSessionRunSummary } from "../../infrastructure/session-runs/session-run-row.mapper";
import type { SessionRunRow } from "../../infrastructure/session-runs/session-run-row.mapper";
import { getSessionRunSummary } from "../../infrastructure/session-runs/session-run-store.repository";
import { recordCanonicalSessionRunTerminal } from "./session-run-terminal-failure.service";

const RUN_CANCEL_POLL_MS = 100;
interface CancelSessionRunInput {
  projectId: ProjectId;
  runId: SessionRunId;
  sessionId: SessionId;
}

async function getOwnedSessionRun(
  database: D1Database,
  viewerId: AccountId,
  input: CancelSessionRunInput,
): Promise<{
  driverConnectionId: string | null;
  driverGeneration: number | null;
  driverInstanceId: DriverInstanceId | null;
  driverLastHeartbeatAt: number | null;
  driverStatus: string | null;
  driverUpdatedAt: number | null;
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
        driver_connection_id: driverInstancesTable.connectionId,
        driver_generation: driverInstancesTable.generation,
        driver_instance_id: sessionRunsTable.driverInstanceId,
        driver_last_heartbeat_at: driverInstancesTable.lastHeartbeatAt,
        driver_status: driverInstancesTable.status,
        driver_updated_at: driverInstancesTable.updatedAt,
        error_code: sessionRunsTable.errorCode,
        error_details_json: sessionRunsTable.errorDetailsJson,
        error_message: sessionRunsTable.errorMessage,
        error_retryable: sessionRunsTable.errorRetryable,
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
      .leftJoin(
        driverInstancesTable,
        eq(driverInstancesTable.id, sessionRunsTable.driverInstanceId),
      )
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .where(
        and(
          eq(sessionRunsTable.id, input.runId),
          eq(sessionRunsTable.sessionId, input.sessionId),
          eq(sessionsTable.projectId, input.projectId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    driverConnectionId: row.driver_connection_id,
    driverGeneration: row.driver_generation,
    driverInstanceId: row.driver_instance_id,
    driverLastHeartbeatAt: row.driver_last_heartbeat_at,
    driverStatus: row.driver_status,
    driverUpdatedAt: row.driver_updated_at,
    run: toSessionRunSummary(row satisfies SessionRunRow),
    sessionId: row.session_id,
  };
}

async function waitForDriverTerminalRun(
  database: D1Database,
  runId: SessionRunId,
): Promise<SessionRunSummary> {
  const deadline = Date.now() + RUNTIME_SOCKET_TIMEOUT_MS;

  while (true) {
    const run = await getSessionRunSummary(database, runId);
    if (run === null) {
      throw new Error("Session run disappeared while waiting for cancellation.");
    }
    if (
      run.status === "cancelled" ||
      run.status === "completed" ||
      run.status === "expired" ||
      run.status === "failed"
    ) {
      return run;
    }
    if (Date.now() >= deadline) {
      throw new Error("Driver did not settle the run cancellation before the control timeout.");
    }
    await sleepPromise(RUN_CANCEL_POLL_MS);
  }
}

export async function cancelRun(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CancelSessionRunInput,
): Promise<{ run: SessionRunSummary }> {
  const database = bindings.DB;
  const runId = parsePlatformId<SessionRunId>(input.runId, "run id");
  const sessionId = parsePlatformId<SessionId>(input.sessionId, "session id");
  const projectId = parsePlatformId<ProjectId>(input.projectId, "project id");
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer id");
  await ensureProjectOwnership(database, viewerId, projectId);
  const run = await getOwnedSessionRun(database, viewerId, { projectId, runId, sessionId });

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

  let driverTerminalRun: SessionRunSummary | null = null;
  let requiresSyntheticCancellation =
    !isTruthy(run.driverInstanceId) || run.driverGeneration === null;

  if (!requiresSyntheticCancellation && run.driverInstanceId && run.driverGeneration !== null) {
    const command: RuntimeCommand = {
      commandId: createPlatformId<DriverCommandId>(),
      kind: "turn.cancel",
      reason: "viewer.cancelled",
      runId,
    };

    try {
      await sendDriverInstanceCommand(
        bindings,
        run.driverInstanceId,
        run.driverGeneration,
        command,
      );
      driverTerminalRun = await waitForDriverTerminalRun(database, runId);
    } catch (error) {
      if (!isDriverControlSocketMissingError(error)) {
        throw error;
      }
      requiresSyntheticCancellation = true;
    }
  }

  const outcome = requiresSyntheticCancellation
    ? await recordCanonicalSessionRunTerminal(bindings, {
        assistantMessage: null,
        error: null,
        ...(run.driverGeneration === null || run.driverInstanceId === null
          ? {}
          : {
              expectedDriverObservation: {
                connectionId: run.driverConnectionId,
                driverInstanceId: run.driverInstanceId,
                generation: run.driverGeneration,
                lastHeartbeatAt: run.driverLastHeartbeatAt,
                status: run.driverStatus,
                updatedAt: run.driverUpdatedAt,
              },
            }),
        runId,
        sessionId: run.sessionId,
        source: "viewer",
        status: "cancelled",
      })
    : null;

  if (
    outcome?.kind === "committed" &&
    run.driverInstanceId !== null &&
    run.driverGeneration !== null
  ) {
    await stopDriverSession(bindings, {
      driverInstanceId: run.driverInstanceId,
      expectedDriverGeneration: run.driverGeneration,
      expectedSessionRunId: runId,
      reason: "viewer.cancelled",
    });
  }

  if (isTruthy(run.driverInstanceId)) {
    await expireUndeliveredInputStartCommandsForRun(database, {
      driverInstanceId: run.driverInstanceId,
      runId,
    });
  }

  if (outcome?.kind === "stale") {
    return { run: outcome.run };
  }

  logInfo("session.turn.cancelled", {
    driverInstanceId: run.driverInstanceId,
    runId,
    sessionId: run.sessionId,
    traceId: currentRun.traceId,
    viewerId: viewer.id,
  });

  return {
    run: outcome?.run ?? driverTerminalRun ?? currentRun,
  };
}
