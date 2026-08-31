import type { AgentKind } from "@mosoo/contracts/agent";
import type { SessionStatus, SessionType } from "@mosoo/contracts/session";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  PlatformId,
  ProjectId,
  RuntimeOperationId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "../id-column";

export const sessionsTable = sqliteTable(
  "session",
  {
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    archivedAt: integer("archived_at"),
    autoTitleEventSeq: integer("auto_title_event_seq"),
    cleanupOperationKind: text("cleanup_operation_kind").$type<"archive" | "delete">(),
    endUserId: text("end_user_id"),
    participantAccountId: platformIdColumn<AccountId>("attributed_user_id"),
    createdAt: integer("created_at").notNull(),
    creatorAccountId: platformIdColumn<PlatformId>("creator_account_id").notNull(),
    deploymentVersionId: platformIdColumn<AgentDeploymentVersionId>("deployment_version_id"),
    deploymentVersionNumber: integer("deployment_version_number"),
    id: platformIdColumn<SessionId>("id").primaryKey(),
    kind: text("kind").$type<AgentKind>().notNull(),
    lastMessageAt: integer("last_message_at"),
    lastRunId: platformIdColumn<SessionRunId>("last_run_id"),
    messageSeqCursor: integer("message_seq_cursor").notNull().default(0),
    metadataJson: text("metadata_json").notNull().default("{}"),
    model: text("model").notNull(),
    projectId: platformIdColumn<ProjectId>("project_id").notNull(),
    provider: text("provider").notNull(),
    renamed: integer("renamed", { mode: "boolean" }).notNull(),
    runtimeId: text("runtime_id").notNull(),
    status: text("status").$type<SessionStatus>().notNull(),
    statusOperationId: platformIdColumn<RuntimeOperationId>("status_operation_id"),
    statusSeq: integer("status_seq").notNull().default(0),
    runtimeEventSeqCursor: integer("runtime_event_seq_cursor").notNull().default(0),
    runtimeProvisioningHeartbeatAt: integer("runtime_provisioning_heartbeat_at"),
    runtimeProvisioningOperationId: platformIdColumn<RuntimeOperationId>(
      "runtime_provisioning_operation_id",
    ),
    runtimeProvisioningRunId: platformIdColumn<SessionRunId>("runtime_provisioning_run_id"),
    runtimeProvisioningSandboxId: platformIdColumn<SandboxId>("runtime_provisioning_sandbox_id"),
    runtimeProvisioningSandboxSessionId: platformIdColumn<SandboxSessionId>(
      "runtime_provisioning_sandbox_session_id",
    ),
    runtimeProvisioningSandboxIncarnation: integer("runtime_provisioning_sandbox_incarnation"),
    title: text("title"),
    type: text("type").$type<SessionType>().notNull().default("preview"),
    updatedAt: integer("updated_at").notNull(),
    // Rollout marker: pre-checkpoint Cattle Threads stay false and retain the
    // artifact fallback until their first successful post-rollout turn.
    workspaceCheckpointRequired: integer("workspace_checkpoint_required", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
  },
  (table) => [
    check(
      "session_cleanup_operation_kind_check",
      sql`${table.cleanupOperationKind} IS NULL OR (${table.cleanupOperationKind} IN ('archive', 'delete') AND ${table.archivedAt} IS NOT NULL AND ${table.status} IN ('IDLE', 'RESCHEDULING') AND (${table.statusOperationId} IS NOT NULL OR (${table.cleanupOperationKind} = 'archive' AND ${table.status} = 'IDLE')))`,
    ),
    check(
      "session_runtime_provisioning_lease_check",
      sql`(${table.runtimeProvisioningOperationId} IS NULL AND ${table.runtimeProvisioningRunId} IS NULL AND ${table.runtimeProvisioningSandboxId} IS NULL AND ${table.runtimeProvisioningHeartbeatAt} IS NULL) OR (${table.runtimeProvisioningOperationId} IS NOT NULL AND ${table.runtimeProvisioningSandboxId} IS NOT NULL AND ${table.runtimeProvisioningHeartbeatAt} IS NOT NULL AND typeof(${table.runtimeProvisioningHeartbeatAt}) = 'integer' AND ${table.runtimeProvisioningHeartbeatAt} >= 0 AND ${table.archivedAt} IS NULL AND ${table.cleanupOperationKind} IS NULL AND ${table.statusOperationId} IS NULL)`,
    ),
    check(
      "session_runtime_provisioning_sandbox_pair_check",
      sql`(${table.runtimeProvisioningSandboxSessionId} IS NULL AND ${table.runtimeProvisioningSandboxIncarnation} IS NULL) OR (${table.runtimeProvisioningOperationId} IS NOT NULL AND typeof(${table.runtimeProvisioningSandboxIncarnation}) = 'integer' AND ${table.runtimeProvisioningSandboxIncarnation} BETWEEN 0 AND 9007199254740991)`,
    ),
    check(
      "session_status_check",
      sql`${table.status} IN ('IDLE', 'RUNNING', 'RESCHEDULING', 'TERMINATED')`,
    ),
    check(
      "session_auto_title_event_seq_check",
      sql`${table.autoTitleEventSeq} IS NULL OR ${table.autoTitleEventSeq} >= 0`,
    ),
    check("session_status_seq_check", sql`${table.statusSeq} >= 0`),
    index("session_agent_updated_idx").on(table.agentId, table.updatedAt, table.id),
    index("session_project_creator_archived_updated_idx").on(
      table.projectId,
      table.creatorAccountId,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index("session_project_attributed_archived_updated_idx").on(
      table.projectId,
      table.participantAccountId,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index("session_project_creator_type_archived_updated_idx").on(
      table.projectId,
      table.creatorAccountId,
      table.type,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index("session_project_attributed_type_archived_updated_idx").on(
      table.projectId,
      table.participantAccountId,
      table.type,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index("session_status_operation_updated_idx").on(
      table.status,
      table.statusOperationId,
      table.updatedAt,
    ),
    index("session_cleanup_operation_updated_idx").on(
      table.cleanupOperationKind,
      table.status,
      table.updatedAt,
      table.id,
    ),
    index("session_runtime_provisioning_heartbeat_idx").on(
      table.runtimeProvisioningHeartbeatAt,
      table.id,
    ),
    uniqueIndex("session_runtime_provisioning_sandbox_idx")
      .on(table.runtimeProvisioningSandboxId)
      .where(sql`${table.runtimeProvisioningOperationId} IS NOT NULL`),
    index("session_status_updated_idx").on(table.status, table.updatedAt, table.id),
  ],
);

export const sessionMessagesTable = sqliteTable(
  "session_message",
  {
    contentText: text("content_text").notNull(),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<PlatformId>("created_by_account_id").notNull(),
    id: platformIdColumn<SessionMessageId>("id").primaryKey(),
    planJson: text("plan_json"),
    projectionFormat: text("projection_format")
      .$type<"event_stream_v3" | "materialized">()
      .notNull()
      .default("materialized"),
    role: text("role").$type<"assistant" | "user">().notNull(),
    segmentsJson: text("segments_json"),
    seq: integer("seq").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id"),
  },
  (table) => [
    check(
      "session_message_projection_format_check",
      sql`${table.projectionFormat} IN ('materialized', 'event_stream_v3')`,
    ),
    check(
      "session_message_event_stream_v3_check",
      sql`${table.projectionFormat} <> 'event_stream_v3' OR (${table.role} = 'assistant' AND ${table.sessionRunId} IS NOT NULL AND ${table.contentText} = '' AND ${table.planJson} IS NULL AND ${table.segmentsJson} IS NULL)`,
    ),
    uniqueIndex("session_message_session_seq_idx").on(table.sessionId, table.seq),
    index("session_message_run_idx").on(table.sessionRunId),
  ],
);

export type SessionMessageRow = typeof sessionMessagesTable.$inferSelect;
export type SessionRow = typeof sessionsTable.$inferSelect;
