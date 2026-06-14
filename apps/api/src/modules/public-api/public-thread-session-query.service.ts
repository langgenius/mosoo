import { PUBLIC_THREAD_API_THREADS_MAX_LIMIT } from "@mosoo/contracts/public-api";
import type { PublicThreadApiListThreadsResponse } from "@mosoo/contracts/public-api";
import { sessionRunsTable, sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, AppId, PublicThreadId, SessionId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

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
import { parsePublicApiThreadMetadata } from "./public-thread-metadata";
import type { PublicApiThreadMetadata } from "./public-thread-metadata";
import { toPublicThreadSummary } from "./public-thread-presenter";

interface PublicThreadSessionRow {
  agent_id: AgentId;
  attributed_user_id: AccountId | null;
  creator_account_id: AccountId;
  id: SessionId;
  app_id: AppId;
  title: string | null;
}

interface PublicThreadSessionAccess {
  metadata: PublicApiThreadMetadata;
  row: PublicThreadSessionRow;
}

interface PublicThreadSessionAdmission {
  agent: AgentRow;
  metadata: PublicApiThreadMetadata;
  session: PublicThreadSessionRow;
}

async function getPublicThreadSessionAccess(
  database: D1Database,
  callerId: AccountId,
  threadId: PublicThreadId,
): Promise<PublicThreadSessionAccess> {
  const sessionId = toBackingSessionId(threadId);
  const row =
    (await getAppDatabase(database)
      .select({
        agent_id: sessionsTable.agentId,
        attributed_user_id: sessionsTable.attributedUserId,
        creator_account_id: sessionsTable.creatorAccountId,
        id: sessionsTable.id,
        metadata_json: sessionsTable.metadataJson,
        app_id: sessionsTable.appId,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, sessionId),
          or(
            eq(sessionsTable.creatorAccountId, callerId),
            eq(sessionsTable.attributedUserId, callerId),
          ),
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.source') = 'public_api'`,
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw publicNotFound("Thread not found.");
  }

  const metadata = parsePublicApiThreadMetadata(row.metadata_json);

  if (!metadata) {
    throw publicNotFound("Thread not found.");
  }

  const canRead =
    row.attributed_user_id === callerId ||
    (metadata.created_by.kind === "access_token" && row.creator_account_id === callerId);

  if (!canRead) {
    throw publicNotFound("Thread not found.");
  }

  return {
    metadata,
    row: {
      agent_id: row.agent_id,
      attributed_user_id: row.attributed_user_id,
      creator_account_id: parsePlatformId<AccountId>(row.creator_account_id, "Creator account ID"),
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
  const access = await getPublicThreadSessionAccess(database, caller.id, threadId);
  const agent = await admitAgentApiEndpointCaller(database, caller, access.row.agent_id);

  if (agent.appId !== access.row.app_id) {
    throw publicNotFound("Thread not found.");
  }

  return {
    agent,
    metadata: access.metadata,
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

  const participantFilter = or(
    and(
      eq(sessionsTable.creatorAccountId, caller.id),
      sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.created_by.kind') IN ('access_token', 'human_pat')`,
    ),
    eq(sessionsTable.attributedUserId, caller.id),
  );
  const filters: SQL[] = [
    eq(sessionsTable.agentId, input.agentId),
    sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.source') = 'public_api'`,
  ];
  if (participantFilter) {
    filters.push(participantFilter);
  }

  if (input.archived !== null) {
    filters.push(
      input.archived ? isNotNull(sessionsTable.archivedAt) : isNull(sessionsTable.archivedAt),
    );
  }

  const rows = await getAppDatabase(database)
    .select({
      ...sessionSummaryWithLastRunColumns(),
      attributed_user_id: sessionsTable.attributedUserId,
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
      const metadata = parsePublicApiThreadMetadata(row.metadata_json);
      if (!metadata) {
        return [];
      }

      return [
        toPublicThreadSummary({
          attributedUserId: row.attributed_user_id,
          metadata,
          session: toPublicThreadSessionSummary(buildSessionSummaryFromJoinedRow(row)),
        }),
      ];
    }),
  };
}
