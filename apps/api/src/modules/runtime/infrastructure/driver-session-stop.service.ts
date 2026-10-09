import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, RuntimeOperationId } from "@mosoo/id";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { RUNTIME_SOCKET_TIMEOUT_MS } from "../domain/runtime-config";
import {
  failDriverInstance,
  sendDriverInstanceCommand,
  waitForDriverInstanceClose,
} from "./driver-instance/client";
import { getDriverInstanceRecord } from "./driver-instance/driver-instance-record.repository";
import { getActiveDriverSessionRunId } from "./driver-session-state";
import { isDriverControlSocketMissingError } from "./driver-session-stop-errors";
import { releaseRuntimeRunLease } from "./runtime-subject-lifecycle/runtime-run-lease-store";
import {
  assertSessionRunTransition,
  setSessionRunStatus,
} from "./session-runs/session-run-store.repository";

export async function stopDriverSession(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    operationId?: RuntimeOperationId;
    preserveSessionLifecycle?: boolean;
    reason: string;
    terminalRun?: {
      error?: RunError | null;
      status: Extract<SessionRunStatus, "cancelled" | "failed">;
    };
  },
): Promise<void> {
  const driver = await getDriverInstanceRecord(bindings.DB, input.driverInstanceId);

  if (!driver) {
    return;
  }

  const activeDriver = driver;
  const activeSessionRunId = await getActiveDriverSessionRunId(bindings.DB, input.driverInstanceId);

  async function releaseLinkedRun(): Promise<void> {
    if (activeSessionRunId === null) {
      return;
    }

    if (input.terminalRun !== undefined) {
      const outcome = await setSessionRunStatus(bindings.DB, {
        error: input.terminalRun.error ?? null,
        ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
        preserveSessionLifecycle: input.preserveSessionLifecycle === true,
        runId: activeSessionRunId,
        source: "runtime_operation",
        status: input.terminalRun.status,
      });
      assertSessionRunTransition(outcome, "Driver stop");
    }

    const released = await releaseRuntimeRunLease(bindings.DB, {
      driverInstanceId: input.driverInstanceId,
      expectedSessionRunId: activeSessionRunId,
    });

    if (!released) {
      logWarn("runtime.driver_stop.lease_release_skipped", {
        driverInstanceId: input.driverInstanceId,
        sessionRunId: activeSessionRunId,
      });
    }
  }

  if (activeDriver.status === "stopped" || activeDriver.status === "failed") {
    await releaseLinkedRun();
    return;
  }

  try {
    if (activeDriver.status === "ready") {
      try {
        await sendDriverInstanceCommand(bindings, input.driverInstanceId, {
          commandId: createPlatformId(),
          kind: "session.stop",
          reason: input.reason,
        });
        await waitForDriverInstanceClose(
          bindings,
          input.driverInstanceId,
          RUNTIME_SOCKET_TIMEOUT_MS,
        );
      } catch (error) {
        if (!isDriverControlSocketMissingError(error)) {
          throw error;
        }
      }

      return;
    }

    await failDriverInstance(bindings, input.driverInstanceId, input.reason);
  } finally {
    await releaseLinkedRun();
  }
}
