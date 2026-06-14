import { driverCommandsTable, driverInstanceMcpGrantsTable, driverInstancesTable } from "@mosoo/db";
import type { DriverInstanceId, SandboxId, SessionId } from "@mosoo/id";
import { DRIVER_PROTOCOL_VERSION } from "agent-driver/boot";
import type { DriverRuntime } from "agent-driver/runtime";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  REUSABLE_DRIVER_INSTANCE_STATUSES,
  LIVE_DRIVER_INSTANCE_STATUSES,
  toDriverInstanceStatusLifecycleEventName,
} from "../../domain/driver-instance-lifecycle.machine";
import { DRIVER_BOOT_TOKEN_TTL_MS } from "../../domain/runtime-config";
import type { DriverInstanceMcpGrantRecord } from "./mcp-grants.repository";
import { driverInstanceExpiresAt } from "./status";
import type { DriverInstanceStatus } from "./status";

export type CreateDriverInstanceRecordResult =
  | {
      bootTokenExpiresAt: number;
      generation: number;
      status: "created";
    }
  | {
      bootTokenExpiresAt: null;
      generation: null;
      reason: "existing-driver";
      status: "skipped";
    };

export async function createDriverInstanceRecord(
  bindings: ApiBindings,
  input: {
    bootTokenHash: Uint8Array;
    conflictStrategy?: "insert-only" | "replace";
    driverInstanceId: DriverInstanceId;
    runtime: DriverRuntime;
    sandboxId: SandboxId;
    sandboxSessionId: SessionId;
    mcpGrants?: DriverInstanceMcpGrantRecord[];
  },
): Promise<CreateDriverInstanceRecordResult> {
  const now = currentTimestampMs();
  const bootTokenExpiresAt = now + DRIVER_BOOT_TOKEN_TTL_MS;
  const mcpGrantRows = (input.mcpGrants ?? []).map((grant) => ({
    authType: grant.authType,
    authorizationState: grant.authorizationState,
    canInvalidate: grant.canInvalidate,
    canRefresh: grant.canRefresh,
    createdAt: now,
    credentialId: grant.credentialId,
    driverInstanceId: input.driverInstanceId,
    appId: grant.appId,
    serverId: grant.serverId,
    updatedAt: now,
  }));
  const driverRecord = {
    bootTokenExpiresAt,
    bootTokenHash: input.bootTokenHash,
    bootTokenUsedAt: null,
    closeCode: null,
    closeReason: null,
    connectionId: null,
    createdAt: now,
    driverPid: null,
    driverStartedAt: null,
    driverVersion: null,
    errorMessage: null,
    expiresAt: driverInstanceExpiresAt(now),
    generation: 0,
    heartbeatCount: 0,
    id: input.driverInstanceId,
    lastHeartbeatAt: null,
    processId: null,
    protocol: "orpc-ws",
    protocolVersion: DRIVER_PROTOCOL_VERSION,
    restartCount: 0,
    runtime: input.runtime,
    sandboxId: input.sandboxId,
    sandboxSessionId: input.sandboxSessionId,
    status: "provisioning",
    statusChangedAt: now,
    statusEvent: toDriverInstanceStatusLifecycleEventName("provisioning"),
    statusOperationId: null,
    statusSeq: 0,
    statusSource: "api",
    updatedAt: now,
  } as const;

  if (input.conflictStrategy === "insert-only") {
    const database = getAppDatabase(bindings.DB);
    const inserted =
      (await database
        .insert(driverInstancesTable)
        .values(driverRecord)
        .onConflictDoNothing()
        .returning({
          bootTokenExpiresAt: driverInstancesTable.bootTokenExpiresAt,
          generation: driverInstancesTable.generation,
        })
        .get()) ?? null;

    if (inserted === null) {
      return {
        bootTokenExpiresAt: null,
        generation: null,
        reason: "existing-driver",
        status: "skipped",
      };
    }

    if (mcpGrantRows.length > 0) {
      await database.insert(driverInstanceMcpGrantsTable).values(mcpGrantRows).run();
    }

    return {
      bootTokenExpiresAt: inserted.bootTokenExpiresAt,
      generation: inserted.generation,
      status: "created",
    };
  }

  const database = getAppDatabase(bindings.DB);
  await runAppDatabaseBatch(bindings.DB, (batchDb) => [
    batchDb
      .delete(driverCommandsTable)
      .where(eq(driverCommandsTable.driverInstanceId, input.driverInstanceId)),
    batchDb
      .delete(driverInstanceMcpGrantsTable)
      .where(eq(driverInstanceMcpGrantsTable.driverInstanceId, input.driverInstanceId)),
  ]);
  const upserted =
    (await database
      .insert(driverInstancesTable)
      .values(driverRecord)
      .onConflictDoUpdate({
        set: {
          bootTokenExpiresAt: sql`excluded.boot_token_expires_at`,
          bootTokenHash: sql`excluded.boot_token_hash`,
          bootTokenUsedAt: null,
          closeCode: null,
          closeReason: null,
          connectionId: null,
          createdAt: sql`excluded.created_at`,
          driverPid: null,
          driverStartedAt: null,
          driverVersion: null,
          errorMessage: null,
          expiresAt: sql`excluded.expires_at`,
          generation: sql`${driverInstancesTable.generation} + 1`,
          heartbeatCount: 0,
          lastHeartbeatAt: null,
          processId: null,
          protocol: sql`excluded.protocol`,
          protocolVersion: sql`excluded.protocol_version`,
          restartCount: sql`${driverInstancesTable.restartCount} + 1`,
          runtime: sql`excluded.runtime`,
          sandboxId: sql`excluded.sandbox_id`,
          sandboxSessionId: sql`excluded.sandbox_session_id`,
          status: sql`excluded.status`,
          statusChangedAt: sql`excluded.status_changed_at`,
          statusEvent: sql`excluded.status_event`,
          statusOperationId: null,
          statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
          statusSource: sql`excluded.status_source`,
          updatedAt: sql`excluded.updated_at`,
        },
        target: driverInstancesTable.id,
      })
      .returning({
        bootTokenExpiresAt: driverInstancesTable.bootTokenExpiresAt,
        generation: driverInstancesTable.generation,
      })
      .get()) ?? null;

  if (mcpGrantRows.length > 0) {
    await database.insert(driverInstanceMcpGrantsTable).values(mcpGrantRows).run();
  }

  if (upserted === null) {
    throw new Error("Driver instance record was not created.");
  }

  return {
    bootTokenExpiresAt: upserted.bootTokenExpiresAt,
    generation: upserted.generation,
    status: "created",
  };
}

export async function driverInstanceRecordMatchesBootToken(
  database: D1Database,
  input: {
    bootTokenHash: Uint8Array;
    driverInstanceId: DriverInstanceId;
    generation?: number;
  },
): Promise<boolean> {
  const conditions: SQL[] = [
    eq(driverInstancesTable.id, input.driverInstanceId),
    eq(driverInstancesTable.bootTokenHash, input.bootTokenHash),
  ];

  if (input.generation !== undefined) {
    conditions.push(eq(driverInstancesTable.generation, input.generation));
  }

  const row =
    (await getAppDatabase(database)
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(and(...conditions))
      .limit(1)
      .get()) ?? null;

  return row !== null;
}

export async function getDriverInstanceRecord(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<{
  generation: number;
  sandboxId: SandboxId;
  sandboxSessionId: SessionId;
  status: DriverInstanceStatus;
} | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        generation: driverInstancesTable.generation,
        sandboxId: driverInstancesTable.sandboxId,
        sandboxSessionId: driverInstancesTable.sandboxSessionId,
        status: driverInstancesTable.status,
      })
      .from(driverInstancesTable)
      .where(eq(driverInstancesTable.id, driverInstanceId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return row;
}

export async function getReusableDriverInstanceRecord(
  database: D1Database,
  input: {
    sandboxId: SandboxId;
    sandboxSessionId: SessionId;
  },
): Promise<{
  generation: number;
  id: DriverInstanceId;
  status: DriverInstanceStatus;
} | null> {
  return (
    (await getAppDatabase(database)
      .select({
        generation: driverInstancesTable.generation,
        id: driverInstancesTable.id,
        status: driverInstancesTable.status,
      })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.sandboxId, input.sandboxId),
          eq(driverInstancesTable.sandboxSessionId, input.sandboxSessionId),
          inArray(driverInstancesTable.status, REUSABLE_DRIVER_INSTANCE_STATUSES),
        ),
      )
      .orderBy(desc(driverInstancesTable.updatedAt))
      .limit(1)
      .get()) ?? null
  );
}

export async function recordRuntimeProcessStarted(
  bindings: ApiBindings,
  driverInstanceId: DriverInstanceId,
  processId: string,
  options: {
    expectedBootTokenHash?: Uint8Array;
    expectedGeneration?: number;
  } = {},
): Promise<boolean> {
  const now = currentTimestampMs();
  const conditions: SQL[] = [
    eq(driverInstancesTable.id, driverInstanceId),
    notInArray(driverInstancesTable.status, ["stopped", "failed"]),
  ];

  if (options.expectedBootTokenHash !== undefined) {
    conditions.push(eq(driverInstancesTable.bootTokenHash, options.expectedBootTokenHash));
  }

  if (options.expectedGeneration !== undefined) {
    conditions.push(eq(driverInstancesTable.generation, options.expectedGeneration));
  }

  const row =
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        processId,
        updatedAt: now,
      })
      .where(and(...conditions))
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  return row !== null;
}

export async function markDriverInstanceFailedIfBootTokenMatches(
  bindings: ApiBindings,
  input: {
    bootTokenHash: Uint8Array;
    driverInstanceId: DriverInstanceId;
    errorMessage: string;
    generation?: number;
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const conditions: SQL[] = [
    eq(driverInstancesTable.id, input.driverInstanceId),
    eq(driverInstancesTable.bootTokenHash, input.bootTokenHash),
    inArray(driverInstancesTable.status, LIVE_DRIVER_INSTANCE_STATUSES),
  ];

  if (input.generation !== undefined) {
    conditions.push(eq(driverInstancesTable.generation, input.generation));
  }

  const row =
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        errorMessage: input.errorMessage,
        expiresAt: driverInstanceExpiresAt(now),
        heartbeatCount: 0,
        status: "failed",
        statusChangedAt: now,
        statusEvent: toDriverInstanceStatusLifecycleEventName("failed"),
        statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
        statusSource: "api",
        updatedAt: now,
      })
      .where(and(...conditions))
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  return row !== null;
}
