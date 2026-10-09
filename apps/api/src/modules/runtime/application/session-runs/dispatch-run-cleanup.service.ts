import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";

import { logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { stopDriverSession } from "../../infrastructure/driver-session-stop.service";
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
    logWarn("session.run.driver.cleanup.failed", {
      cleanupMessage: error instanceof Error ? error.message : "Runtime driver cleanup failed.",
      driverInstanceId: input.driverInstanceId,
      runId: input.runId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    });
  }
}
