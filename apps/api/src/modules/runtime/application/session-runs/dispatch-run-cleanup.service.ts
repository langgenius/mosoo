import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";

import { logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { stopDriverSession } from "../../infrastructure/driver-session.service";
import { createRuntimeSubjectLifecycleService } from "../../infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { expireUndeliveredInputStartCommandsForRun } from "../../infrastructure/session-runs/runtime-command-store.repository";

export async function cleanupDispatchedDriver(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    reason: string;
    runId: SessionRunId;
    sessionId: SessionId;
    traceId: string;
  },
): Promise<void> {
  try {
    await expireUndeliveredInputStartCommandsForRun(bindings.DB, {
      driverInstanceId: input.driverInstanceId,
      runId: input.runId,
    });
    await stopDriverSession(bindings, {
      driverInstanceId: input.driverInstanceId,
      reason: input.reason,
    });
  } catch (error) {
    const cleanupMessage =
      error instanceof Error ? error.message : "Runtime driver cleanup failed.";

    try {
      await createRuntimeSubjectLifecycleService(bindings).releaseRunLease({
        driverInstanceId: input.driverInstanceId,
        expectedSessionRunId: input.runId,
      });
    } catch (releaseError) {
      logWarn("session.run.driver.release.failed", {
        cleanupMessage:
          releaseError instanceof Error ? releaseError.message : "Runtime driver release failed.",
        driverInstanceId: input.driverInstanceId,
        runId: input.runId,
        sessionId: input.sessionId,
        traceId: input.traceId,
      });
    }

    logWarn("session.run.driver.cleanup.failed", {
      cleanupMessage,
      driverInstanceId: input.driverInstanceId,
      runId: input.runId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    });
  }
}
