import type { AgentSessionRetrieveConnection, SessionType } from "@mosoo/contracts/session";
import { sessionsTable } from "@mosoo/db";
import type { ProjectId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { eq, isNotNull, isNull } from "drizzle-orm";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { toAgentSessionRetrieveResult } from "./agent-session-retrieve.service";
import type { SessionSummaryListOptions } from "./session-summary-query.service";
import { listSessionSummaryConnection } from "./session-summary-query.service";

export async function listThreadAgentSessions(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SessionSummaryListOptions & {
    archived?: boolean | null;
    projectId: ProjectId;
    type?: SessionType | null;
  },
): Promise<AgentSessionRetrieveConnection> {
  const archived = input.archived ?? false;
  await ensureProjectOwnership(database, viewer.id, input.projectId);

  const filters: SQL[] = [
    eq(sessionsTable.projectId, input.projectId),
    archived ? isNotNull(sessionsTable.archivedAt) : isNull(sessionsTable.archivedAt),
  ];

  if (input.type !== undefined && input.type !== null) {
    filters.push(eq(sessionsTable.type, input.type));
  }

  const connection = await listSessionSummaryConnection({
    beforeCursor: input.beforeCursor ?? null,
    database,
    filters,
    limit: input.limit ?? null,
  });

  return {
    nodes: connection.nodes.map(toAgentSessionRetrieveResult),
    pageInfo: connection.pageInfo,
  };
}
