import { PUBLIC_THREAD_API_THREADS_MAX_LIMIT } from "@mosoo/contracts/public-api";
import type { PublicThreadApiListThreadsResponse } from "@mosoo/contracts/public-api";
import { sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { AgentId, AppId, PublicThreadId, SessionId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import type { AgentRow } from "../agents/application/agent-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import {
  buildSessionSummaryFromJoinedRow,
  sessionSummaryWithLastRunColumns,
} from "../sessions/application/session-summary-query.service";
import { admitAgentApiEndpointCaller } from "./agent-api-endpoint-admission.service";
import { publicNotFound } from "./public-api-errors";
import { toPublicThreadSessionSummary } from "./public-thread-api-presenter";
import { toBackingSessionId } from "./public-thread-ids";
import { parsePublicApiThreadRecordMetadata } from "./public-thread-metadata";
import { toPublicThreadSummary } from "./public-thread-presenter";

interface PublicThreadSessionRow {
  agent_id: AgentId;
  end_user_id: string;
  id: SessionId;
  app_id: AppId;
  title: string | null;
}

interface PublicThreadSessionAccess {
  row: PublicThreadSessionRow;
}

interface PublicThreadSessionAdmission {
  agent: AgentRow;
  session: PublicThreadSessionRow;
}

function publicThreadCallerScopeConditions(caller: AuthenticatedViewer): SQL[] {
  return [
    eq(sessionsTable.creatorAccountId, caller.id),
    sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.source') = 'public_api'`,
  ];
}

async function getPublicThreadSessionAccess(
  database: D1Database,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
): Promise<PublicThreadSessionAccess> {
  const sessionId = toBackingSessionId(threadId);
  const row =
    (await getAppDatabase(database)
      .select({
        agent_id: sessionsTable.agentId,
        end_user_id: sessionsTable.endUserId,
        id: sessionsTable.id,
        metadata_json: sessionsTable.metadataJson,
        app_id: sessionsTable.appId,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), ...publicThreadCallerScopeConditions(caller)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw publicNotFound("Thread not found.");
  }

  const metadata = parsePublicApiThreadRecordMetadata(row.metadata_json);

  if (!metadata || row.end_user_id === null) {
    throw publicNotFound("Thread not found.");
  }

  return {
    row: {
      agent_id: row.agent_id,
      end_user_id: row.end_user_id,
      id: row.id,
      app_id: row.app_id,
      title: row.title,
    },
  };
}

export async function admitPublicSessionCaller(
  database: D1Database,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
): Promise<PublicThreadSessionAdmission> {
  const access = await getPublicThreadSessionAccess(database, caller, threadId);
  const agent = await admitAgentApiEndpointCaller(database, caller, access.row.agent_id);

  if (agent.appId !== access.row.app_id) {
    throw publicNotFound("Thread not found.");
  }

  return {
    agent,
    session: access.row,
  };
}

export async function listAgentApiEndpointThreads(
  database: D1Database,
  caller: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    archived: boolean | null;
  },
): Promise<PublicThreadApiListThreadsResponse> {
  await admitAgentApiEndpointCaller(database, caller, input.agentId);

  const filters: SQL[] = [
    eq(sessionsTable.agentId, input.agentId),
    ...publicThreadCallerScopeConditions(caller),
  ];

  if (input.archived !== null) {
    filters.push(
      input.archived ? isNotNull(sessionsTable.archivedAt) : isNull(sessionsTable.archivedAt),
    );
  }

  const rows = await getAppDatabase(database)
    .select({
      ...sessionSummaryWithLastRunColumns(),
      end_user_id: sessionsTable.endUserId,
      metadata_json: sessionsTable.metadataJson,
    })
    .from(sessionsTable)
    .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
    .where(and(...filters))
    .orderBy(desc(sessionsTable.updatedAt), desc(sessionsTable.id))
    .limit(PUBLIC_THREAD_API_THREADS_MAX_LIMIT)
    .all();

  return {
    threads: rows.flatMap((row) => {
      const metadata = parsePublicApiThreadRecordMetadata(row.metadata_json);
      if (!metadata || row.end_user_id === null) {
        return [];
      }

      return [
        toPublicThreadSummary({
          endUserId: row.end_user_id,
          session: toPublicThreadSessionSummary(buildSessionSummaryFromJoinedRow(row)),
        }),
      ];
    }),
  };
}
