import { driverInstancesTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, RuntimeOperationId, SessionRunId } from "@mosoo/id";
import { and, eq, exists, inArray, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import {
  ASSIGNABLE_DRIVER_INSTANCE_STATUSES,
  toDriverInstanceStatusLifecycleEventName,
} from "../domain/driver-instance-lifecycle.machine";
import { RUNTIME_SOCKET_TIMEOUT_MS } from "../domain/runtime-config";
import { ACTIVE_SESSION_RUN_STATUSES } from "../domain/session-run-lifecycle.machine";
import {
  destroyDriverInstanceDurableObject,
  failDriverInstance,
  sendDriverInstanceCommand,
  waitForDriverInstanceClose,
} from "./driver-instance/client";
import { isDriverControlSocketMissingError } from "./driver-session-stop-errors";
import { recordRuntimeRunLeaseReleasedOutcome } from "./runtime-subject-lifecycle/runtime-run-lease-store";

interface DriverStopSnapshot {
  readonly generation: number;
  readonly status: (typeof driverInstancesTable.$inferSelect)["status"];
  readonly statusOperationId: RuntimeOperationId | null;
}

async function readDriverStopSnapshot(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<DriverStopSnapshot | null> {
  return (
    (await getAppDatabase(database)
      .select({
        generation: driverInstancesTable.generation,
        status: driverInstancesTable.status,
        statusOperationId: driverInstancesTable.statusOperationId,
      })
      .from(driverInstancesTable)
      .where(eq(driverInstancesTable.id, driverInstanceId))
      .limit(1)
      .get()) ?? null
  );
}

async function getActiveDriverSessionRunId(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<SessionRunId | null> {
  const row = await getAppDatabase(database)
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.driverInstanceId, driverInstanceId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    )
    .limit(1)
    .get();

  return row?.id ?? null;
}

async function claimDriverStop(
  database: D1Database,
  input: {
    readonly driverGeneration: number;
    readonly driverInstanceId: DriverInstanceId;
    readonly expectedSessionRunId: SessionRunId | null;
    readonly operationId: RuntimeOperationId;
  },
): Promise<boolean> {
  const db = getAppDatabase(database);
  const unexpectedActiveRun = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ...(input.expectedSessionRunId === null
          ? []
          : [ne(sessionRunsTable.id, input.expectedSessionRunId)]),
      ),
    );
  const expectedRun =
    input.expectedSessionRunId === null
      ? null
      : db
          .select({ id: sessionRunsTable.id })
          .from(sessionRunsTable)
          .where(
            and(
              eq(sessionRunsTable.id, input.expectedSessionRunId),
              eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
            ),
          );
  const now = currentTimestampMs();
  const claimed = await db
    .update(driverInstancesTable)
    .set({
      status: "stopping",
      statusChangedAt: now,
      statusEvent: toDriverInstanceStatusLifecycleEventName("stopping"),
      statusOperationId: input.operationId,
      statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
      statusSource: "api",
      updatedAt: now,
    })
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        inArray(driverInstancesTable.status, ASSIGNABLE_DRIVER_INSTANCE_STATUSES),
        or(
          isNull(driverInstancesTable.statusOperationId),
          eq(driverInstancesTable.statusOperationId, input.operationId),
        ),
        notExists(unexpectedActiveRun),
        ...(expectedRun === null ? [] : [exists(expectedRun)]),
      ),
    )
    .returning({ id: driverInstancesTable.id })
    .get();

  if (claimed !== undefined) {
    return true;
  }

  const adopted = await db
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        eq(driverInstancesTable.status, "stopping"),
        eq(driverInstancesTable.statusOperationId, input.operationId),
        notExists(unexpectedActiveRun),
        ...(expectedRun === null ? [] : [exists(expectedRun)]),
      ),
    )
    .limit(1)
    .get();

  return adopted !== undefined;
}

async function releaseDriverStopClaim(
  bindings: ApiBindings,
  input: {
    readonly driverGeneration: number;
    readonly driverInstanceId: DriverInstanceId;
    readonly operationId: RuntimeOperationId;
    readonly sessionRunId: SessionRunId | null;
  },
): Promise<void> {
  if (input.sessionRunId !== null) {
    const terminalRun = await getAppDatabase(bindings.DB)
      .select({ status: sessionRunsTable.status })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.id, input.sessionRunId),
          eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          inArray(sessionRunsTable.status, ["cancelled", "completed", "expired", "failed"]),
        ),
      )
      .limit(1)
      .get();
    if (terminalRun !== undefined) {
      const terminalOperationId = input.sessionRunId as unknown as RuntimeOperationId;
      if (input.operationId !== terminalOperationId) {
        const handedOff = await getAppDatabase(bindings.DB)
          .update(driverInstancesTable)
          .set({ statusOperationId: terminalOperationId })
          .where(
            and(
              eq(driverInstancesTable.id, input.driverInstanceId),
              eq(driverInstancesTable.generation, input.driverGeneration),
              inArray(driverInstancesTable.status, ["stopped", "failed"]),
              eq(driverInstancesTable.statusOperationId, input.operationId),
            ),
          )
          .returning({ id: driverInstancesTable.id })
          .get();
        if (handedOff === undefined) {
          throw new Error("Driver stop lost ownership before terminal cleanup handoff.");
        }
      }
      const { releaseTerminalDriverInstanceSessionRun } =
        await import("./driver-instance/terminal-run-release");
      await releaseTerminalDriverInstanceSessionRun(bindings, {
        driverGeneration: input.driverGeneration,
        driverInstanceId: input.driverInstanceId,
        sessionRunId: input.sessionRunId,
      });
      return;
    }

    const outcome = await recordRuntimeRunLeaseReleasedOutcome(bindings.DB, {
      driverInstanceId: input.driverInstanceId,
      expectedDriverGeneration: input.driverGeneration,
      expectedDriverOperationId: input.operationId,
      expectedSessionRunId: input.sessionRunId,
    });

    if (outcome.status === "applied") {
      return;
    }

    logWarn("runtime.driver_stop.lease_release_skipped", {
      driverInstanceId: input.driverInstanceId,
      reason: "reason" in outcome ? outcome.reason : outcome.status,
      sessionRunId: input.sessionRunId,
      status: outcome.status,
    });
    throw new Error("Driver stop could not release its exact Session Run lease.");
  }

  const db = getAppDatabase(bindings.DB);
  const activeRun = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
  const released = await db
    .update(driverInstancesTable)
    .set({ statusOperationId: null })
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        eq(driverInstancesTable.statusOperationId, input.operationId),
        notExists(activeRun),
      ),
    )
    .returning({ id: driverInstancesTable.id })
    .get();

  if (released === undefined) {
    throw new Error("Driver stop lost its exact operation ownership before release.");
  }
}

async function findCurrentTerminalDriverRunId(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<SessionRunId | null> {
  const rows = await getAppDatabase(database)
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.lastRunId, sessionRunsTable.id))
    .where(
      and(
        eq(sessionRunsTable.driverInstanceId, driverInstanceId),
        inArray(sessionRunsTable.status, ["cancelled", "completed", "expired", "failed"]),
      ),
    )
    .limit(2)
    .all();

  return rows.length === 1 ? (rows[0]?.id ?? null) : null;
}

export async function stopDriverSession(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    expectedDriverGeneration?: number;
    expectedSessionRunId?: SessionRunId;
    operationId?: RuntimeOperationId;
    reason: string;
  },
): Promise<void> {
  const driver = await readDriverStopSnapshot(bindings.DB, input.driverInstanceId);

  if (!driver) {
    return;
  }

  if (
    input.expectedDriverGeneration !== undefined &&
    driver.generation !== input.expectedDriverGeneration
  ) {
    return;
  }

  const observedActiveRunId = await getActiveDriverSessionRunId(
    bindings.DB,
    input.driverInstanceId,
  );
  const terminalOwnedRunId =
    input.expectedSessionRunId === undefined &&
    observedActiveRunId === null &&
    driver.statusOperationId !== null
      ? await findCurrentTerminalDriverRunId(bindings.DB, input.driverInstanceId)
      : null;
  const expectedSessionRunId =
    input.expectedSessionRunId ?? observedActiveRunId ?? terminalOwnedRunId;

  if (driver.status === "stopped" || driver.status === "failed") {
    if (driver.statusOperationId !== null) {
      if (input.operationId !== undefined && input.operationId !== driver.statusOperationId) {
        return;
      }
      await destroyDriverInstanceDurableObject(
        bindings,
        input.driverInstanceId,
        driver.generation,
        input.reason,
      );
      await releaseDriverStopClaim(bindings, {
        driverGeneration: driver.generation,
        driverInstanceId: input.driverInstanceId,
        operationId: driver.statusOperationId,
        sessionRunId: expectedSessionRunId,
      });
      return;
    }
    if (observedActiveRunId !== null) {
      const outcome = await recordRuntimeRunLeaseReleasedOutcome(bindings.DB, {
        driverInstanceId: input.driverInstanceId,
        expectedDriverGeneration: driver.generation,
        expectedSessionRunId: observedActiveRunId,
      });
      if (outcome.status !== "applied") {
        throw new Error("Terminal Driver lost its exact Session Run lease before release.");
      }
    }
    return;
  }

  const operationId =
    driver.status === "stopping" && driver.statusOperationId !== null
      ? driver.statusOperationId
      : ((expectedSessionRunId as unknown as RuntimeOperationId | null) ??
        input.operationId ??
        createPlatformId<RuntimeOperationId>());
  const claimed = await claimDriverStop(bindings.DB, {
    driverGeneration: driver.generation,
    driverInstanceId: input.driverInstanceId,
    expectedSessionRunId,
    operationId,
  });
  if (!claimed) {
    throw new Error("Driver stop lost its exact Driver and Session Run ownership.");
  }

  let stopped = false;
  try {
    if (driver.status === "ready") {
      try {
        await sendDriverInstanceCommand(bindings, input.driverInstanceId, driver.generation, {
          commandId: createPlatformId(),
          kind: "session.stop",
          reason: input.reason,
        });
        await waitForDriverInstanceClose(
          bindings,
          input.driverInstanceId,
          driver.generation,
          RUNTIME_SOCKET_TIMEOUT_MS,
        );
      } catch (error) {
        if (!isDriverControlSocketMissingError(error)) {
          throw error;
        }
        await failDriverInstance(bindings, input.driverInstanceId, driver.generation, input.reason);
        await waitForDriverInstanceClose(
          bindings,
          input.driverInstanceId,
          driver.generation,
          RUNTIME_SOCKET_TIMEOUT_MS,
        );
      }
    } else {
      await failDriverInstance(bindings, input.driverInstanceId, driver.generation, input.reason);
      await waitForDriverInstanceClose(
        bindings,
        input.driverInstanceId,
        driver.generation,
        RUNTIME_SOCKET_TIMEOUT_MS,
      );
    }
    stopped = true;
  } finally {
    if (stopped) {
      await releaseDriverStopClaim(bindings, {
        driverGeneration: driver.generation,
        driverInstanceId: input.driverInstanceId,
        operationId,
        sessionRunId: expectedSessionRunId,
      });
    }
  }
}

export async function repairClaimedDriverStopsGlobally(bindings: ApiBindings): Promise<void> {
  const db = getAppDatabase(bindings.DB);
  const terminalReleaseRun = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        sql`${sessionRunsTable.id} = ${driverInstancesTable.statusOperationId}`,
        eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
        inArray(sessionRunsTable.status, ["cancelled", "completed", "expired", "failed"]),
      ),
    );
  const claims = await db
    .select({
      driverGeneration: driverInstancesTable.generation,
      driverInstanceId: driverInstancesTable.id,
      operationId: driverInstancesTable.statusOperationId,
      sessionRunId: sessionRunsTable.id,
    })
    .from(driverInstancesTable)
    .leftJoin(
      sessionRunsTable,
      and(
        sql`${sessionRunsTable.id} = ${driverInstancesTable.statusOperationId}`,
        eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
      ),
    )
    .where(
      and(
        isNotNull(driverInstancesTable.statusOperationId),
        or(
          eq(driverInstancesTable.status, "stopping"),
          and(
            inArray(driverInstancesTable.status, ["stopped", "failed"]),
            notExists(terminalReleaseRun),
          ),
        ),
      ),
    )
    .all();

  for (const claim of claims) {
    if (claim.operationId === null) {
      continue;
    }
    try {
      const sessionRunId =
        claim.sessionRunId ??
        (await findCurrentTerminalDriverRunId(bindings.DB, claim.driverInstanceId));
      await stopDriverSession(bindings, {
        driverInstanceId: claim.driverInstanceId,
        expectedDriverGeneration: claim.driverGeneration,
        ...(sessionRunId === null ? {} : { expectedSessionRunId: sessionRunId }),
        operationId: claim.operationId,
        reason: "runtime.driver_stop.repair",
      });
    } catch (error) {
      logWarn("runtime.driver_stop.repair_failed", {
        driverInstanceId: claim.driverInstanceId,
        error: error instanceof Error ? error.message : "Driver stop repair failed.",
        operationId: claim.operationId,
      });
    }
  }
}
