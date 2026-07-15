import type { SessionRunStatus, SessionRunTrigger } from "@mosoo/contracts/session-run";
import type { SkillMaterializationStatus, SkillResolutionMode } from "@mosoo/contracts/skill";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  AppDeploymentId,
  AppDeploymentRunId,
  AppId,
  DriverInstanceId,
  RuntimeOperationId,
  SessionId,
  SessionRunId,
  SkillId,
  SkillSnapshotId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "../id-column";
import { sessionsTable } from "./core.schema";

export const sessionRunsTable = sqliteTable(
  "session_run",
  {
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    boundCapabilityAgentId: platformIdColumn<AgentId>("bound_capability_agent_id"),
    boundCapabilityAppId: platformIdColumn<AppId>("bound_capability_app_id"),
    boundCapabilityBindingEnv: text("bound_capability_binding_env"),
    boundCapabilityBindingName: text("bound_capability_binding_name"),
    boundCapabilityDeploymentId: platformIdColumn<AppDeploymentId>(
      "bound_capability_deployment_id",
    ),
    boundCapabilityDeploymentRunId: platformIdColumn<AppDeploymentRunId>(
      "bound_capability_deployment_run_id",
    ),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id").notNull(),
    deploymentVersionId: platformIdColumn<AgentDeploymentVersionId>("deployment_version_id"),
    deploymentVersionNumber: integer("deployment_version_number"),
    driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id"),
    errorCode: text("error_code"),
    errorDetailsJson: text("error_details_json"),
    errorMessage: text("error_message"),
    id: platformIdColumn<SessionRunId>("id").primaryKey(),
    model: text("model"),
    provider: text("provider"),
    runtimeId: text("runtime_id"),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    startedAt: integer("started_at"),
    status: text("status").$type<SessionRunStatus>().notNull(),
    statusChangedAt: integer("status_changed_at").notNull().default(0),
    statusEvent: text("status_event").notNull().default("run.queue"),
    statusOperationId: platformIdColumn<RuntimeOperationId>("status_operation_id"),
    statusSeq: integer("status_seq").notNull().default(0),
    statusSource: text("status_source").notNull().default("system"),
    traceId: text("trace_id").notNull(),
    trigger: text("trigger").$type<SessionRunTrigger>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "session_run_status_check",
      sql`${table.status} IN ('queued', 'booting', 'running', 'waiting_input', 'completed', 'failed', 'cancelled', 'expired')`,
    ),
    check("session_run_status_seq_check", sql`${table.statusSeq} >= 0`),
    index("session_run_driver_instance_idx").on(table.driverInstanceId, table.createdAt),
    uniqueIndex("session_run_active_driver_lease_idx")
      .on(table.driverInstanceId)
      .where(
        sql`${table.driverInstanceId} IS NOT NULL AND ${table.status} IN ('queued', 'booting', 'running', 'waiting_input')`,
      ),
    index("session_run_session_created_at_idx").on(table.sessionId, table.createdAt),
    index("session_run_session_status_idx").on(table.sessionId, table.status),
  ],
);

export const sessionRunSkillsTable = sqliteTable(
  "session_run_skill",
  {
    blobSha256: text("blob_sha256"),
    createdAt: integer("created_at").notNull(),
    materializationStatus: text("materialization_status")
      .$type<SkillMaterializationStatus>()
      .notNull(),
    mountPath: text("mount_path").notNull(),
    resolutionMode: text("resolution_mode").$type<SkillResolutionMode>().notNull(),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id")
      .notNull()
      .references(() => sessionRunsTable.id, { onDelete: "cascade" }),
    skillId: platformIdColumn<SkillId>("skill_id").notNull(),
    skillName: text("skill_name").notNull(),
    snapshotId: platformIdColumn<SkillSnapshotId>("snapshot_id"),
    updatedAt: integer("updated_at").notNull(),
    warningCode: text("warning_code"),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionRunId, table.skillId],
    }),
    index("session_run_skill_run_resolution_idx").on(table.sessionRunId, table.resolutionMode),
  ],
);

export type SessionRunRow = typeof sessionRunsTable.$inferSelect;
export type SessionRunSkillRow = typeof sessionRunSkillsTable.$inferSelect;
