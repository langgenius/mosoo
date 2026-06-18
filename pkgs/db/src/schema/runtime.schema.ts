import type { AgentKind } from "@mosoo/contracts/agent";
import type { DriverInstanceProtocol } from "@mosoo/contracts/driver-instance";
import type { McpAuthType, McpAuthorizationState } from "@mosoo/contracts/mcp";
import type { RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";
import type {
  DriverInstanceStatus,
  RuntimeSubjectErrorCode,
  SandboxBackupStatus,
  SandboxSessionStatus,
  SandboxStatus,
  SandboxSubjectKind,
} from "@mosoo/contracts/sandbox";
import type {
  CredentialId,
  DriverCommandId,
  DriverInstanceId,
  McpServerId,
  PlatformId,
  AppId,
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
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";
import { sessionsTable } from "./session/core.schema";

export const sandboxesTable = sqliteTable(
  "sandbox",
  {
    bindMountReady: integer("bind_mount_ready", { mode: "boolean" }).notNull().default(false),
    claimExpiresAt: integer("claim_expires_at"),
    claimOwner: text("claim_owner"),
    createdAt: integer("created_at").notNull(),
    globalMountsJson: text("global_mounts_json").notNull().default("[]"),
    id: platformIdColumn<SandboxId>("id").primaryKey(),
    inactiveDeadlineAt: integer("inactive_deadline_at"),
    kind: text("kind").$type<AgentKind>().notNull(),
    lastBackupId: platformIdColumn<SandboxBackupId>("last_backup_id"),
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code").$type<RuntimeSubjectErrorCode>(),
    lastRestoreBackupId: platformIdColumn<SandboxBackupId>("last_restore_backup_id"),
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
      sql`${table.status} IN ('cold', 'restoring', 'active', 'backing_up', 'destroying', 'error')`,
    ),
    check("sandbox_status_seq_check", sql`${table.statusSeq} >= 0`),
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
    createdAt: integer("created_at").notNull(),
    cwd: text("cwd").notNull(),
    originJson: text("origin_json").notNull(),
    sandboxId: platformIdColumn<SandboxId>("sandbox_id").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .primaryKey()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    status: text("status").$type<SandboxSessionStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("sandbox_session_sandbox_status_idx").on(table.sandboxId, table.status, table.updatedAt),
    uniqueIndex("sandbox_session_cloudflare_session_idx").on(table.sandboxSessionId),
  ],
);

export const sandboxBackupsTable = sqliteTable(
  "sandbox_backup",
  {
    createdAt: integer("created_at").notNull(),
    dir: text("dir").notNull(),
    errorMessage: text("error_message"),
    id: platformIdColumn<SandboxBackupId>("id").primaryKey(),
    keep: integer("keep", { mode: "boolean" }).notNull().default(false),
    sandboxId: platformIdColumn<SandboxId>("sandbox_id").notNull(),
    status: text("status").$type<SandboxBackupStatus>().notNull(),
    ttlSeconds: integer("ttl_seconds").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("sandbox_backup_sandbox_status_created_idx").on(
      table.sandboxId,
      table.status,
      table.createdAt,
    ),
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
      table.sandboxSessionId,
      table.status,
      table.updatedAt,
    ),
    uniqueIndex("driver_instance_live_sandbox_session_idx")
      .on(table.sandboxId, table.sandboxSessionId)
      .where(sql`${table.status} IN ('provisioning', 'connecting', 'ready', 'stopping')`),
  ],
);

export const driverCommandsTable = sqliteTable(
  "driver_command",
  {
    ackedAt: integer("acked_at"),
    completedAt: integer("completed_at"),
    deliveryConnectionId: text("delivery_connection_id"),
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
    uniqueIndex("driver_command_instance_seq_idx").on(table.driverInstanceId, table.seq),
    index("driver_command_instance_status_idx").on(
      table.driverInstanceId,
      table.status,
      table.expiresAt,
    ),
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
    appId: platformIdColumn<AppId>("app_id").notNull(),
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
    createdAt: integer("created_at").notNull(),
    kind: text("kind")
      .$type<"acp_session_id" | "claude_session_id" | "openai_thread_id">()
      .notNull(),
    observedDriverInstanceId: platformIdColumn<DriverInstanceId>("observed_driver_instance_id"),
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
  (table) => [index("native_resume_ref_runtime_updated_idx").on(table.runtimeId, table.updatedAt)],
);

export type SandboxRow = typeof sandboxesTable.$inferSelect;
export type SandboxSessionRow = typeof sandboxSessionsTable.$inferSelect;
export type SandboxBackupRow = typeof sandboxBackupsTable.$inferSelect;
export type DriverCommandRow = typeof driverCommandsTable.$inferSelect;
export type DriverInstanceMcpGrantRow = typeof driverInstanceMcpGrantsTable.$inferSelect;
export type DriverInstanceRow = typeof driverInstancesTable.$inferSelect;
export type NativeResumeRefRow = typeof nativeResumeRefsTable.$inferSelect;
