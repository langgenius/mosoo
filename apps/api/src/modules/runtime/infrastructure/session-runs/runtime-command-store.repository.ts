import type { RuntimeCommand, RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";
import { driverCommandsTable, driverInstancesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, exists, gt, inArray, sql } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
import type { AppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { decideRuntimeCommandTransition } from "./runtime-command-transition";
import type { RuntimeCommandTransitionOutcome } from "./runtime-command-transition";

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

function activeConnectionCondition(
  db: AppDatabase,
  input: { connectionId: string; driverInstanceId: DriverInstanceId },
) {
  return exists(
    db
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.connectionId, input.connectionId),
        ),
      ),
  );
}

export async function createRuntimeCommandRecord(
  database: D1Database,
  input: {
    command: RuntimeCommand;
    driverInstanceId: DriverInstanceId;
    expiresAt: number;
  },
): Promise<void> {
  await getAppDatabase(database)
    .insert(driverCommandsTable)
    .values({
      driverInstanceId: input.driverInstanceId,
      expiresAt: input.expiresAt,
      id: parsePlatformId<DriverCommandId>(input.command.commandId, "Runtime command ID"),
      issuedAt: currentTimestampMs(),
      kind: input.command.kind,
      payloadJson: JSON.stringify(input.command),
      seq: await getNextRuntimeCommandSeq(database, input.driverInstanceId),
      status: "queued",
    })
    .run();
}

export async function updateRuntimeCommandRecord(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    driverInstanceId: DriverInstanceId;
    status: RuntimeCommandStatus;
  },
): Promise<RuntimeCommandTransitionOutcome> {
  const current =
    (await getAppDatabase(database)
      .select({ status: driverCommandsTable.status })
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

  const transition = decideRuntimeCommandTransition(current.status, input.status);

  if (transition.kind !== "applied") {
    return transition;
  }

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({ status: input.status })
    .where(
      and(
        eq(driverCommandsTable.id, input.commandId),
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.status, current.status),
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

export async function getRuntimeCommandKind(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  commandId: DriverCommandId,
): Promise<string | null> {
  const row =
    (await getAppDatabase(database)
      .select({ kind: driverCommandsTable.kind })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.driverInstanceId, driverInstanceId),
          eq(driverCommandsTable.id, commandId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return row?.kind ?? null;
}

export async function expireUndeliveredInputStartCommandsForRun(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    runId: SessionRunId;
  },
): Promise<void> {
  await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.kind, "input.start"),
        sql`json_extract(${driverCommandsTable.payloadJson}, '$.runId') = ${input.runId}`,
        inArray(driverCommandsTable.status, ["queued", "delivered"]),
      ),
    )
    .run();
}

export async function claimNextQueuedRuntimeCommand(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  connectionId: string,
): Promise<RuntimeCommand | null> {
  const db = getAppDatabase(database);
  const nextQueuedCommand = db
    .select({ id: driverCommandsTable.id })
    .from(driverCommandsTable)
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, driverInstanceId),
        eq(driverCommandsTable.status, "queued"),
        gt(driverCommandsTable.expiresAt, currentTimestampMs()),
      ),
    )
    .orderBy(asc(driverCommandsTable.seq))
    .limit(1);
  const claimed =
    (await db
      .update(driverCommandsTable)
      .set({ status: "delivered" })
      .where(
        and(
          inArray(driverCommandsTable.id, nextQueuedCommand),
          eq(driverCommandsTable.status, "queued"),
          activeConnectionCondition(db, { connectionId, driverInstanceId }),
        ),
      )
      .returning({ payloadJson: driverCommandsTable.payloadJson })
      .get()) ?? null;

  return claimed === null ? null : (JSON.parse(claimed.payloadJson) as RuntimeCommand);
}
