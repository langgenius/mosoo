import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
  SessionRuntimeEventFamily,
  SessionRuntimeEventSource,
  SessionRuntimeEventVisibility,
} from "@mosoo/contracts/session";
import type {
  AgentId,
  DriverCommandId,
  DriverInstanceId,
  RuntimeEventId,
  SessionId,
  SessionModelCallId,
  SessionRunId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    sourceEventSeq: integer("source_event_seq").notNull().default(0),
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
    check("session_model_call_source_event_seq_check", sql`${table.sourceEventSeq} >= 0`),
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
    artifactAttemptId: text("artifact_attempt_id"),
    artifactManifestJson: text("artifact_manifest_json"),
    artifactManifestSha256: text("artifact_manifest_sha256"),
    contentText: text("content_text").notNull(),
    createdAt: integer("created_at").notNull(),
    endedAt: integer("ended_at").notNull(),
    eventType: text("event_type").notNull(),
    family: text("family").$type<SessionRuntimeEventFamily>().notNull(),
    id: platformIdColumn<RuntimeEventId>("id").primaryKey(),
    mcpCommandId: platformIdColumn<DriverCommandId>("mcp_command_id"),
    occurredAt: integer("occurred_at").notNull(),
    processStatus: text("process_status").$type<SessionProcessEventStatus>().notNull(),
    processType: text("process_type").$type<SessionProcessEventType>().notNull(),
    runId: platformIdColumn<SessionRunId>("run_id"),
    runtimeOperationEventJson: text("runtime_operation_event_json"),
    semanticHash: text("semantic_hash"),
    seq: integer("seq").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    sourceEventId: text("source_event_id").notNull(),
    source: text("source").$type<SessionRuntimeEventSource>().notNull(),
    streamId: text("stream_id"),
    terminalEventJson: text("terminal_event_json"),
    toolCallId: text("tool_call_id"),
    toolInputDeltaJson: text("tool_input_delta_json"),
    toolInputJson: text("tool_input_json"),
    toolName: text("tool_name"),
    toolOutputDeltaText: text("tool_output_delta_text"),
    toolOutputText: text("tool_output_text"),
    toolParentMessageId: text("tool_parent_message_id"),
    toolResultMessageId: text("tool_result_message_id"),
    toolStatus: text("tool_status").$type<"cancelled" | "completed" | "failed" | "running">(),
    tokens: integer("tokens"),
    traceId: text("trace_id"),
    visibility: text("visibility").$type<SessionRuntimeEventVisibility>().notNull(),
  },
  (table) => [
    check(
      "session_event_artifact_manifest_check",
      sql`(${table.artifactAttemptId} IS NULL AND ${table.artifactManifestJson} IS NULL AND ${table.artifactManifestSha256} IS NULL) OR (${table.artifactAttemptId} IS NOT NULL AND ${table.artifactManifestJson} IS NOT NULL AND json_valid(${table.artifactManifestJson}) = 1 AND json_extract(${table.artifactManifestJson}, '$.version') IS 1 AND json_type(${table.artifactManifestJson}, '$.captureStatus') IS 'text' AND json_extract(${table.artifactManifestJson}, '$.captureStatus') IN ('complete', 'omitted_file_limit', 'omitted_runtime_unavailable', 'omitted_size_limit', 'omitted_source_changed', 'omitted_source_missing') AND json_type(${table.artifactManifestJson}, '$.mode') IS 'text' AND json_extract(${table.artifactManifestJson}, '$.mode') IN ('delta', 'snapshot') AND (json_extract(${table.artifactManifestJson}, '$.captureStatus') = 'complete' OR json_array_length(${table.artifactManifestJson}, '$.files') = 0) AND json_extract(${table.artifactManifestJson}, '$.sourceEventId') IS ${table.sourceEventId} AND json_extract(${table.artifactManifestJson}, '$.semanticHash') IS ${table.semanticHash} AND json_type(${table.artifactManifestJson}, '$.files') IS 'array' AND ${table.artifactManifestSha256} IS NOT NULL AND length(${table.artifactManifestSha256}) = 64 AND ${table.artifactManifestSha256} = lower(${table.artifactManifestSha256}) AND ${table.artifactManifestSha256} NOT GLOB '*[^0-9a-f]*' AND ${table.semanticHash} IS NOT NULL AND ${table.eventType} IN ('file.change.updated', 'file.changed', 'run.completed'))`,
    ),
    check(
      "session_event_mcp_command_check",
      sql`${table.mcpCommandId} IS NULL OR (${table.eventType} = 'tool.call.updated' AND ${table.toolStatus} IS NOT NULL AND ${table.toolStatus} IN ('completed', 'failed', 'cancelled'))`,
    ),
    check(
      "session_event_runtime_operation_event_json_check",
      sql`${table.runtimeOperationEventJson} IS NULL OR (json_valid(${table.runtimeOperationEventJson}) = 1 AND json_extract(${table.runtimeOperationEventJson}, '$.kind') IS 'agent.task.updated' AND json_type(${table.runtimeOperationEventJson}, '$.payload') IS 'object' AND json_extract(${table.runtimeOperationEventJson}, '$.payload.status') IN ('updating', 'ready') AND ${table.semanticHash} IS NOT NULL AND ${table.eventType} = 'agent.task.updated')`,
    ),
    check(
      "session_event_semantic_hash_check",
      sql`${table.semanticHash} IS NULL OR (length(${table.semanticHash}) = 64 AND ${table.semanticHash} = lower(${table.semanticHash}) AND ${table.semanticHash} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "session_event_terminal_event_json_check",
      sql`(${table.terminalEventJson} IS NULL AND NOT (${table.semanticHash} IS NOT NULL AND ${table.eventType} IN ('run.cancelled', 'run.completed', 'run.failed'))) OR (${table.terminalEventJson} IS NOT NULL AND json_valid(${table.terminalEventJson}) = 1 AND ${table.semanticHash} IS NOT NULL AND ${table.eventType} IN ('run.cancelled', 'run.completed', 'run.failed'))`,
    ),
    check(
      "session_event_tool_input_kind_check",
      sql`${table.toolInputDeltaJson} IS NULL OR ${table.toolInputJson} IS NULL`,
    ),
    check(
      "session_event_tool_output_kind_check",
      sql`${table.toolOutputDeltaText} IS NULL OR ${table.toolOutputText} IS NULL`,
    ),
    check(
      "session_event_tool_status_check",
      sql`${table.toolStatus} IS NULL OR ${table.toolStatus} IN ('running', 'completed', 'failed', 'cancelled')`,
    ),
    index("session_event_agent_family_created_idx").on(
      table.agentId,
      table.family,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("session_event_artifact_attempt_idx")
      .on(table.artifactAttemptId)
      .where(sql`${table.artifactAttemptId} IS NOT NULL`),
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
    index("session_event_run_event_type_idx").on(table.runId, table.eventType),
    index("session_event_run_stream_process_seq_idx").on(
      table.runId,
      table.streamId,
      table.processType,
      table.seq,
    ),
    index("session_event_run_tool_call_seq_idx").on(table.runId, table.toolCallId, table.seq),
    uniqueIndex("session_event_session_seq_idx").on(table.sessionId, table.seq),
    uniqueIndex("session_event_session_source_idx").on(table.sessionId, table.sourceEventId),
    uniqueIndex("session_event_run_terminal_winner_idx")
      .on(table.sessionId, table.runId)
      .where(
        sql`${table.semanticHash} IS NOT NULL AND ${table.runId} IS NOT NULL AND ${table.eventType} IN ('run.cancelled', 'run.completed', 'run.failed')`,
      ),
    uniqueIndex("session_event_mcp_terminal_winner_idx")
      .on(table.sessionId, table.mcpCommandId)
      .where(sql`${table.mcpCommandId} IS NOT NULL`),
  ],
);

export const sessionAgentTaskSnapshotsTable = sqliteTable("session_agent_task_snapshot", {
  driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id").notNull(),
  runId: platformIdColumn<SessionRunId>("run_id")
    .notNull()
    .references(() => sessionRunsTable.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  sessionId: platformIdColumn<SessionId>("session_id")
    .primaryKey()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  tasksJson: text("tasks_json").notNull(),
});

export type SessionEventRow = typeof sessionEventsTable.$inferSelect;
export type SessionAgentTaskSnapshotRow = typeof sessionAgentTaskSnapshotsTable.$inferSelect;
export type SessionModelCallRow = typeof sessionModelCallsTable.$inferSelect;
