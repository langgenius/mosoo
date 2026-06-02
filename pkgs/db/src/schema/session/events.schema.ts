import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
  SessionRuntimeEventFamily,
  SessionRuntimeEventSource,
  SessionRuntimeEventVisibility,
} from "@mosoo/contracts/session";
import type {
  AgentId,
  DriverInstanceId,
  RuntimeEventId,
  SessionId,
  SessionModelCallId,
  SessionRunId,
} from "@mosoo/id";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "../id-column";
import { sessionsTable } from "./core.schema";
import { sessionRunsTable } from "./runs.schema";

export const sessionModelCallsTable = sqliteTable(
  "session_model_call",
  {
    cacheCreationTokens: integer("cache_creation_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    callKey: text("call_key").notNull(),
    completedAt: integer("completed_at"),
    costCurrency: text("cost_currency"),
    createdAt: integer("created_at").notNull(),
    driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    id: platformIdColumn<SessionModelCallId>("id").primaryKey(),
    inputTokens: integer("input_tokens"),
    metadataJson: text("metadata_json"),
    model: text("model").notNull(),
    nativeCallId: text("native_call_id"),
    outputTokens: integer("output_tokens"),
    provider: text("provider").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id")
      .notNull()
      .references(() => sessionRunsTable.id, { onDelete: "cascade" }),
    startedAt: integer("started_at"),
    status: text("status").$type<"completed" | "failed" | "started">().notNull(),
    totalCostUsdMicros: integer("total_cost_usd_micros"),
    traceId: text("trace_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("session_model_call_run_created_idx").on(table.sessionRunId, table.createdAt),
    index("session_model_call_session_created_idx").on(table.sessionId, table.createdAt),
    uniqueIndex("session_model_call_run_key_idx").on(table.sessionRunId, table.callKey),
    uniqueIndex("session_model_call_native_idx").on(table.driverInstanceId, table.nativeCallId),
  ],
);

export const sessionEventsTable = sqliteTable(
  "session_event",
  {
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    contentText: text("content_text").notNull(),
    createdAt: integer("created_at").notNull(),
    endedAt: integer("ended_at").notNull(),
    eventType: text("event_type").notNull(),
    family: text("family").$type<SessionRuntimeEventFamily>().notNull(),
    id: platformIdColumn<RuntimeEventId>("id").primaryKey(),
    occurredAt: integer("occurred_at").notNull(),
    processStatus: text("process_status").$type<SessionProcessEventStatus>().notNull(),
    processType: text("process_type").$type<SessionProcessEventType>().notNull(),
    runId: platformIdColumn<SessionRunId>("run_id"),
    seq: integer("seq").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    sourceEventId: text("source_event_id").notNull(),
    source: text("source").$type<SessionRuntimeEventSource>().notNull(),
    tokens: integer("tokens"),
    traceId: text("trace_id"),
    visibility: text("visibility").$type<SessionRuntimeEventVisibility>().notNull(),
  },
  (table) => [
    index("session_event_agent_family_created_idx").on(
      table.agentId,
      table.family,
      table.createdAt,
      table.id,
    ),
    index("session_event_agent_visibility_created_idx").on(
      table.agentId,
      table.visibility,
      table.createdAt,
      table.id,
    ),
    index("session_event_agent_created_idx").on(table.agentId, table.createdAt, table.id),
    index("session_event_session_visibility_seq_idx").on(
      table.sessionId,
      table.visibility,
      table.seq,
    ),
    uniqueIndex("session_event_session_seq_idx").on(table.sessionId, table.seq),
    uniqueIndex("session_event_session_source_idx").on(table.sessionId, table.sourceEventId),
  ],
);

export type SessionEventRow = typeof sessionEventsTable.$inferSelect;
export type SessionModelCallRow = typeof sessionModelCallsTable.$inferSelect;
