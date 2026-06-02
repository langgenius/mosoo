import type { AgentKind } from "@mosoo/contracts/agent";
import type { SessionStatus, SessionType } from "@mosoo/contracts/session";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  OrganizationId,
  PlatformId,
  RuntimeOperationId,
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
    attributedUserId: platformIdColumn<AccountId>("attributed_user_id"),
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
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    provider: text("provider").notNull(),
    renamed: integer("renamed", { mode: "boolean" }).notNull(),
    runtimeId: text("runtime_id").notNull(),
    status: text("status").$type<SessionStatus>().notNull(),
    statusOperationId: platformIdColumn<RuntimeOperationId>("status_operation_id"),
    statusSeq: integer("status_seq").notNull().default(0),
    runtimeEventSeqCursor: integer("runtime_event_seq_cursor").notNull().default(0),
    title: text("title"),
    type: text("type").$type<SessionType>().notNull().default("preview"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "session_status_check",
      sql`${table.status} IN ('IDLE', 'RUNNING', 'RESCHEDULING', 'TERMINATED')`,
    ),
    check("session_status_seq_check", sql`${table.statusSeq} >= 0`),
    index("session_agent_updated_idx").on(table.agentId, table.updatedAt, table.id),
    index("session_status_operation_updated_idx").on(
      table.status,
      table.statusOperationId,
      table.updatedAt,
    ),
    index("session_status_updated_idx").on(table.status, table.updatedAt, table.id),
    index("session_organization_creator_status_updated_idx").on(
      table.organizationId,
      table.creatorAccountId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    index("session_organization_attributed_status_updated_idx").on(
      table.organizationId,
      table.attributedUserId,
      table.status,
      table.updatedAt,
      table.id,
    ),
    index("session_organization_creator_archived_updated_idx").on(
      table.organizationId,
      table.creatorAccountId,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index("session_organization_attributed_archived_updated_idx").on(
      table.organizationId,
      table.attributedUserId,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index("session_organization_creator_type_archived_updated_idx").on(
      table.organizationId,
      table.creatorAccountId,
      table.type,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index("session_organization_attributed_type_archived_updated_idx").on(
      table.organizationId,
      table.attributedUserId,
      table.type,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
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
    role: text("role").$type<"assistant" | "user">().notNull(),
    segmentsJson: text("segments_json"),
    seq: integer("seq").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id"),
  },
  (table) => [
    uniqueIndex("session_message_session_seq_idx").on(table.sessionId, table.seq),
    index("session_message_run_idx").on(table.sessionRunId),
  ],
);

export type SessionMessageRow = typeof sessionMessagesTable.$inferSelect;
export type SessionRow = typeof sessionsTable.$inferSelect;
