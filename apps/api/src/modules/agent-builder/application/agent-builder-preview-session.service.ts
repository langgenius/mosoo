import type { AgentBuilderPreviewStageSnapshot } from "@mosoo/contracts/agent-builder";
import { agentBuilderThreadsTable, sessionsTable } from "@mosoo/db";
import type { AccountId, AgentBuilderThreadId, AgentId, AppId, SessionId } from "@mosoo/id";
import { and, desc, eq, isNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { sessionParticipantCondition } from "../../sessions/domain/session-access.policy";

export interface AgentBuilderPreviewSessionSelectionAgent {
  readonly appId: AppId;
  readonly id: AgentId;
}

export interface AgentBuilderPreviewSessionSelection {
  readonly id: SessionId;
  readonly lastMessageAt: number | null;
  readonly messageSeqCursor: number;
}

export async function readAgentBuilderPreviewOpenedAt(
  database: D1Database,
  threadId: AgentBuilderThreadId,
): Promise<number | null> {
  const row =
    (await getAppDatabase(database)
      .select({ previewOpenedAt: agentBuilderThreadsTable.previewOpenedAt })
      .from(agentBuilderThreadsTable)
      .where(eq(agentBuilderThreadsTable.id, threadId))
      .limit(1)
      .get()) ?? null;

  return row?.previewOpenedAt ?? null;
}

export async function listAgentBuilderPreviewSessions(
  database: D1Database,
  input: {
    readonly agent: AgentBuilderPreviewSessionSelectionAgent;
    readonly viewerId: AccountId;
  },
): Promise<AgentBuilderPreviewSessionSelection[]> {
  return getAppDatabase(database)
    .select({
      id: sessionsTable.id,
      lastMessageAt: sessionsTable.lastMessageAt,
      messageSeqCursor: sessionsTable.messageSeqCursor,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.agentId, input.agent.id),
        eq(sessionsTable.appId, input.agent.appId),
        eq(sessionsTable.type, "preview"),
        isNull(sessionsTable.archivedAt),
        sessionParticipantCondition(input.viewerId),
      ),
    )
    .orderBy(desc(sessionsTable.updatedAt), desc(sessionsTable.id))
    .all();
}

export async function readLatestAgentBuilderPreviewSession(
  database: D1Database,
  input: {
    readonly agent: AgentBuilderPreviewSessionSelectionAgent;
    readonly viewerId: AccountId;
  },
): Promise<AgentBuilderPreviewSessionSelection | null> {
  const sessions = await listAgentBuilderPreviewSessions(database, input);

  return sessions[0] ?? null;
}

export function toAgentBuilderPreviewStageSnapshot(input: {
  readonly previewOpenedAt: number | null;
  readonly session: AgentBuilderPreviewSessionSelection | null;
}): AgentBuilderPreviewStageSnapshot {
  if (input.session === null) {
    return {
      messageCount: 0,
      opened: input.previewOpenedAt !== null,
      sessionExists: false,
    };
  }

  return {
    messageCount: Math.max(
      input.session.lastMessageAt === null ? 0 : 1,
      input.session.messageSeqCursor,
    ),
    opened: true,
    sessionExists: true,
  };
}
