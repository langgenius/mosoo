import { agentBuilderMessagesTable, agentBuilderThreadsTable } from "@mosoo/db";
import type { AgentBuilderMessageRow, AgentBuilderThreadRow } from "@mosoo/db";
import type {
  AccountId,
  AgentBuilderMessageId,
  AgentBuilderPlannerRunId,
  AgentBuilderThreadId,
  AgentId,
  OrganizationId,
} from "@mosoo/id";
import { and, desc, eq, lt, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../time";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createAgentBuilderThreadId } from "./agent-builder-ids";
import type { AgentBuilderPlannerContextSourceAgent } from "./agent-builder-planner-context.service";

export interface AgentBuilderThreadModel {
  agentId: AgentId;
  createdAt: string;
  creatorAccountId: AccountId;
  id: AgentBuilderThreadId;
  lastTurnAt: string | null;
  organizationId: OrganizationId;
  previewOpenedAt: string | null;
  status: string;
  title: string | null;
  updatedAt: string;
}

export interface AgentBuilderMessageModel {
  cardsJson: string | null;
  contentText: string;
  createdAt: string;
  createdByAccountId: AccountId | null;
  id: AgentBuilderMessageId;
  inputKind: string | null;
  plannerRunId: AgentBuilderPlannerRunId | null;
  role: string;
  seq: number;
  threadId: AgentBuilderThreadId;
}

export interface AgentBuilderThreadContext {
  agent: AgentBuilderPlannerContextSourceAgent;
  thread: AgentBuilderThreadRow;
}

export function isAgentBuilderMessageSequenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("agent_builder_message_thread_seq_idx") ||
    error.message.includes("agent_builder_message.thread_id, agent_builder_message.seq")
  );
}

function toAgentBuilderThreadModel(row: AgentBuilderThreadRow): AgentBuilderThreadModel {
  return {
    agentId: row.agentId,
    createdAt: toIsoString(row.createdAt),
    creatorAccountId: row.creatorAccountId,
    id: row.id,
    lastTurnAt: row.lastTurnAt === null ? null : toIsoString(row.lastTurnAt),
    organizationId: row.organizationId,
    previewOpenedAt: row.previewOpenedAt === null ? null : toIsoString(row.previewOpenedAt),
    status: row.status,
    title: row.title,
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toAgentBuilderMessageModel(row: AgentBuilderMessageRow): AgentBuilderMessageModel {
  return {
    cardsJson: row.cardsJson,
    contentText: row.contentText,
    createdAt: toIsoString(row.createdAt),
    createdByAccountId: row.createdByAccountId,
    id: row.id,
    inputKind: row.inputKind,
    plannerRunId: row.plannerRunId,
    role: row.role,
    seq: row.seq,
    threadId: row.threadId,
  };
}

export async function getAgentBuilderThreadRowByAgentId(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentBuilderThreadRow | null> {
  return (
    (await getAppDatabase(database)
      .select()
      .from(agentBuilderThreadsTable)
      .where(eq(agentBuilderThreadsTable.agentId, agentId))
      .limit(1)
      .get()) ?? null
  );
}

export async function allocateAgentBuilderMessageSeq(
  database: D1Database,
  input: {
    count: number;
    threadId: AgentBuilderThreadId;
  },
): Promise<number> {
  if (input.count < 1) {
    throw new Error("Agent Builder message sequence allocation count must be positive.");
  }

  const thread =
    (await getAppDatabase(database)
      .update(agentBuilderThreadsTable)
      .set({
        messageSeqCursor: sql`${agentBuilderThreadsTable.messageSeqCursor} + ${input.count}`,
      })
      .where(eq(agentBuilderThreadsTable.id, input.threadId))
      .returning({ seqCursor: agentBuilderThreadsTable.messageSeqCursor })
      .get()) ?? null;

  if (thread === null) {
    throw new Error("Agent Builder thread was not found while allocating message sequences.");
  }

  return thread.seqCursor - input.count + 1;
}

export async function ensureAgentBuilderThreadContext(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentBuilderThreadContext> {
  const { agent } = await ensureAgentEditor(database, viewer.id, agentId);
  const existing = await getAgentBuilderThreadRowByAgentId(database, agent.id);

  if (existing !== null) {
    return { agent, thread: existing };
  }

  const now = currentTimestampMs();
  const id = createAgentBuilderThreadId();

  await getAppDatabase(database)
    .insert(agentBuilderThreadsTable)
    .values({
      agentId: agent.id,
      createdAt: now,
      creatorAccountId: viewer.id,
      id,
      lastTurnAt: null,
      messageSeqCursor: 0,
      organizationId: agent.appOrganizationId,
      previewOpenedAt: null,
      status: "active",
      title: null,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: agentBuilderThreadsTable.agentId })
    .run();

  const row = await getAgentBuilderThreadRowByAgentId(database, agent.id);

  if (row === null) {
    throw new Error("Agent Builder thread was not persisted.");
  }

  return { agent, thread: row };
}

export async function markAgentBuilderPreviewOpened(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentBuilderThreadRow> {
  const { thread } = await ensureAgentBuilderThreadContext(database, viewer, agentId);
  const now = currentTimestampMs();

  await getAppDatabase(database)
    .update(agentBuilderThreadsTable)
    .set({
      previewOpenedAt: now,
      updatedAt: now,
    })
    .where(eq(agentBuilderThreadsTable.id, thread.id))
    .run();

  const row = await getAgentBuilderThreadRowByAgentId(database, agentId);

  if (row === null) {
    throw new Error("Agent Builder thread was not persisted after opening Preview.");
  }

  return row;
}

export async function ensureAgentBuilderThreadAddress(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    readonly agentId: AgentId;
    readonly threadId: AgentBuilderThreadId;
  },
): Promise<void> {
  const { agent } = await ensureAgentEditor(database, viewer.id, input.agentId);
  const thread = await getAgentBuilderThreadRowByAgentId(database, agent.id);

  if (thread === null || thread.id !== input.threadId) {
    throw new Error("Agent Builder System Agent body thread does not match the addressed thread.");
  }
}

export async function ensureAgentBuilderThread(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentBuilderThreadModel> {
  const { thread } = await ensureAgentBuilderThreadContext(database, viewer, agentId);
  return toAgentBuilderThreadModel(thread);
}

export async function listAgentBuilderMessages(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    beforeSeq?: number | null;
    limit?: number | null;
  },
): Promise<AgentBuilderMessageModel[]> {
  await ensureAgentEditor(database, viewer.id, input.agentId);
  const thread = await getAgentBuilderThreadRowByAgentId(database, input.agentId);

  if (thread === null) {
    return [];
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const filters = [eq(agentBuilderMessagesTable.threadId, thread.id)];

  if (input.beforeSeq !== null && input.beforeSeq !== undefined) {
    filters.push(lt(agentBuilderMessagesTable.seq, input.beforeSeq));
  }

  const rows = await getAppDatabase(database)
    .select()
    .from(agentBuilderMessagesTable)
    .where(and(...filters))
    .orderBy(desc(agentBuilderMessagesTable.seq))
    .limit(limit)
    .all();

  return rows.toReversed().map(toAgentBuilderMessageModel);
}
