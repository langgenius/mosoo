import type { SessionId } from "@mosoo/id";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "../id-column";
import { sessionsTable } from "./core.schema";

export const sessionExecutionSnapshotsTable = sqliteTable("session_execution_snapshot", {
  createdAt: integer("created_at").notNull(),
  planJson: text("plan_json").notNull(),
  sessionId: platformIdColumn<SessionId>("session_id")
    .primaryKey()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
});

export type SessionExecutionSnapshotRow = typeof sessionExecutionSnapshotsTable.$inferSelect;
