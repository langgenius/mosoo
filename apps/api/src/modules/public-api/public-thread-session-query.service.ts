import type { AgentKind } from "@mosoo/contracts/agent";
import { PUBLIC_THREAD_API_THREADS_MAX_LIMIT } from "@mosoo/contracts/public-api";
import type {
  PublicApiVersion,
  PublicThreadApiListThreadsResponse,
} from "@mosoo/contracts/public-api";
import type { SessionSummary } from "@mosoo/contracts/session";
import { agentsTable, projectsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { AgentId, SessionId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import {
  buildSessionSummaryFromJoinedRow,
  sessionSummaryWithLastRunColumns,
} from "../sessions/application/session-summary-query.service";
import { admitAgentApiEndpointCaller } from "./agent-api-endpoint-admission.service";
import { publicAgentNotExposed, publicNotFound } from "./public-api-errors";
import { toPublicThreadSummary } from "./public-thread-presenter";

export interface PublicThreadAdmission {
  endUserId: string | null;
  kind: AgentKind;
  session: SessionSummary;
}

function publicThreadCallerScopeConditions(
  caller: AuthenticatedViewer,
  apiVersion: PublicApiVersion,
): SQL[] {
  return [
    eq(sessionsTable.creatorAccountId, caller.id),
    ...(caller.projectId === undefined ? [] : [eq(sessionsTable.projectId, caller.projectId)]),
    ...(apiVersion === "v1"
      ? [
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.source') = 'public_api'`,
          sql`coalesce(json_extract(${sessionsTable.metadataJson}, '$.public_api.api_version'), 'v1') = 'v1'`,
          isNotNull(sessionsTable.endUserId),
        ]
      : []),
  ];
}

/** Admits a caller to a Thread it created in a Project it owns. */
export async function admitPublicThread(
  database: D1Database,
  caller: AuthenticatedViewer,
  threadId: SessionId,
  apiVersion: PublicApiVersion,
): Promise<PublicThreadAdmission> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...sessionSummaryWithLastRunColumns(),
        agent_status: agentsTable.status,
        end_user_id: sessionsTable.endUserId,
        kind: sessionsTable.kind,
      })
      .from(sessionsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, sessionsTable.projectId))
      .leftJoin(
        agentsTable,
        and(
          eq(agentsTable.id, sessionsTable.agentId),
          eq(agentsTable.projectId, sessionsTable.projectId),
        ),
      )
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(
        and(
          eq(sessionsTable.id, threadId),
          eq(projectsTable.ownerAccountId, caller.id),
          ...publicThreadCallerScopeConditions(caller, apiVersion),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null || (apiVersion === "v1" && row.agent_status === null)) {
    throw publicNotFound("Thread not found.");
  }

  if (apiVersion === "v1" && row.agent_status !== "published") {
    throw publicAgentNotExposed("This Agent is not exposed as an active API endpoint.");
  }

  return {
    endUserId: row.end_user_id,
    kind: row.kind,
    session: buildSessionSummaryFromJoinedRow(row),
  };
}

export async function listAgentApiEndpointThreads(
  database: D1Database,
  caller: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    apiVersion: PublicApiVersion;
    archived: boolean | null;
  },
): Promise<PublicThreadApiListThreadsResponse<string | null, PublicApiVersion>> {
  await admitAgentApiEndpointCaller(database, caller, input.agentId, input.apiVersion);

  const filters: SQL[] = [
    eq(sessionsTable.agentId, input.agentId),
    ...publicThreadCallerScopeConditions(caller, input.apiVersion),
  ];

  if (input.archived !== null) {
    filters.push(
      input.archived ? isNotNull(sessionsTable.archivedAt) : isNull(sessionsTable.archivedAt),
    );
  }

  const rows = await getAppDatabase(database)
    .select({
      ...sessionSummaryWithLastRunColumns(),
      kind: sessionsTable.kind,
      end_user_id: sessionsTable.endUserId,
    })
    .from(sessionsTable)
    .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
    .where(and(...filters))
    .orderBy(desc(sessionsTable.updatedAt), desc(sessionsTable.id))
    .limit(PUBLIC_THREAD_API_THREADS_MAX_LIMIT)
    .all();

  return {
    threads: rows.map((row) =>
      toPublicThreadSummary({
        apiVersion: input.apiVersion,
        endUserId: row.end_user_id,
        legacyKind: row.kind,
        session: buildSessionSummaryFromJoinedRow(row),
      }),
    ),
  };
}
