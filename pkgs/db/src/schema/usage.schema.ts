import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  OrganizationId,
  PlatformId,
  AppId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const usageEventsTable = sqliteTable(
  "usage_event",
  {
    actorUserId: platformIdColumn<AccountId>("actor_user_id").notNull(),
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    agentOwnerUserId: platformIdColumn<AccountId>("agent_owner_user_id").notNull(),
    agentPublicationStateAtRun: text("agent_publication_state_at_run")
      .$type<"archived" | "draft_of_published" | "published" | "unpublished">()
      .notNull(),
    agentRevisionId: platformIdColumn<AgentDeploymentVersionId>("agent_revision_id"),
    cacheCreationTokens: integer("cache_creation_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<PlatformId>("id").primaryKey(),
    inputTokens: integer("input_tokens").notNull(),
    model: text("model").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    appId: platformIdColumn<AppId>("app_id").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    priceSnapshotJson: text("price_snapshot_json"),
    pricingStatus: text("pricing_status").$type<"priced" | "unknown">().notNull(),
    provider: text("provider").notNull(),
    runPurpose: text("run_purpose")
      .$type<"channel" | "debug" | "eval" | "preview" | "production" | "scheduled">()
      .notNull(),
    runtimeId: text("runtime_id"),
    sessionId: platformIdColumn<SessionId>("session_id"),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id"),
    source: text("source").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    totalCostUsdMicros: integer("total_cost_usd_micros").notNull(),
    usageContract: text("usage_contract")
      .$type<
        | "anthropic_bucketed"
        | "openai_runtime_total_with_cached_breakdown"
        | "openai_total_with_cached_breakdown"
      >()
      .notNull(),
  },
  (table) => [
    index("usage_event_app_created_idx").on(table.appId, table.createdAt),
    index("usage_event_organization_created_idx").on(table.organizationId, table.createdAt),
    index("usage_event_agent_created_idx").on(table.agentId, table.createdAt),
    index("usage_event_actor_created_idx").on(table.actorUserId, table.createdAt),
    index("usage_event_owner_created_idx").on(table.agentOwnerUserId, table.createdAt),
    index("usage_event_session_run_idx").on(table.sessionRunId),
    uniqueIndex("usage_event_source_event_idx").on(table.source, table.sourceEventId),
  ],
);

export const usageDailyRollupsTable = sqliteTable(
  "usage_daily_rollup",
  {
    actorUserId: platformIdColumn<AccountId>("actor_user_id").notNull(),
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    agentOwnerUserId: platformIdColumn<AccountId>("agent_owner_user_id").notNull(),
    agentPublicationStateAtRun: text("agent_publication_state_at_run")
      .$type<"archived" | "draft_of_published" | "published" | "unpublished">()
      .notNull(),
    cacheCreationTokens: integer("cache_creation_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    date: text("date").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    model: text("model").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    appId: platformIdColumn<AppId>("app_id").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    provider: text("provider").notNull(),
    requestCount: integer("request_count").notNull(),
    runPurpose: text("run_purpose")
      .$type<"channel" | "debug" | "eval" | "preview" | "production" | "scheduled">()
      .notNull(),
    totalCostUsdMicros: integer("total_cost_usd_micros").notNull(),
    unpricedRequestCount: integer("unpriced_request_count").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.appId,
        table.agentId,
        table.actorUserId,
        table.agentOwnerUserId,
        table.date,
        table.agentPublicationStateAtRun,
        table.runPurpose,
        table.provider,
        table.model,
      ],
    }),
    index("usage_daily_rollup_app_date_idx").on(table.appId, table.date),
    index("usage_daily_rollup_organization_date_idx").on(table.organizationId, table.date),
    index("usage_daily_rollup_agent_date_idx").on(table.agentId, table.date),
    index("usage_daily_rollup_actor_date_idx").on(table.actorUserId, table.date),
    index("usage_daily_rollup_owner_date_idx").on(table.agentOwnerUserId, table.date),
  ],
);

export const usageEventRollupReceiptsTable = sqliteTable(
  "usage_event_rollup_receipt",
  {
    rolledUpAt: integer("rolled_up_at").notNull(),
    source: text("source").notNull(),
    sourceEventId: text("source_event_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.sourceEventId] }),
    index("usage_event_rollup_receipt_rolled_up_at_idx").on(table.rolledUpAt),
  ],
);

export type UsageDailyRollupRow = typeof usageDailyRollupsTable.$inferSelect;
export type UsageEventRollupReceiptRow = typeof usageEventRollupReceiptsTable.$inferSelect;
export type UsageEventRow = typeof usageEventsTable.$inferSelect;
