import { sessionsTable } from "@mosoo/db";
import type { AccountId, AgentId, SessionId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import { sessionParticipantFlag } from "../domain/session-access.policy";

export interface SessionReadAccess {
  agentId: AgentId;
  id: SessionId;
  updatedAt: number;
}

export async function getSessionReadAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionReadAccess> {
  const row =
    (await getAppDatabase(database)
      .select({
        agentId: sessionsTable.agentId,
        id: sessionsTable.id,
        isSessionParticipant: sessionParticipantFlag(viewerId),
        updatedAt: sessionsTable.updatedAt,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw new Error("Session not found.");
  }

  if (row.isSessionParticipant !== 1) {
    await ensureAgentEditor(database, viewerId, row.agentId);
  }

  return {
    agentId: row.agentId,
    id: row.id,
    updatedAt: row.updatedAt,
  };
}
