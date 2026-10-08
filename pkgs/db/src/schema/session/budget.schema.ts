// Historical table from applied migration 0016. No active runtime budget policy.
import type { SessionRunId } from "@mosoo/id";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "../id-column";
import { sessionRunsTable } from "./runs.schema";

export const sessionRunBudgetsTable = sqliteTable("session_run_budget", {
  sessionRunId: platformIdColumn<SessionRunId>("session_run_id")
    .primaryKey()
    .references(() => sessionRunsTable.id, { onDelete: "cascade" }),
  capUsdMicros: integer("cap_usd_micros").notNull(),
  estimatedCostUsdMicros: integer("estimated_cost_usd_micros").notNull().default(0),
  activeRequestId: text("active_request_id"),
  blockedReason: text("blocked_reason").$type<"budget_exhausted" | "budget_usage_unavailable">(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
