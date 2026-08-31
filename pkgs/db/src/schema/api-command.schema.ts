import type { SemanticPlatformId } from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export type ApiCommandId = SemanticPlatformId<"ApiCommandId">;

export type ApiCommandKind =
  | "cost_ledger_reconciliation"
  | "environment_package_artifact_build"
  | "sandbox_backup_reconciliation"
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
    deliveryGeneration: integer("delivery_generation").notNull().default(1),
    id: platformIdColumn<ApiCommandId>("id").primaryKey(),
    kind: text("kind").$type<ApiCommandKind>().notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    payloadJson: text("payload_json").notNull(),
    status: text("status").$type<ApiCommandStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "api_command_delivery_generation_check",
      sql`typeof(${table.deliveryGeneration}) = 'integer' AND ${table.deliveryGeneration} BETWEEN 1 AND 9007199254740991`,
    ),
    uniqueIndex("api_command_dedupe_idx").on(table.dedupeKey),
    index("api_command_status_updated_idx").on(table.status, table.updatedAt),
    index("api_command_claim_idx").on(table.status, table.claimExpiresAt),
  ],
);

export type ApiCommandRow = typeof apiCommandsTable.$inferSelect;
