import { RuntimeCommandRecord } from "@mosoo/contracts/runtime-command";
import type {
  RuntimeCommand,
  RuntimeCommandResult,
  RuntimeCommandStatus,
} from "@mosoo/contracts/runtime-command";
import type { RunError } from "@mosoo/contracts/session-run";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { driverCommandsTable, driverInstancesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, exists, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { LIVE_DRIVER_INSTANCE_STATUSES } from "../../domain/driver-instance-lifecycle.machine";
import { toRuntimeCommandRecordFromRow } from "./runtime-command-record.mapper";
import type { RuntimeCommandRecordRow } from "./runtime-command-record.mapper";
import {
  createRuntimeCommandBatchTransitionOutcome,
  decideRuntimeCommandTransition,
  getRuntimeCommandDeliveryLeaseExpirableStatuses,
  getRuntimeCommandPreviousStatuses,
  isRuntimeCommandAcknowledgedStatus,
  isRuntimeCommandTerminalStatus,
} from "./runtime-command-transition";
import type {
  RuntimeCommandBatchTransitionOutcome,
  RuntimeCommandTransitionOutcome,
} from "./runtime-command-transition";

export interface RuntimeCommandMaintenanceOutcome {
  expired: RuntimeCommandBatchTransitionOutcome;
  recovered: RuntimeCommandBatchTransitionOutcome;
}

export interface RuntimeCommandGlobalMaintenanceOutcome extends RuntimeCommandMaintenanceOutcome {
  failed: RuntimeCommandBatchTransitionOutcome;
}

async function getNextRuntimeCommandSeq(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<number> {
  const row =
    (await getAppDatabase(database)
      .update(driverInstancesTable)
      .set({
        commandSeqCursor: sql`${driverInstancesTable.commandSeqCursor} + 1`,
      })
      .where(eq(driverInstancesTable.id, driverInstanceId))
      .returning({ seq: driverInstancesTable.commandSeqCursor })
      .get()) ?? null;

  if (row === null) {
    throw new Error("Driver instance not found while allocating a runtime command sequence.");
  }

  return row.seq;
}

function isDriverCommandSeqConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("driver_command_instance_seq_idx") ||
    error.message.includes("driver_command.driver_instance_id, driver_command.seq")
  );
}

type RuntimeCommandErrorDetails = Record<string, string | number | boolean | null>;

function createRuntimeCommandDeliveryExpiredError(details: RuntimeCommandErrorDetails): RunError {
  return {
    code: "driver.command_delivery_expired",
    details,
    message: "Runtime command delivery lease expired before the driver accepted it.",
    retryable: true,
  };
}

function createRuntimeCommandDriverTerminalError(details: RuntimeCommandErrorDetails): RunError {
  return {
    code: "driver.command_driver_terminal",
    details,
    message: "Runtime driver stopped before the accepted command completed.",
    retryable: false,
  };
}

export async function createRuntimeCommandRecord(
  database: D1Database,
  input: {
    command: RuntimeCommand;
    driverInstanceId: DriverInstanceId;
    expiresAt?: number | null;
    status?: RuntimeCommandStatus;
  },
): Promise<RuntimeCommandRecord> {
  const issuedAt = currentTimestampMs();
  const commandId = parsePlatformId<DriverCommandId>(input.command.commandId, "Runtime command ID");
  const status = input.status ?? "queued";
  const payloadJson = JSON.stringify(input.command);

  return createRuntimeCommandRecordAttempt(database, input, {
    attempt: 0,
    commandId,
    issuedAt,
    payloadJson,
    status,
  });
}

async function createRuntimeCommandRecordAttempt(
  database: D1Database,
  input: {
    command: RuntimeCommand;
    driverInstanceId: DriverInstanceId;
    expiresAt?: number | null;
    status?: RuntimeCommandStatus;
  },
  state: {
    attempt: number;
    commandId: DriverCommandId;
    issuedAt: number;
    payloadJson: string;
    status: RuntimeCommandStatus;
  },
): Promise<RuntimeCommandRecord> {
  if (state.attempt >= 5) {
    throw new Error("Failed to allocate a runtime command sequence.");
  }

  const seq = await getNextRuntimeCommandSeq(database, input.driverInstanceId);

  try {
    await getAppDatabase(database)
      .insert(driverCommandsTable)
      .values({
        ackedAt: null,
        completedAt: null,
        deliveryConnectionId: null,
        driverInstanceId: input.driverInstanceId,
        errorJson: null,
        expiresAt: input.expiresAt ?? null,
        id: state.commandId,
        issuedAt: state.issuedAt,
        kind: input.command.kind,
        payloadJson: state.payloadJson,
        resultJson: null,
        seq,
        status: state.status,
      })
      .run();

    return parseSchemaValue(RuntimeCommandRecord, {
      ackedAt: null,
      completedAt: null,
      driverInstanceId: input.driverInstanceId,
      error: null,
      expiresAt:
        input.expiresAt === null || input.expiresAt === undefined
          ? null
          : toIsoString(input.expiresAt),
      id: state.commandId,
      issuedAt: toIsoString(state.issuedAt),
      kind: input.command.kind,
      payload: input.command,
      result: null,
      seq,
      status: state.status,
    });
  } catch (error) {
    if (state.attempt < 4 && isDriverCommandSeqConflict(error)) {
      return createRuntimeCommandRecordAttempt(database, input, {
        ...state,
        attempt: state.attempt + 1,
      });
    }

    throw error;
  }
}

export async function updateRuntimeCommandRecord(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    deliveryConnectionId?: string;
    driverInstanceId: DriverInstanceId;
    error?: RunError;
    result?: RuntimeCommandResult;
    status: RuntimeCommandStatus;
  },
): Promise<RuntimeCommandTransitionOutcome> {
  const current =
    (await getAppDatabase(database)
      .select({
        deliveryConnectionId: driverCommandsTable.deliveryConnectionId,
        status: driverCommandsTable.status,
      })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.id, input.commandId),
          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (current === null) {
    return {
      currentStatus: null,
      kind: "rejected",
      reason: "command_not_found",
      targetStatus: input.status,
    };
  }

  if (
    input.deliveryConnectionId !== undefined &&
    current.deliveryConnectionId !== input.deliveryConnectionId
  ) {
    return {
      currentStatus: current.status,
      kind: "rejected",
      reason: "stale_delivery_connection",
      targetStatus: input.status,
    };
  }

  const transition = decideRuntimeCommandTransition(current.status, input.status);

  if (transition.kind !== "applied") {
    return transition;
  }

  const timestampMs = currentTimestampMs();
  const ackedAt = isRuntimeCommandAcknowledgedStatus(input.status) ? timestampMs : null;
  const completedAt = isRuntimeCommandTerminalStatus(input.status) ? timestampMs : null;

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      ackedAt:
        ackedAt === null ? undefined : sql`COALESCE(${ackedAt}, ${driverCommandsTable.ackedAt})`,
      completedAt:
        completedAt === null
          ? undefined
          : sql`COALESCE(${completedAt}, ${driverCommandsTable.completedAt})`,
      errorJson: input.error === undefined ? null : JSON.stringify(input.error),
      resultJson: input.result === undefined ? null : JSON.stringify(input.result),
      status: input.status,
    })
    .where(
      and(
        eq(driverCommandsTable.id, input.commandId),
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.status, current.status),
        ...(input.deliveryConnectionId === undefined
          ? []
          : [eq(driverCommandsTable.deliveryConnectionId, input.deliveryConnectionId)]),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0
    ? transition
    : {
        currentStatus: current.status,
        kind: "rejected",
        reason: "illegal_transition",
        targetStatus: input.status,
      };
}

export async function markRuntimeCommandRecordDelivered(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    connectionId: string;
    driverInstanceId: DriverInstanceId;
    expiresAfter?: number;
  },
): Promise<RuntimeCommandTransitionOutcome> {
  const db = getAppDatabase(database);
  const targetStatus = "delivered" satisfies RuntimeCommandStatus;
  const current =
    (await db
      .select({
        deliveryConnectionId: driverCommandsTable.deliveryConnectionId,
        status: driverCommandsTable.status,
      })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.id, input.commandId),
          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        ),
      )
      .limit(1)
      .get()) ?? null;
  const activeConnection =
    (await db
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.connectionId, input.connectionId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (current === null) {
    return {
      currentStatus: null,
      kind: "rejected",
      reason: "command_not_found",
      targetStatus,
    };
  }

  if (activeConnection === null) {
    return {
      currentStatus: current.status,
      kind: "rejected",
      reason: "inactive_delivery_connection",
      targetStatus,
    };
  }

  if (
    current.status === "delivered" &&
    current.deliveryConnectionId !== null &&
    current.deliveryConnectionId !== input.connectionId
  ) {
    return {
      currentStatus: current.status,
      kind: "rejected",
      reason: "stale_delivery_connection",
      targetStatus,
    };
  }

  const transition = decideRuntimeCommandTransition(current.status, targetStatus);

  if (transition.kind !== "applied") {
    return transition;
  }

  const activeConnectionQuery = db
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.connectionId, input.connectionId),
      ),
    );
  const result = await db
    .update(driverCommandsTable)
    .set({
      deliveryConnectionId: input.connectionId,
      status: transition.status,
    })
    .where(
      and(
        eq(driverCommandsTable.id, input.commandId),
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.status, current.status),
        ...(input.expiresAfter === undefined
          ? []
          : [
              or(
                isNull(driverCommandsTable.expiresAt),
                gt(driverCommandsTable.expiresAt, input.expiresAfter),
              )!,
            ]),
        exists(activeConnectionQuery),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0
    ? transition
    : {
        currentStatus: current.status,
        kind: "rejected",
        reason: "illegal_transition",
        targetStatus,
      };
}

export async function getRuntimeCommandRecord(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  commandId: DriverCommandId,
): Promise<RuntimeCommandRecord | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        ackedAt: driverCommandsTable.ackedAt,
        completedAt: driverCommandsTable.completedAt,
        driverInstanceId: driverCommandsTable.driverInstanceId,
        errorJson: driverCommandsTable.errorJson,
        expiresAt: driverCommandsTable.expiresAt,
        id: driverCommandsTable.id,
        issuedAt: driverCommandsTable.issuedAt,
        kind: sql<RuntimeCommandRecordRow["kind"]>`${driverCommandsTable.kind}`,
        payloadJson: driverCommandsTable.payloadJson,
        resultJson: driverCommandsTable.resultJson,
        seq: driverCommandsTable.seq,
        status: driverCommandsTable.status,
      })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.driverInstanceId, driverInstanceId),
          eq(driverCommandsTable.id, commandId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return toRuntimeCommandRecordFromRow(row);
}

async function expireRuntimeCommandDeliveryLeases(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  nowMs: number,
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const expirableStatuses = getRuntimeCommandDeliveryLeaseExpirableStatuses();
  const queuedStatus = "queued" satisfies RuntimeCommandStatus;
  const targetStatus = "expired" satisfies RuntimeCommandStatus;
  const error = createRuntimeCommandDeliveryExpiredError({ driverInstanceId });

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(error),
      status: targetStatus,
    })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, driverInstanceId),
        inArray(driverCommandsTable.status, [...expirableStatuses]),
        or(eq(driverCommandsTable.status, queuedStatus), isNull(driverCommandsTable.ackedAt)),
        lte(driverCommandsTable.expiresAt, nowMs),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

export async function expireUndeliveredInputStartCommandsForRun(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    nowMs?: number;
    runId: SessionRunId;
  },
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const nowMs = input.nowMs ?? currentTimestampMs();
  const expirableStatuses = getRuntimeCommandDeliveryLeaseExpirableStatuses();
  const queuedStatus = "queued" satisfies RuntimeCommandStatus;
  const targetStatus = "expired" satisfies RuntimeCommandStatus;
  const error = createRuntimeCommandDeliveryExpiredError({
    driverInstanceId: input.driverInstanceId,
    runId: input.runId,
  });

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(error),
      status: targetStatus,
    })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.kind, "input.start"),
        sql`json_extract(${driverCommandsTable.payloadJson}, '$.runId') = ${input.runId}`,
        inArray(driverCommandsTable.status, [...expirableStatuses]),
        or(eq(driverCommandsTable.status, queuedStatus), isNull(driverCommandsTable.ackedAt)),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

async function expireRuntimeCommandDeliveryLeasesGlobally(
  database: D1Database,
  nowMs: number,
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const expirableStatuses = getRuntimeCommandDeliveryLeaseExpirableStatuses();
  const queuedStatus = "queued" satisfies RuntimeCommandStatus;
  const targetStatus = "expired" satisfies RuntimeCommandStatus;
  const error = createRuntimeCommandDeliveryExpiredError({});

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(error),
      status: targetStatus,
    })
    .where(
      and(
        inArray(driverCommandsTable.status, [...expirableStatuses]),
        or(eq(driverCommandsTable.status, queuedStatus), isNull(driverCommandsTable.ackedAt)),
        lte(driverCommandsTable.expiresAt, nowMs),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

async function recoverRuntimeCommandsDeliveredToStaleConnections(
  database: D1Database,
  input: {
    connectionId: string;
    driverInstanceId: DriverInstanceId;
  },
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const recoverableStatuses = getRuntimeCommandPreviousStatuses("queued");
  const targetStatus = "queued" satisfies RuntimeCommandStatus;

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      deliveryConnectionId: null,
      status: targetStatus,
    })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        inArray(driverCommandsTable.status, [...recoverableStatuses]),
        isNull(driverCommandsTable.ackedAt),
        or(
          isNull(driverCommandsTable.deliveryConnectionId),
          ne(driverCommandsTable.deliveryConnectionId, input.connectionId),
        ),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

async function recoverRuntimeCommandsDeliveredToStaleConnectionsGlobally(
  database: D1Database,
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const recoverableStatuses = getRuntimeCommandPreviousStatuses("queued");
  const targetStatus = "queued" satisfies RuntimeCommandStatus;
  const db = getAppDatabase(database);
  const staleDriverConnectionQuery = db
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, driverCommandsTable.driverInstanceId),
        inArray(driverInstancesTable.status, [...LIVE_DRIVER_INSTANCE_STATUSES]),
        or(
          isNull(driverCommandsTable.deliveryConnectionId),
          isNull(driverInstancesTable.connectionId),
          ne(driverCommandsTable.deliveryConnectionId, driverInstancesTable.connectionId),
        ),
      ),
    );

  const result = await db
    .update(driverCommandsTable)
    .set({
      deliveryConnectionId: null,
      status: targetStatus,
    })
    .where(
      and(
        inArray(driverCommandsTable.status, [...recoverableStatuses]),
        isNull(driverCommandsTable.ackedAt),
        exists(staleDriverConnectionQuery),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

export async function failAcceptedRuntimeCommandsForTerminalDriver(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    nowMs?: number;
  },
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const nowMs = input.nowMs ?? currentTimestampMs();
  const targetStatus = "failed" satisfies RuntimeCommandStatus;
  const error = createRuntimeCommandDriverTerminalError({
    driverInstanceId: input.driverInstanceId,
  });

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(error),
      status: targetStatus,
    })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.status, "accepted"),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

async function failAcceptedRuntimeCommandsForTerminalDriversGlobally(
  database: D1Database,
  nowMs: number,
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const targetStatus = "failed" satisfies RuntimeCommandStatus;
  const error = createRuntimeCommandDriverTerminalError({});
  const db = getAppDatabase(database);
  const terminalDriverQuery = db
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, driverCommandsTable.driverInstanceId),
        inArray(driverInstancesTable.status, ["failed", "stopped"]),
      ),
    );

  const result = await db
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(error),
      status: targetStatus,
    })
    .where(and(eq(driverCommandsTable.status, "accepted"), exists(terminalDriverQuery)))
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

export async function maintainRuntimeCommandRecords(
  database: D1Database,
  input: {
    connectionId: string;
    driverInstanceId: DriverInstanceId;
    nowMs?: number;
  },
): Promise<RuntimeCommandMaintenanceOutcome> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  const recovered = await recoverRuntimeCommandsDeliveredToStaleConnections(database, {
    connectionId: input.connectionId,
    driverInstanceId: input.driverInstanceId,
  });
  const expired = await expireRuntimeCommandDeliveryLeases(database, input.driverInstanceId, nowMs);

  return {
    expired,
    recovered,
  };
}

export async function repairRuntimeCommandRecords(
  database: D1Database,
  input: {
    nowMs?: number;
  } = {},
): Promise<RuntimeCommandGlobalMaintenanceOutcome> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  const recovered = await recoverRuntimeCommandsDeliveredToStaleConnectionsGlobally(database);
  const expired = await expireRuntimeCommandDeliveryLeasesGlobally(database, nowMs);
  const failed = await failAcceptedRuntimeCommandsForTerminalDriversGlobally(database, nowMs);

  return {
    expired,
    failed,
    recovered,
  };
}

export async function claimNextQueuedRuntimeCommandRecord(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  connectionId: string,
): Promise<RuntimeCommandRecord | null> {
  const nowMs = currentTimestampMs();
  const db = getAppDatabase(database);

  await maintainRuntimeCommandRecords(database, {
    connectionId,
    driverInstanceId,
    nowMs,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextQueued =
      (await db
        .select({ id: driverCommandsTable.id })
        .from(driverCommandsTable)
        .where(
          and(
            eq(driverCommandsTable.driverInstanceId, driverInstanceId),
            eq(driverCommandsTable.status, "queued"),
            or(isNull(driverCommandsTable.expiresAt), gt(driverCommandsTable.expiresAt, nowMs)),
          ),
        )
        .orderBy(asc(driverCommandsTable.seq))
        .limit(1)
        .get()) ?? null;

    if (nextQueued === null) {
      return null;
    }

    const deliveryOutcome = await markRuntimeCommandRecordDelivered(database, {
      commandId: nextQueued.id,
      connectionId,
      driverInstanceId,
      expiresAfter: nowMs,
    });

    if (
      deliveryOutcome.kind === "rejected" &&
      deliveryOutcome.reason === "inactive_delivery_connection"
    ) {
      return null;
    }

    const claimed =
      deliveryOutcome.kind === "applied"
        ? await getRuntimeCommandRecord(database, driverInstanceId, nextQueued.id)
        : null;

    if (claimed !== null) {
      return claimed;
    }
  }

  return null;
}
