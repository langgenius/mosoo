import type { SessionRunStatus, SessionRunTrigger } from "@mosoo/contracts/session-run";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  DriverInstanceId,
  RuntimeOperationId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import type { SQLiteColumnBuilderBase } from "drizzle-orm/sqlite-core";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "../id-column";
import { sessionsTable } from "./core.schema";

/**
 * Defines the active Session Run shape once while allowing the migration-only
 * entrypoint to append immutable physical-history columns.
 */
export function defineSessionRunsTable<
  TExtraColumns extends Record<string, SQLiteColumnBuilderBase>,
>(extraColumns: TExtraColumns) {
  return sqliteTable(
    "session_run",
    {
      agentId: platformIdColumn<AgentId>("agent_id").notNull(),
      ...extraColumns,
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
}
