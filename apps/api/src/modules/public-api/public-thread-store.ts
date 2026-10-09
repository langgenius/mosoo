import type { PublicApiVersion } from "@mosoo/contracts/public-api";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionEventsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { AgentId, PersonalAccessTokenId, ProjectId, SessionId } from "@mosoo/id";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { getSessionRunSummary } from "../runtime/infrastructure/session-runs/session-run-read.repository";
import {
  buildSessionSummaryFromJoinedRow,
  sessionSummaryWithLastRunColumns,
} from "../sessions/application/session-summary-query.service";
import type { PublicThreadAdmission } from "./public-thread-session-query.service";

export interface PublicThreadCreationSnapshot extends PublicThreadAdmission {
  /** Absent on Sessions created before creation receipts existed. */
  initialRequestId: string | null | undefined;
}

export async function getPublicThreadInitialRun(
  database: D1Database,
  sessionId: SessionId,
  requestId: string,
): Promise<SessionRunSummary | null> {
  const receipt = await getAppDatabase(database)
    .select({ runId: sessionEventsTable.runId })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, sessionId),
        eq(sessionEventsTable.sourceEventId, requestId),
      ),
    )
    .limit(1)
    .get();
  return receipt?.runId ? getSessionRunSummary(database, receipt.runId) : null;
}

export async function findPublicThreadSnapshotByIdempotencyKey(
  database: D1Database,
  input: {
    agentId: AgentId | null;
    apiVersion: PublicApiVersion;
    idempotencyKey: string;
    createdAfterMs?: number | undefined;
    tokenId: PersonalAccessTokenId;
    projectId?: ProjectId;
  },
): Promise<PublicThreadCreationSnapshot | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...sessionSummaryWithLastRunColumns(),
        kind: sessionsTable.kind,
        end_user_id: sessionsTable.endUserId,
        metadata_json: sessionsTable.metadataJson,
      })
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(
        and(
          input.agentId === null
            ? isNull(sessionsTable.agentId)
            : eq(sessionsTable.agentId, input.agentId),
          input.createdAfterMs === undefined
            ? undefined
            : gte(sessionsTable.createdAt, input.createdAfterMs),
          sql`coalesce(json_extract(${sessionsTable.metadataJson}, '$.public_api.api_version'), 'v1') = ${input.apiVersion}`,
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.source') = 'public_api'`,
          input.projectId === undefined
            ? sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.created_by.token_id') = ${input.tokenId}`
            : eq(sessionsTable.projectId, input.projectId),
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.idempotency_key') = ${input.idempotencyKey}`,
          input.apiVersion === "v1" ? isNotNull(sessionsTable.endUserId) : undefined,
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  const metadata = JSON.parse(row.metadata_json) as {
    public_api_initial_request_id?: string | null;
  };

  return {
    endUserId: row.end_user_id,
    initialRequestId: metadata.public_api_initial_request_id,
    kind: row.kind,
    session: buildSessionSummaryFromJoinedRow(row),
  };
}
