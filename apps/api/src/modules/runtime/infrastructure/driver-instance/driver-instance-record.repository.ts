import { DRIVER_PROTOCOL_VERSION } from "@mosoo/agent-driver/boot";
import type { DriverRuntime } from "@mosoo/agent-driver/runtime";
import {
  driverCommandsTable,
  driverInstanceMcpGrantsTable,
  driverInstancesTable,
  externalToolEffectsTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type { DriverInstanceId, SandboxId, SessionId } from "@mosoo/id";
import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  REUSABLE_DRIVER_INSTANCE_STATUSES,
  LIVE_DRIVER_INSTANCE_STATUSES,
  toDriverInstanceStatusLifecycleEventName,
} from "../../domain/driver-instance-lifecycle.machine";
import {
  DRIVER_BOOT_TOKEN_TTL_MS,
  DRIVER_COLD_READY_TIMEOUT_MS,
  RUNTIME_SOCKET_TIMEOUT_MS,
} from "../../domain/runtime-config";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import type { RuntimeRunProvisioningLease } from "../runtime-subject-lifecycle/runtime-provisioning-lease-store";
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

function selectedValue<Value>(value: Value, alias: string) {
  return sql<Value>`${value}`.as(alias);
}

async function insertProvisioningOwnedDriverRecord(
  database: D1Database,
  input: {
    readonly driverRecord: typeof driverInstancesTable.$inferInsert;
    readonly lease: RuntimeRunProvisioningLease;
  },
): Promise<{ bootTokenExpiresAt: number; generation: number } | null> {
  const { driverRecord: record, lease } = input;
  if (
    lease.sandboxIncarnation === null ||
    lease.sandboxSessionId === null ||
    record.bootTokenExpiresAt === undefined ||
    record.generation === undefined ||
    record.sandboxId !== lease.sandboxId ||
    record.sandboxIncarnation !== lease.sandboxIncarnation ||
    record.sandboxSessionId !== lease.sessionId
  ) {
    throw new Error("Driver provisioning requires a complete immutable sandbox target.");
  }

  const inserted = await database
    .prepare(
      `
        INSERT INTO driver_instance (
          boot_token_expires_at, boot_token_hash, created_at, expires_at,
          generation, heartbeat_count, id, protocol, protocol_version,
          restart_count, runtime, sandbox_id, sandbox_incarnation,
          sandbox_session_id, status, status_changed_at, status_event,
          status_seq, status_source, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM session AS provisioning
        INNER JOIN session_run AS run
          ON run.id = provisioning.runtime_provisioning_run_id
         AND run.session_id = provisioning.id
        INNER JOIN sandbox AS subject
          ON subject.id = provisioning.runtime_provisioning_sandbox_id
        INNER JOIN sandbox_session AS conversation
          ON conversation.session_id = provisioning.id
         AND conversation.sandbox_id = subject.id
        WHERE provisioning.id = ?
          AND provisioning.runtime_provisioning_operation_id = ?
          AND provisioning.runtime_provisioning_run_id = ?
          AND provisioning.runtime_provisioning_sandbox_id = ?
          AND provisioning.runtime_provisioning_sandbox_incarnation = ?
          AND provisioning.runtime_provisioning_sandbox_session_id = ?
          AND provisioning.last_run_id = run.id
          AND provisioning.status = 'RUNNING'
          AND provisioning.archived_at IS NULL
          AND provisioning.cleanup_operation_kind IS NULL
          AND provisioning.status_operation_id IS NULL
          AND run.status IN ('queued', 'booting', 'running', 'waiting_input')
          AND subject.incarnation = ?
          AND subject.status = 'active'
          AND subject.claim_owner IS NULL
          AND subject.operation_kind IS NULL
          AND subject.status_operation_id IS NULL
          AND conversation.sandbox_incarnation = ?
          AND conversation.cloudflare_session_id = ?
          AND conversation.status = 'active'
        ON CONFLICT DO NOTHING
      `,
    )
    .bind(
      record.bootTokenExpiresAt,
      record.bootTokenHash,
      record.createdAt,
      record.expiresAt,
      record.generation,
      record.heartbeatCount,
      record.id,
      record.protocol,
      record.protocolVersion,
      record.restartCount,
      record.runtime,
      record.sandboxId,
      record.sandboxIncarnation,
      record.sandboxSessionId,
      record.status,
      record.statusChangedAt,
      record.statusEvent,
      record.statusSeq,
      record.statusSource,
      record.updatedAt,
      lease.sessionId,
      lease.operationId,
      lease.runId,
      lease.sandboxId,
      lease.sandboxIncarnation,
      lease.sandboxSessionId,
      lease.sandboxIncarnation,
      lease.sandboxIncarnation,
      lease.sandboxSessionId,
    )
    .run();

  return getD1ChangeCount(inserted) === 1
    ? { bootTokenExpiresAt: record.bootTokenExpiresAt, generation: record.generation }
    : null;
}

export async function runtimeProvisioningDriverLaunchIsOwned(
  database: D1Database,
  input: {
    readonly bootTokenHash: Uint8Array;
    readonly driverGeneration: number;
    readonly driverInstanceId: DriverInstanceId;
    readonly lease: RuntimeRunProvisioningLease;
  },
): Promise<boolean> {
  const { lease } = input;
  if (lease.sandboxIncarnation === null || lease.sandboxSessionId === null) {
    return false;
  }

  const row = await getAppDatabase(database)
    .select({ id: driverInstancesTable.id })
    .from(sessionsTable)
    .innerJoin(
      sessionRunsTable,
      and(
        eq(sessionRunsTable.id, sessionsTable.runtimeProvisioningRunId),
        eq(sessionRunsTable.sessionId, sessionsTable.id),
      ),
    )
    .innerJoin(sandboxesTable, eq(sandboxesTable.id, sessionsTable.runtimeProvisioningSandboxId))
    .innerJoin(
      sandboxSessionsTable,
      and(
        eq(sandboxSessionsTable.sessionId, sessionsTable.id),
        eq(sandboxSessionsTable.sandboxId, sandboxesTable.id),
      ),
    )
    .innerJoin(
      driverInstancesTable,
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.sandboxSessionId, sessionsTable.id),
      ),
    )
    .where(
      and(
        eq(sessionsTable.id, lease.sessionId),
        eq(sessionsTable.runtimeProvisioningOperationId, lease.operationId),
        eq(sessionsTable.runtimeProvisioningRunId, lease.runId),
        eq(sessionsTable.runtimeProvisioningSandboxId, lease.sandboxId),
        eq(sessionsTable.runtimeProvisioningSandboxIncarnation, lease.sandboxIncarnation),
        eq(sessionsTable.runtimeProvisioningSandboxSessionId, lease.sandboxSessionId),
        eq(sessionsTable.lastRunId, lease.runId),
        eq(sessionsTable.status, "RUNNING"),
        isNull(sessionsTable.archivedAt),
        isNull(sessionsTable.cleanupOperationKind),
        isNull(sessionsTable.statusOperationId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        eq(sandboxesTable.incarnation, lease.sandboxIncarnation),
        eq(sandboxesTable.status, "active"),
        isNull(sandboxesTable.claimOwner),
        isNull(sandboxesTable.operationKind),
        isNull(sandboxesTable.statusOperationId),
        eq(sandboxSessionsTable.sandboxIncarnation, lease.sandboxIncarnation),
        eq(sandboxSessionsTable.sandboxSessionId, lease.sandboxSessionId),
        eq(sandboxSessionsTable.status, "active"),
        eq(driverInstancesTable.generation, input.driverGeneration),
        eq(driverInstancesTable.bootTokenHash, input.bootTokenHash),
        eq(driverInstancesTable.sandboxId, lease.sandboxId),
        eq(driverInstancesTable.sandboxIncarnation, lease.sandboxIncarnation),
        inArray(driverInstancesTable.status, REUSABLE_DRIVER_INSTANCE_STATUSES),
        isNull(driverInstancesTable.statusOperationId),
      ),
    )
    .limit(1)
    .get();

  return row !== undefined;
}

export async function createDriverInstanceRecord(
  bindings: ApiBindings,
  input: {
    bootTokenHash: Uint8Array;
    conflictStrategy?: "insert-only" | "replace";
    driverInstanceId: DriverInstanceId;
    runtime: DriverRuntime;
    sandboxId: SandboxId;
    sandboxIncarnation: number;
    sandboxSessionId: SessionId;
    mcpGrants?: DriverInstanceMcpGrantRecord[];
    runtimeProvisioningLease?: RuntimeRunProvisioningLease;
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
    projectId: grant.projectId,
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
    sandboxIncarnation: input.sandboxIncarnation,
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
    const inserted = input.runtimeProvisioningLease
      ? await insertProvisioningOwnedDriverRecord(bindings.DB, {
          driverRecord,
          lease: input.runtimeProvisioningLease,
        })
      : ((await database
          .insert(driverInstancesTable)
          .values(driverRecord)
          .onConflictDoNothing()
          .returning({
            bootTokenExpiresAt: driverInstancesTable.bootTokenExpiresAt,
            generation: driverInstancesTable.generation,
          })
          .get()) ?? null);

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

  const [replacement] = await runAppDatabaseBatch(bindings.DB, (batchDb) => {
    const acceptedCommand = batchDb
      .select({ id: driverCommandsTable.id })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.id, externalToolEffectsTable.commandId),
          eq(driverCommandsTable.status, "accepted"),
        ),
      );
    const protectedEffect = batchDb
      .select({ id: externalToolEffectsTable.id })
      .from(externalToolEffectsTable)
      .where(
        and(
          eq(externalToolEffectsTable.driverInstanceId, input.driverInstanceId),
          or(
            inArray(externalToolEffectsTable.status, ["claimed", "unknown"]),
            exists(acceptedCommand),
          ),
        ),
      );
    const replacementAllowed = and(sql`status_operation_id IS NULL`, notExists(protectedEffect))!;
    const replacementDriver = and(
      eq(driverInstancesTable.id, input.driverInstanceId),
      eq(driverInstancesTable.bootTokenHash, input.bootTokenHash),
    );
    const replacementCommitted = exists(
      batchDb
        .select({ id: driverInstancesTable.id })
        .from(driverInstancesTable)
        .where(replacementDriver),
    );

    return [
      batchDb
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
            sandboxIncarnation: sql`excluded.sandbox_incarnation`,
            sandboxSessionId: sql`excluded.sandbox_session_id`,
            status: sql`excluded.status`,
            statusChangedAt: sql`excluded.status_changed_at`,
            statusEvent: sql`excluded.status_event`,
            statusOperationId: null,
            statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
            statusSource: sql`excluded.status_source`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: replacementAllowed,
          target: driverInstancesTable.id,
        }),
      batchDb
        .delete(driverCommandsTable)
        .where(
          and(
            eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
            replacementCommitted,
          ),
        ),
      batchDb
        .delete(driverInstanceMcpGrantsTable)
        .where(
          and(
            eq(driverInstanceMcpGrantsTable.driverInstanceId, input.driverInstanceId),
            replacementCommitted,
          ),
        ),
      ...mcpGrantRows.map((grant) =>
        batchDb.insert(driverInstanceMcpGrantsTable).select(
          batchDb
            .select({
              authType: selectedValue(grant.authType, "auth_type"),
              authorizationState: selectedValue(grant.authorizationState, "authorization_state"),
              canInvalidate: selectedValue(grant.canInvalidate, "can_invalidate"),
              canRefresh: selectedValue(grant.canRefresh, "can_refresh"),
              createdAt: selectedValue(grant.createdAt, "created_at"),
              credentialId: selectedValue(grant.credentialId, "credential_id"),
              driverInstanceId: driverInstancesTable.id,
              projectId: selectedValue(grant.projectId, "project_id"),
              serverId: selectedValue(grant.serverId, "server_id"),
              updatedAt: selectedValue(grant.updatedAt, "updated_at"),
            })
            .from(driverInstancesTable)
            .where(replacementDriver),
        ),
      ),
    ];
  });

  if (getD1ChangeCount(replacement) === 0) {
    throw new Error("Driver instance replacement is blocked by a protected external effect.");
  }

  const database = getAppDatabase(bindings.DB);
  const upserted =
    (await database
      .select({
        bootTokenExpiresAt: driverInstancesTable.bootTokenExpiresAt,
        generation: driverInstancesTable.generation,
      })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.bootTokenHash, input.bootTokenHash),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (upserted === null) {
    throw new Error("Driver instance record was replaced before provisioning could claim it.");
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
  sandboxIncarnation: number;
  sandboxSessionId: SessionId;
  status: DriverInstanceStatus;
} | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        generation: driverInstancesTable.generation,
        sandboxId: driverInstancesTable.sandboxId,
        sandboxIncarnation: driverInstancesTable.sandboxIncarnation,
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

export async function isDriverInstanceGenerationActive(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    generation: number;
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const row =
    (await getAppDatabase(database)
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.generation, input.generation),
          or(
            and(
              eq(driverInstancesTable.status, "provisioning"),
              or(
                isNotNull(driverInstancesTable.bootTokenUsedAt),
                gt(driverInstancesTable.bootTokenExpiresAt, now),
              ),
            ),
            and(
              eq(driverInstancesTable.status, "connecting"),
              gt(
                sql<number>`COALESCE(${driverInstancesTable.lastHeartbeatAt}, ${driverInstancesTable.updatedAt})`,
                now - DRIVER_COLD_READY_TIMEOUT_MS,
              ),
            ),
            and(
              eq(driverInstancesTable.status, "ready"),
              gt(
                sql<number>`COALESCE(${driverInstancesTable.lastHeartbeatAt}, ${driverInstancesTable.updatedAt})`,
                now - RUNTIME_SOCKET_TIMEOUT_MS,
              ),
            ),
          ),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return row !== null;
}

export async function getReusableDriverInstanceRecord(
  database: D1Database,
  input: {
    sandboxId: SandboxId;
    sandboxIncarnation: number;
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
          eq(driverInstancesTable.sandboxIncarnation, input.sandboxIncarnation),
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
    inArray(driverInstancesTable.status, REUSABLE_DRIVER_INSTANCE_STATUSES),
    isNull(driverInstancesTable.statusOperationId),
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
