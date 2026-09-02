import type { AgentKind } from "@mosoo/contracts/agent";
import type { DriverInstanceProtocol } from "@mosoo/contracts/driver-instance";
import type {
  ExternalToolEffectAttemptStatus,
  ExternalToolEffectStatus,
} from "@mosoo/contracts/external-tool-effect";
import type { McpAuthType, McpAuthorizationState } from "@mosoo/contracts/mcp";
import type { RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";
import type {
  DriverInstanceStatus,
  RuntimeSubjectErrorCode,
  SandboxBackupStatus,
  SandboxOperationKind,
  SandboxSessionStatus,
  SandboxStatus,
  SandboxSubjectKind,
} from "@mosoo/contracts/sandbox";
import type {
  AccountId,
  AgentId,
  CredentialId,
  DriverCommandId,
  DriverInstanceId,
  ExternalToolEffectId,
  McpServerId,
  PlatformId,
  ProjectId,
  RuntimeOperationId,
  SandboxBackupId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";
import { sessionsTable } from "./session/core.schema";
import { sessionRunsTable } from "./session/runs.schema";

export const sandboxesTable = sqliteTable(
  "sandbox",
  {
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    projectId: platformIdColumn<ProjectId>("project_id").notNull(),
    bindMountReady: integer("bind_mount_ready", { mode: "boolean" }).notNull().default(false),
    claimExpiresAt: integer("claim_expires_at"),
    claimOwner: text("claim_owner"),
    createdAt: integer("created_at").notNull(),
    globalMountsJson: text("global_mounts_json").notNull().default("[]"),
    id: platformIdColumn<SandboxId>("id").primaryKey(),
    inactiveDeadlineAt: integer("inactive_deadline_at"),
    incarnation: integer("incarnation").notNull().default(0),
    kind: text("kind").$type<AgentKind>().notNull(),
    lastBackupId: platformIdColumn<SandboxBackupId>("last_backup_id"),
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code").$type<RuntimeSubjectErrorCode>(),
    lastRestoreBackupId: platformIdColumn<SandboxBackupId>("last_restore_backup_id"),
    networkConstraintsHash: text("network_constraints_hash"),
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id").notNull(),
    operationKind: text("operation_kind").$type<SandboxOperationKind>(),
    status: text("status").$type<SandboxStatus>().notNull(),
    statusChangedAt: integer("status_changed_at").notNull().default(0),
    statusEvent: text("status_event").notNull().default("runtime_subject.cold"),
    statusOperationId: platformIdColumn<RuntimeOperationId>("status_operation_id"),
    statusSeq: integer("status_seq").notNull().default(0),
    statusSource: text("status_source").notNull().default("system"),
    subjectId: platformIdColumn<PlatformId>("subject_id").notNull(),
    subjectKind: text("subject_kind").$type<SandboxSubjectKind>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "sandbox_status_check",
      sql`${table.status} IN ('cold', 'restoring', 'active', 'backing_up', 'destroying')`,
    ),
    check("sandbox_status_seq_check", sql`${table.statusSeq} >= 0`),
    check(
      "sandbox_incarnation_check",
      sql`typeof(${table.incarnation}) = 'integer' AND ${table.incarnation} BETWEEN 0 AND 9007199254740991 AND (${table.status} = 'cold' OR ${table.incarnation} > 0)`,
    ),
    check(
      "sandbox_identity_check",
      sql`(${table.kind} = 'pet' AND ${table.subjectKind} = 'agent' AND ${table.subjectId} = ${table.agentId}) OR (${table.kind} = 'cattle' AND ${table.subjectKind} = 'session')`,
    ),
    check(
      "sandbox_network_constraints_hash_check",
      sql`(${table.networkConstraintsHash} IS NULL AND ${table.status} = 'cold') OR (${table.networkConstraintsHash} IS NOT NULL AND length(${table.networkConstraintsHash}) = 64 AND ${table.networkConstraintsHash} = lower(${table.networkConstraintsHash}) AND ${table.networkConstraintsHash} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "sandbox_operation_state_check",
      sql`(${table.status} IN ('cold', 'active') AND ${table.operationKind} IS NULL AND ${table.statusOperationId} IS NULL) OR (${table.status} = 'restoring' AND ${table.operationKind} = 'activate' AND ${table.statusOperationId} IS NOT NULL) OR (${table.status} = 'backing_up' AND ${table.operationKind} IN ('hibernate', 'recreate', 'reset') AND ${table.statusOperationId} IS NOT NULL) OR (${table.status} = 'destroying' AND ${table.operationKind} IN ('activate', 'hibernate', 'recreate', 'reset') AND ${table.statusOperationId} IS NOT NULL)`,
    ),
    check(
      "sandbox_claim_check",
      sql`(${table.claimOwner} IS NULL AND ${table.claimExpiresAt} IS NULL) OR (${table.claimOwner} IS NOT NULL AND typeof(${table.claimExpiresAt}) = 'integer' AND ${table.claimExpiresAt} BETWEEN 0 AND 9007199254740991)`,
    ),
    check(
      "sandbox_operation_claim_check",
      sql`${table.status} IN ('cold', 'active') OR ${table.claimOwner} IS NOT NULL`,
    ),
    uniqueIndex("sandbox_subject_idx").on(table.kind, table.subjectKind, table.subjectId),
    index("sandbox_status_deadline_idx").on(
      table.status,
      table.inactiveDeadlineAt,
      table.updatedAt,
    ),
    index("sandbox_claim_idx").on(table.claimExpiresAt, table.claimOwner),
  ],
);

export const sandboxSessionsTable = sqliteTable(
  "sandbox_session",
  {
    sandboxSessionId: platformIdColumn<SandboxSessionId>("cloudflare_session_id").notNull(),
    cleanupOperationId: platformIdColumn<RuntimeOperationId>("cleanup_operation_id"),
    createdAt: integer("created_at").notNull(),
    cwd: text("cwd").notNull(),
    originJson: text("origin_json").notNull(),
    sandboxId: platformIdColumn<SandboxId>("sandbox_id").notNull(),
    sandboxIncarnation: integer("sandbox_incarnation").notNull().default(0),
    sessionId: platformIdColumn<SessionId>("session_id")
      .primaryKey()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    status: text("status").$type<SandboxSessionStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "sandbox_session_cleanup_check",
      sql`(${table.status} = 'cleanup_pending' AND ${table.cleanupOperationId} IS NOT NULL) OR (${table.status} <> 'cleanup_pending' AND ${table.cleanupOperationId} IS NULL)`,
    ),
    check(
      "sandbox_session_status_incarnation_check",
      sql`${table.status} IN ('active', 'cleanup_pending', 'closed', 'error') AND typeof(${table.sandboxIncarnation}) = 'integer' AND ${table.sandboxIncarnation} BETWEEN 0 AND 9007199254740991 AND (${table.status} IN ('closed', 'error') OR ${table.sandboxIncarnation} > 0)`,
    ),
    index("sandbox_session_status_updated_idx").on(table.status, table.updatedAt, table.sessionId),
    index("sandbox_session_sandbox_status_idx").on(table.sandboxId, table.status, table.updatedAt),
    uniqueIndex("sandbox_session_cloudflare_session_idx").on(table.sandboxSessionId),
  ],
);

export const sandboxBackupsTable = sqliteTable(
  "sandbox_backup",
  {
    createdAt: integer("created_at").notNull(),
    dir: text("dir").notNull(),
    id: platformIdColumn<SandboxBackupId>("id").primaryKey(),
    keep: integer("keep", { mode: "boolean" }).notNull().default(false),
    operationId: platformIdColumn<RuntimeOperationId>("operation_id"),
    sandboxId: platformIdColumn<SandboxId>("sandbox_id").notNull(),
    sandboxIncarnation: integer("sandbox_incarnation").notNull(),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id"),
    stagingId: platformIdColumn<SandboxBackupId>("staging_id").notNull(),
    status: text("status").$type<SandboxBackupStatus>().notNull(),
    ttlSeconds: integer("ttl_seconds").notNull(),
    updatedAt: integer("updated_at").notNull(),
    workspaceSessionId: platformIdColumn<SessionId>("workspace_session_id"),
  },
  (table) => [
    index("sandbox_backup_sandbox_status_dir_created_idx").on(
      table.sandboxId,
      table.status,
      table.dir,
      table.createdAt,
      table.id,
    ),
    index("sandbox_backup_workspace_status_updated_idx").on(
      table.workspaceSessionId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    check("sandbox_backup_status_check", sql`${table.status} IN ('ready', 'pruned')`),
    check(
      "sandbox_backup_dir_check",
      sql`typeof(${table.dir}) = 'text' AND length(${table.dir}) > 0`,
    ),
    check(
      "sandbox_backup_keep_check",
      sql`typeof(${table.keep}) = 'integer' AND ${table.keep} IN (false, true)`,
    ),
    check(
      "sandbox_backup_incarnation_check",
      sql`typeof(${table.sandboxIncarnation}) = 'integer' AND ${table.sandboxIncarnation} BETWEEN 0 AND 9007199254740991 AND (${table.sandboxIncarnation} > 0 OR ${table.stagingId} = ${table.id})`,
    ),
    check(
      "sandbox_backup_ttl_check",
      sql`typeof(${table.ttlSeconds}) = 'integer' AND ${table.ttlSeconds} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "sandbox_backup_timestamps_check",
      sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} BETWEEN 0 AND 9007199254740991 AND typeof(${table.updatedAt}) = 'integer' AND ${table.updatedAt} BETWEEN ${table.createdAt} AND 9007199254740991`,
    ),
    check(
      "sandbox_backup_scope_check",
      sql`(${table.sessionRunId} IS NULL OR ${table.workspaceSessionId} IS NOT NULL) AND ((${table.operationId} IS NOT NULL) <> (${table.sessionRunId} IS NOT NULL) OR (${table.operationId} IS NULL AND ${table.sessionRunId} IS NULL AND ${table.workspaceSessionId} IS NULL AND ${table.stagingId} = ${table.id} AND ${table.sandboxIncarnation} = 0))`,
    ),
    uniqueIndex("sandbox_backup_staging_idx").on(table.stagingId),
    uniqueIndex("sandbox_backup_terminal_checkpoint_idx")
      .on(table.sandboxId, table.sandboxIncarnation, table.dir, table.sessionRunId)
      .where(sql`${table.sessionRunId} IS NOT NULL`),
    uniqueIndex("sandbox_backup_operation_checkpoint_idx")
      .on(table.sandboxId, table.sandboxIncarnation, table.operationId, table.dir)
      .where(sql`${table.operationId} IS NOT NULL`),
  ],
);

export const sandboxBackupDeleteIntentsTable = sqliteTable(
  "sandbox_backup_delete_intent",
  {
    attemptedAt: integer("attempted_at"),
    backupId: platformIdColumn<SandboxBackupId>("backup_id").primaryKey(),
    createdAt: integer("created_at").notNull(),
    deleteAfter: integer("delete_after").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("sandbox_backup_delete_intent_pending_idx")
      .on(table.deleteAfter, table.attemptedAt, table.createdAt, table.backupId)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "sandbox_backup_delete_intent_time_check",
      sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} BETWEEN 0 AND 9007199254740991 AND typeof(${table.deleteAfter}) = 'integer' AND ${table.deleteAfter} BETWEEN ${table.createdAt} AND 9007199254740991 AND (${table.attemptedAt} IS NULL OR (typeof(${table.attemptedAt}) = 'integer' AND ${table.attemptedAt} BETWEEN ${table.deleteAfter} AND 9007199254740991)) AND (${table.deletedAt} IS NULL OR (typeof(${table.deletedAt}) = 'integer' AND ${table.deletedAt} BETWEEN coalesce(${table.attemptedAt}, ${table.deleteAfter}) AND 9007199254740991))`,
    ),
  ],
);

export const sandboxBackupStagingTable = sqliteTable(
  "sandbox_backup_staging",
  {
    actualBackupId: platformIdColumn<SandboxBackupId>("actual_backup_id"),
    claimOwner: text("claim_owner"),
    createdAt: integer("created_at").notNull(),
    dir: text("dir").notNull(),
    driverGeneration: integer("driver_generation"),
    driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id"),
    id: platformIdColumn<SandboxBackupId>("id").primaryKey(),
    operationId: platformIdColumn<RuntimeOperationId>("operation_id"),
    sandboxId: platformIdColumn<SandboxId>("sandbox_id").notNull(),
    sandboxIncarnation: integer("sandbox_incarnation").notNull(),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id"),
    ttlSeconds: integer("ttl_seconds").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatesSubjectBackup: integer("updates_subject_backup", { mode: "boolean" })
      .notNull()
      .default(false),
    workspaceSessionId: platformIdColumn<SessionId>("workspace_session_id"),
  },
  (table) => [
    index("sandbox_backup_staging_updated_idx").on(table.updatedAt, table.id),
    check(
      "sandbox_backup_staging_claim_owner_check",
      sql`${table.claimOwner} IS NULL OR (typeof(${table.claimOwner}) = 'text' AND length(${table.claimOwner}) > 0)`,
    ),
    check(
      "sandbox_backup_staging_dir_check",
      sql`typeof(${table.dir}) = 'text' AND length(${table.dir}) > 0`,
    ),
    check(
      "sandbox_backup_staging_incarnation_check",
      sql`typeof(${table.sandboxIncarnation}) = 'integer' AND ${table.sandboxIncarnation} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "sandbox_backup_staging_ttl_check",
      sql`typeof(${table.ttlSeconds}) = 'integer' AND ${table.ttlSeconds} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "sandbox_backup_staging_timestamps_check",
      sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} BETWEEN 0 AND 9007199254740991 AND typeof(${table.updatedAt}) = 'integer' AND ${table.updatedAt} BETWEEN ${table.createdAt} AND 9007199254740991`,
    ),
    check(
      "sandbox_backup_staging_scope_check",
      sql`((${table.operationId} IS NOT NULL AND ${table.claimOwner} IS NOT NULL AND ${table.sessionRunId} IS NULL AND ${table.driverInstanceId} IS NULL AND ${table.driverGeneration} IS NULL) OR (${table.operationId} IS NULL AND ${table.claimOwner} IS NULL AND ${table.sessionRunId} IS NOT NULL AND ${table.workspaceSessionId} IS NOT NULL AND ${table.driverInstanceId} IS NOT NULL AND typeof(${table.driverGeneration}) = 'integer' AND ${table.driverGeneration} BETWEEN 0 AND 9007199254740991)) AND (${table.updatesSubjectBackup} = false OR (${table.operationId} IS NOT NULL AND ${table.workspaceSessionId} IS NULL))`,
    ),
    check(
      "sandbox_backup_staging_updates_subject_check",
      sql`typeof(${table.updatesSubjectBackup}) = 'integer' AND ${table.updatesSubjectBackup} IN (false, true)`,
    ),
    uniqueIndex("sandbox_backup_staging_actual_idx")
      .on(table.actualBackupId)
      .where(sql`${table.actualBackupId} IS NOT NULL`),
    uniqueIndex("sandbox_backup_staging_terminal_checkpoint_idx")
      .on(table.sandboxId, table.sandboxIncarnation, table.dir, table.sessionRunId)
      .where(sql`${table.sessionRunId} IS NOT NULL`),
    uniqueIndex("sandbox_backup_staging_operation_checkpoint_idx")
      .on(table.sandboxId, table.sandboxIncarnation, table.operationId, table.dir)
      .where(sql`${table.operationId} IS NOT NULL`),
  ],
);

export const driverInstancesTable = sqliteTable(
  "driver_instance",
  {
    bootTokenExpiresAt: integer("boot_token_expires_at").notNull(),
    bootTokenHash: blob("boot_token_hash").notNull(),
    bootTokenUsedAt: integer("boot_token_used_at"),
    closeCode: integer("close_code"),
    closeReason: text("close_reason"),
    connectionId: text("connection_id"),
    createdAt: integer("created_at").notNull(),
    commandSeqCursor: integer("command_seq_cursor").notNull().default(0),
    driverPid: integer("driver_pid"),
    driverStartedAt: integer("driver_started_at"),
    driverVersion: text("driver_version"),
    errorMessage: text("error_message"),
    expiresAt: integer("expires_at").notNull(),
    heartbeatCount: integer("heartbeat_count").notNull(),
    generation: integer("generation").notNull().default(0),
    id: platformIdColumn<DriverInstanceId>("id").primaryKey(),
    lastHeartbeatAt: integer("last_heartbeat_at"),
    processId: text("process_id"),
    protocol: text("protocol").$type<DriverInstanceProtocol>().notNull(),
    protocolVersion: integer("protocol_version").notNull(),
    restartCount: integer("restart_count").notNull().default(0),
    runtime: text("runtime")
      .$type<"acp-fallback" | "claude-agent-sdk" | "openai-runtime">()
      .notNull(),
    sandboxId: platformIdColumn<SandboxId>("sandbox_id").notNull(),
    sandboxIncarnation: integer("sandbox_incarnation").notNull().default(0),
    sandboxSessionId: platformIdColumn<SessionId>("sandbox_session_id").notNull(),
    status: text("status").$type<DriverInstanceStatus>().notNull(),
    statusChangedAt: integer("status_changed_at").notNull().default(0),
    statusEvent: text("status_event").notNull().default("driver.provision"),
    statusOperationId: platformIdColumn<RuntimeOperationId>("status_operation_id"),
    statusSeq: integer("status_seq").notNull().default(0),
    statusSource: text("status_source").notNull().default("system"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "driver_instance_status_check",
      sql`${table.status} IN ('provisioning', 'connecting', 'ready', 'stopping', 'stopped', 'failed')`,
    ),
    check("driver_instance_status_seq_check", sql`${table.statusSeq} >= 0`),
    check(
      "driver_instance_generation_incarnation_check",
      sql`typeof(${table.generation}) = 'integer' AND ${table.generation} BETWEEN 0 AND 9007199254740991 AND typeof(${table.sandboxIncarnation}) = 'integer' AND ${table.sandboxIncarnation} BETWEEN 0 AND 9007199254740991 AND (${table.status} IN ('stopped', 'failed') OR ${table.sandboxIncarnation} > 0)`,
    ),
    index("driver_instance_completed_idx").on(table.expiresAt, table.status),
    uniqueIndex("driver_instance_connection_idx")
      .on(table.connectionId)
      .where(sql`${table.connectionId} IS NOT NULL`),
    index("driver_instance_boot_token_expiry_idx")
      .on(table.status, table.bootTokenExpiresAt)
      .where(sql`${table.bootTokenUsedAt} IS NULL`),
    uniqueIndex("driver_instance_boot_token_hash_idx").on(table.bootTokenHash),
    index("driver_instance_sandbox_session_idx").on(
      table.sandboxId,
      table.sandboxIncarnation,
      table.sandboxSessionId,
      table.status,
      table.updatedAt,
    ),
    uniqueIndex("driver_instance_live_sandbox_session_idx")
      .on(table.sandboxId, table.sandboxIncarnation, table.sandboxSessionId)
      .where(sql`${table.status} IN ('provisioning', 'connecting', 'ready', 'stopping')`),
  ],
);

export const driverCommandsTable = sqliteTable(
  "driver_command",
  {
    ackedAt: integer("acked_at"),
    completedAt: integer("completed_at"),
    deliveryConnectionId: text("delivery_connection_id"),
    driverGeneration: integer("driver_generation"),
    driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id")
      .notNull()
      .references(() => driverInstancesTable.id, { onDelete: "cascade" }),
    errorJson: text("error_json"),
    expiresAt: integer("expires_at"),
    id: platformIdColumn<DriverCommandId>("id").primaryKey(),
    issuedAt: integer("issued_at").notNull(),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    resultJson: text("result_json"),
    seq: integer("seq").notNull(),
    status: text("status").$type<RuntimeCommandStatus>().notNull(),
  },
  (table) => [
    check(
      "driver_command_generation_check",
      sql`${table.driverGeneration} IS NULL OR (typeof(${table.driverGeneration}) = 'integer' AND ${table.driverGeneration} BETWEEN 0 AND 9007199254740991)`,
    ),
    check(
      "driver_command_nonterminal_generation_check",
      sql`${table.status} IN ('completed', 'failed', 'expired', 'cancelled') OR ${table.driverGeneration} IS NOT NULL`,
    ),
    uniqueIndex("driver_command_instance_seq_idx").on(table.driverInstanceId, table.seq),
    index("driver_command_instance_status_idx").on(
      table.driverInstanceId,
      table.status,
      table.expiresAt,
    ),
  ],
);

/**
 * The durable fence around a write-capable MCP call. A command is allowed to
 * invoke the provider only after this record moves from intent to claimed.
 */
export const externalToolEffectsTable = sqliteTable(
  "external_tool_effect",
  {
    attemptCount: integer("attempt_count").notNull().default(0),
    claimToken: text("claim_token"),
    commandId: platformIdColumn<DriverCommandId>("command_id")
      .notNull()
      .references(() => driverCommandsTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id")
      .notNull()
      .references(() => driverInstancesTable.id, { onDelete: "cascade" }),
    id: platformIdColumn<ExternalToolEffectId>("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerReceiptJson: text("provider_receipt_json"),
    resultJson: text("result_json"),
    serverId: platformIdColumn<McpServerId>("server_id").notNull(),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id")
      .notNull()
      .references(() => sessionRunsTable.id, { onDelete: "cascade" }),
    status: text("status").$type<ExternalToolEffectStatus>().notNull(),
    toolName: text("tool_name").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "external_tool_effect_status_check",
      sql`${table.status} IN ('intent', 'claimed', 'succeeded', 'unknown')`,
    ),
    check(
      "external_tool_effect_claim_token_uuid_check",
      sql`${table.claimToken} IS NULL OR (length(${table.claimToken}) = 36 AND length(replace(${table.claimToken}, '-', '')) = 32 AND ${table.claimToken} = lower(${table.claimToken}) AND substr(${table.claimToken}, 9, 1) = '-' AND substr(${table.claimToken}, 14, 1) = '-' AND substr(${table.claimToken}, 15, 1) = '4' AND substr(${table.claimToken}, 19, 1) = '-' AND substr(${table.claimToken}, 20, 1) GLOB '[89ab]' AND substr(${table.claimToken}, 24, 1) = '-' AND replace(${table.claimToken}, '-', '') NOT GLOB '*[^0-9a-f]*')`,
    ),
    uniqueIndex("external_tool_effect_command_idx").on(table.commandId),
    uniqueIndex("external_tool_effect_idempotency_key_idx").on(table.idempotencyKey),
    index("external_tool_effect_run_status_idx").on(table.sessionRunId, table.status, table.id),
    index("external_tool_effect_driver_status_idx").on(table.driverInstanceId, table.status),
  ],
);

/**
 * Append-only execution observations. A provider response is optional because
 * MCP does not define a portable receipt or reconciliation endpoint.
 */
export const externalToolEffectAttemptsTable = sqliteTable(
  "external_tool_effect_attempt",
  {
    attempt: integer("attempt").notNull(),
    claimToken: text("claim_token").notNull(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    effectId: platformIdColumn<ExternalToolEffectId>("effect_id")
      .notNull()
      .references(() => externalToolEffectsTable.id, { onDelete: "cascade" }),
    providerReceiptJson: text("provider_receipt_json"),
    resultJson: text("result_json"),
    status: text("status").$type<ExternalToolEffectAttemptStatus>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.effectId, table.attempt],
    }),
    check(
      "external_tool_effect_attempt_status_check",
      sql`${table.status} IN ('claimed', 'succeeded', 'unknown')`,
    ),
    check(
      "external_tool_effect_attempt_claim_token_uuid_check",
      sql`length(${table.claimToken}) = 36 AND length(replace(${table.claimToken}, '-', '')) = 32 AND ${table.claimToken} = lower(${table.claimToken}) AND substr(${table.claimToken}, 9, 1) = '-' AND substr(${table.claimToken}, 14, 1) = '-' AND substr(${table.claimToken}, 15, 1) = '4' AND substr(${table.claimToken}, 19, 1) = '-' AND substr(${table.claimToken}, 20, 1) GLOB '[89ab]' AND substr(${table.claimToken}, 24, 1) = '-' AND replace(${table.claimToken}, '-', '') NOT GLOB '*[^0-9a-f]*'`,
    ),
    index("external_tool_effect_attempt_status_idx").on(table.status, table.createdAt),
  ],
);

export const driverInstanceMcpGrantsTable = sqliteTable(
  "driver_instance_mcp_grant",
  {
    authType: text("auth_type").$type<McpAuthType>().notNull(),
    authorizationState: text("authorization_state").$type<McpAuthorizationState>().notNull(),
    canInvalidate: integer("can_invalidate", { mode: "boolean" }).notNull().default(false),
    canRefresh: integer("can_refresh", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    credentialId: platformIdColumn<CredentialId>("credential_id"),
    driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id")
      .notNull()
      .references(() => driverInstancesTable.id, { onDelete: "cascade" }),
    projectId: platformIdColumn<ProjectId>("project_id").notNull(),
    serverId: platformIdColumn<McpServerId>("server_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("driver_instance_mcp_grant_instance_server_idx").on(
      table.driverInstanceId,
      table.serverId,
    ),
    index("driver_instance_mcp_grant_instance_credential_idx").on(
      table.driverInstanceId,
      table.credentialId,
    ),
  ],
);

export const nativeResumeRefsTable = sqliteTable(
  "native_resume_ref",
  {
    committedSessionRunId: platformIdColumn<SessionRunId>("committed_session_run_id"),
    committedValue: text("committed_value"),
    createdAt: integer("created_at").notNull(),
    kind: text("kind")
      .$type<"acp_session_id" | "claude_session_id" | "openai_thread_id">()
      .notNull(),
    observedDriverInstanceId: platformIdColumn<DriverInstanceId>("observed_driver_instance_id"),
    observedEventSeq: integer("observed_event_seq").notNull().default(0),
    observedSessionRunId: platformIdColumn<SessionRunId>("observed_session_run_id"),
    runtimeId: text("runtime_id")
      .$type<"acp-fallback" | "claude-agent-sdk" | "openai-runtime">()
      .notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .primaryKey()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    check("native_resume_ref_observed_event_seq_check", sql`${table.observedEventSeq} >= 0`),
    index("native_resume_ref_runtime_updated_idx").on(table.runtimeId, table.updatedAt),
  ],
);

export type SandboxRow = typeof sandboxesTable.$inferSelect;
export type SandboxSessionRow = typeof sandboxSessionsTable.$inferSelect;
export type SandboxBackupRow = typeof sandboxBackupsTable.$inferSelect;
export type DriverCommandRow = typeof driverCommandsTable.$inferSelect;
export type ExternalToolEffectAttemptRow = typeof externalToolEffectAttemptsTable.$inferSelect;
export type ExternalToolEffectRow = typeof externalToolEffectsTable.$inferSelect;
export type DriverInstanceMcpGrantRow = typeof driverInstanceMcpGrantsTable.$inferSelect;
export type DriverInstanceRow = typeof driverInstancesTable.$inferSelect;
export type NativeResumeRefRow = typeof nativeResumeRefsTable.$inferSelect;
