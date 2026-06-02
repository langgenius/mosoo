import type { AccountId, DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "../id-column";
import { sessionsTable } from "./core.schema";

export const sessionThreadUiStatesTable = sqliteTable(
  "session_thread_ui_state",
  {
    accountId: platformIdColumn<AccountId>("account_id").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    readAt: integer("read_at"),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.sessionId],
    }),
    index("session_thread_ui_state_account_updated_idx").on(
      table.accountId,
      table.updatedAt,
      table.sessionId,
    ),
    index("session_thread_ui_state_session_idx").on(table.sessionId),
  ],
);

export const sessionPermissionRequestsTable = sqliteTable(
  "session_permission_request",
  {
    createdAt: integer("created_at").notNull(),
    driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id").notNull(),
    rawInput: text("raw_input"),
    requestId: text("request_id").notNull(),
    runId: platformIdColumn<SessionRunId>("run_id").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    toolCallId: text("tool_call_id"),
    toolKind: text("tool_kind"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionId, table.requestId],
    }),
    index("session_permission_request_run_idx").on(table.sessionId, table.runId),
  ],
);

export const sessionReadinessSnapshotsTable = sqliteTable("session_readiness_snapshot", {
  readinessJson: text("readiness_json").notNull(),
  sessionId: platformIdColumn<SessionId>("session_id")
    .primaryKey()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  updatedAt: integer("updated_at").notNull(),
});

export type SessionPermissionRequestRow = typeof sessionPermissionRequestsTable.$inferSelect;
export type SessionReadinessSnapshotRow = typeof sessionReadinessSnapshotsTable.$inferSelect;
export type SessionThreadUiStateRow = typeof sessionThreadUiStatesTable.$inferSelect;
