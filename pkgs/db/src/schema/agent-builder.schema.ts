import type {
  AccountId,
  AgentBuilderMessageId,
  AgentBuilderPlannerRunId,
  AgentBuilderThreadId,
  AgentId,
} from "@mosoo/id";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { agentsTable } from "./agent.schema";
import { platformIdColumn } from "./id-column";

export const AGENT_BUILDER_THREAD_STATUSES = ["active", "archived"] as const;
export type AgentBuilderThreadStatus = (typeof AGENT_BUILDER_THREAD_STATUSES)[number];
export type AgentBuilderPlannerRunStatus = "blocked" | "completed";
export type AgentBuilderMessageInputKind =
  | "confirmation"
  | "guidance_event"
  | "question_action"
  | "question_answer"
  | "user_message";
export const AGENT_BUILDER_MESSAGE_ROLES = ["assistant", "system", "tool", "user"] as const;
export type AgentBuilderMessageRole = (typeof AGENT_BUILDER_MESSAGE_ROLES)[number];

export const agentBuilderThreadsTable = sqliteTable(
  "agent_builder_thread",
  {
    agentId: platformIdColumn<AgentId>("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    creatorAccountId: platformIdColumn<AccountId>("creator_account_id").notNull(),
    id: platformIdColumn<AgentBuilderThreadId>("id").primaryKey(),
    lastTurnAt: integer("last_turn_at"),
    messageSeqCursor: integer("message_seq_cursor").notNull().default(0),
    previewOpenedAt: integer("preview_opened_at"),
    status: text("status").$type<AgentBuilderThreadStatus>().notNull().default("active"),
    title: text("title"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_builder_thread_agent_idx").on(table.agentId),
    index("agent_builder_thread_creator_updated_idx").on(table.creatorAccountId, table.updatedAt),
  ],
);

export const agentBuilderMessagesTable = sqliteTable(
  "agent_builder_message",
  {
    cardsJson: text("cards_json"),
    contentText: text("content_text").notNull(),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id"),
    id: platformIdColumn<AgentBuilderMessageId>("id").primaryKey(),
    inputKind: text("input_kind").$type<AgentBuilderMessageInputKind>(),
    plannerRunId: platformIdColumn<AgentBuilderPlannerRunId>("planner_run_id"),
    role: text("role").$type<AgentBuilderMessageRole>().notNull(),
    seq: integer("seq").notNull(),
    threadId: platformIdColumn<AgentBuilderThreadId>("thread_id")
      .notNull()
      .references(() => agentBuilderThreadsTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("agent_builder_message_thread_seq_idx").on(table.threadId, table.seq),
    index("agent_builder_message_planner_run_idx").on(table.plannerRunId),
  ],
);

export const agentBuilderPlannerRunsTable = sqliteTable(
  "agent_builder_planner_run",
  {
    agentId: platformIdColumn<AgentId>("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    completedAt: integer("completed_at"),
    contextJson: text("context_json").notNull(),
    createdAt: integer("created_at").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    id: platformIdColumn<AgentBuilderPlannerRunId>("id").primaryKey(),
    model: text("model").notNull(),
    outputJson: text("output_json"),
    provider: text("provider").notNull(),
    requestDigest: text("request_digest").notNull(),
    status: text("status").$type<AgentBuilderPlannerRunStatus>().notNull(),
    threadId: platformIdColumn<AgentBuilderThreadId>("thread_id")
      .notNull()
      .references(() => agentBuilderThreadsTable.id, { onDelete: "cascade" }),
    traceId: text("trace_id").notNull(),
    toolTraceJson: text("tool_trace_json"),
    triggerMessageId: platformIdColumn<AgentBuilderMessageId>("trigger_message_id"),
  },
  (table) => [
    index("agent_builder_planner_run_thread_created_idx").on(table.threadId, table.createdAt),
    index("agent_builder_planner_run_agent_created_idx").on(table.agentId, table.createdAt),
    index("agent_builder_planner_run_trace_idx").on(table.traceId),
  ],
);

export type AgentBuilderMessageRow = typeof agentBuilderMessagesTable.$inferSelect;
export type AgentBuilderPlannerRunRow = typeof agentBuilderPlannerRunsTable.$inferSelect;
export type AgentBuilderThreadRow = typeof agentBuilderThreadsTable.$inferSelect;
