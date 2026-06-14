import type { AgentSessionRetrieveConnection, SessionType } from "@mosoo/contracts/session";
import { sessionsTable } from "@mosoo/db";
import type { AppId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { eq, isNotNull, isNull } from "drizzle-orm";

import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { sessionParticipantCondition } from "../domain/session-access.policy";
import { toAgentSessionRetrieveResult } from "./agent-session-retrieve.service";
import type { SessionSummaryListOptions } from "./session-summary-query.service";
import { listSessionSummaryAccessConnection } from "./session-summary-query.service";

export async function listThreadAgentSessions(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SessionSummaryListOptions & {
    archived?: boolean | null;
    appId: AppId;
    type?: SessionType | null;
  },
): Promise<AgentSessionRetrieveConnection> {
  const archived = input.archived ?? false;
  await ensureAppOwnership(database, viewer.id, input.appId);

  const filters: SQL[] = [
    eq(sessionsTable.appId, input.appId),
    sessionParticipantCondition(viewer.id),
    archived ? isNotNull(sessionsTable.archivedAt) : isNull(sessionsTable.archivedAt),
  ];

  if (input.type !== undefined && input.type !== null) {
    filters.push(eq(sessionsTable.type, input.type));
  }

  const connection = await listSessionSummaryAccessConnection({
    beforeCursor: input.beforeCursor ?? null,
    database,
    filters,
    limit: input.limit ?? null,
    viewerId: viewer.id,
  });

  return {
    nodes: connection.nodes.map(toAgentSessionRetrieveResult),
    pageInfo: connection.pageInfo,
  };
}
