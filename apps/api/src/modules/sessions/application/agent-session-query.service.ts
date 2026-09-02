import type { SessionSummaryConnection, SessionType } from "@mosoo/contracts/session";
import { sessionsTable } from "@mosoo/db";
import type { AgentId, ProjectId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { eq, isNotNull, isNull } from "drizzle-orm";

import { ensureProjectAgentOwner } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { sessionParticipantCondition } from "../domain/session-access.policy";
import type { SessionSummaryListOptions } from "./session-summary-query.service";
import { listSessionSummaryConnection } from "./session-summary-query.service";

export async function listAgentSessions(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SessionSummaryListOptions & {
    agentId: AgentId;
    archived?: boolean | null;
    participantOnly?: boolean | null;
    projectId: ProjectId;
    type?: SessionType | null;
  },
): Promise<SessionSummaryConnection> {
  await ensureProjectAgentOwner(database, viewer.id, {
    agentId: input.agentId,
    projectId: input.projectId,
  });

  const filters: SQL[] = [
    eq(sessionsTable.agentId, input.agentId),
    eq(sessionsTable.projectId, input.projectId),
  ];

  if (input.archived !== undefined && input.archived !== null) {
    filters.push(
      input.archived ? isNotNull(sessionsTable.archivedAt) : isNull(sessionsTable.archivedAt),
    );
  }

  if (input.type !== undefined && input.type !== null) {
    filters.push(eq(sessionsTable.type, input.type));
  }

  if (input.participantOnly === true) {
    filters.push(sessionParticipantCondition(viewer.id));
  }

  return listSessionSummaryConnection({
    beforeCursor: input.beforeCursor ?? null,
    database,
    filters,
    limit: input.limit ?? null,
  });
}
