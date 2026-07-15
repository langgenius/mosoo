import type { SemanticPlatformId } from "@mosoo/id";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export type ApiCommandId = SemanticPlatformId<"ApiCommandId">;

export type ApiCommandKind =
  | "app_deployment_run_dispatch"
  | "channel_work_trigger"
  | "cost_ledger_reconciliation"
  | "scheduled_maintenance"
  | "session_run_dispatch";
export type ApiCommandStatus = "dead_lettered" | "failed" | "queued" | "running" | "succeeded";

export const apiCommandsTable = sqliteTable(
  "api_command",
  {
    attemptCount: integer("attempt_count").notNull().default(0),
    claimExpiresAt: integer("claim_expires_at"),
    claimOwner: text("claim_owner"),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    id: platformIdColumn<ApiCommandId>("id").primaryKey(),
    kind: text("kind").$type<ApiCommandKind>().notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    payloadJson: text("payload_json").notNull(),
    status: text("status").$type<ApiCommandStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("api_command_dedupe_idx").on(table.dedupeKey),
    index("api_command_status_updated_idx").on(table.status, table.updatedAt),
    index("api_command_claim_idx").on(table.status, table.claimExpiresAt),
  ],
);

export type ApiCommandRow = typeof apiCommandsTable.$inferSelect;
