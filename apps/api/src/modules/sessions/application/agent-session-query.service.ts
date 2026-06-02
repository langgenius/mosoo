import type { SessionSummaryConnection, SessionType } from "@mosoo/contracts/session";
import { sessionsTable } from "@mosoo/db";
import type { AgentId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { eq, isNotNull, isNull } from "drizzle-orm";

import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { SessionSummaryListOptions } from "./session-summary-query.service";
import { listSessionSummaryConnection } from "./session-summary-query.service";

export async function listAgentSessions(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SessionSummaryListOptions & {
    agentId: AgentId;
    archived?: boolean | null;
    type?: SessionType | null;
  },
): Promise<SessionSummaryConnection> {
  await ensureAgentEditor(database, viewer.id, input.agentId);

  const filters: SQL[] = [eq(sessionsTable.agentId, input.agentId)];

  if (input.archived !== undefined && input.archived !== null) {
    filters.push(
      input.archived ? isNotNull(sessionsTable.archivedAt) : isNull(sessionsTable.archivedAt),
    );
  }

  if (input.type !== undefined && input.type !== null) {
    filters.push(eq(sessionsTable.type, input.type));
  }

  return listSessionSummaryConnection({
    beforeCursor: input.beforeCursor ?? null,
    database,
    filters,
    limit: input.limit ?? null,
  });
}
