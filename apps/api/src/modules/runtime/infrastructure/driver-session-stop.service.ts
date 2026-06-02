import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, RuntimeOperationId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { RUNTIME_SOCKET_TIMEOUT_MS } from "../domain/runtime-config";
import { ACTIVE_SESSION_RUN_STATUSES } from "../domain/session-run-lifecycle.machine";
import {
  failDriverInstance,
  sendDriverInstanceCommand,
  waitForDriverInstanceClose,
} from "./driver-instance/client";
import { getDriverInstanceRecord } from "./driver-instance/driver-instance-record.repository";
import { isDriverControlSocketMissingError } from "./driver-session-stop-errors";
import { recordRuntimeRunLeaseReleasedOutcome } from "./runtime-subject-lifecycle/runtime-run-lease-store";
import { setSessionRunStatus } from "./session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "./session-runs/session-run-store.repository";

function assertStoppedDriverRunTransition(outcome: SessionRunTransitionOutcome): void {
  switch (outcome.kind) {
    case "applied":
    case "duplicate": {
      return;
    }
    case "stale": {
      if (outcome.reason === "terminal_run") {
        return;
      }
      throw new Error("Driver stop lost a concurrent run transition.");
    }
    case "repair_needed": {
      throw new Error("Driver stop left session projection stale.");
    }
    case "rejected": {
      throw new Error(`Driver stop run transition was rejected: ${outcome.reason}.`);
    }
  }
}

async function getActiveDriverSessionRunId(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<SessionRunId | null> {
  const row =
    (await getAppDatabase(database)
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.driverInstanceId, driverInstanceId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return row?.id ?? null;
}

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
      assertStoppedDriverRunTransition(outcome);
    }

    const outcome = await recordRuntimeRunLeaseReleasedOutcome(bindings.DB, {
      driverInstanceId: input.driverInstanceId,
      expectedSessionRunId: activeSessionRunId,
    });

    if (outcome.status !== "applied") {
      logWarn("runtime.driver_stop.lease_release_skipped", {
        driverInstanceId: input.driverInstanceId,
        reason: "reason" in outcome ? outcome.reason : outcome.status,
        sessionRunId: activeSessionRunId,
        status: outcome.status,
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
