import type { AgentKind } from "@mosoo/contracts/agent";
import type { PublicApiVersion } from "@mosoo/contracts/public-api";
import type { SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import {
  sessionEventsTable,
  sessionMessagesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  FileId,
  PersonalAccessTokenId,
  ProjectId,
  PublicThreadId,
  SessionId,
} from "@mosoo/id";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../time";
import { fileStore } from "../files/application/file-store";
import { getSessionRunSummary } from "../runtime/infrastructure/session-runs/session-run-read.repository";
import {
  buildSessionSummaryFromJoinedRow,
  sessionSummaryWithLastRunColumns,
} from "../sessions/application/session-summary-query.service";
import type { SessionSummaryWithLastRunRow } from "../sessions/application/session-summary-query.service";
import { deriveSessionTitleFromPrompt } from "../sessions/domain/session-title";
import { publicNotFound } from "./public-api-errors";
import { toBackingSessionId } from "./public-thread-ids";
import { parsePublicApiThreadRecordMetadata } from "./public-thread-metadata";
import type { PublicApiThreadRecordMetadata } from "./public-thread-metadata";

export interface ThreadSnapshotRow extends SessionSummaryWithLastRunRow {
  kind: AgentKind;
  creator_account_id: AccountId;
  end_user_id: string | null;
  metadata_json: string;
}

export interface ThreadSnapshot {
  endUserId: string | null;
  metadata: PublicApiThreadRecordMetadata | null;
  row: ThreadSnapshotRow;
  session: SessionSummary;
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

export async function cleanupFailedThreadCreation(input: {
  bindings: ApiBindings;
  fileIds: FileId[];
  sessionId: SessionId;
}): Promise<void> {
  if (input.fileIds.length > 0) {
    await fileStore.deleteScope(input.bindings, {
      id: input.sessionId,
      kind: "session",
    });
  }

  await getAppDatabase(input.bindings.DB)
    .delete(sessionEventsTable)
    .where(eq(sessionEventsTable.sessionId, input.sessionId))
    .run();

  await getAppDatabase(input.bindings.DB)
    .delete(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, input.sessionId))
    .run();

  await getAppDatabase(input.bindings.DB)
    .delete(sessionRunsTable)
    .where(eq(sessionRunsTable.sessionId, input.sessionId))
    .run();

  await getAppDatabase(input.bindings.DB)
    .delete(sessionsTable)
    .where(eq(sessionsTable.id, input.sessionId))
    .run();
}

export async function getThreadSnapshot(
  database: D1Database,
  threadId: PublicThreadId,
  apiVersion: PublicApiVersion = "v1",
): Promise<ThreadSnapshot> {
  const sessionId = toBackingSessionId(threadId);
  const row =
    (await getAppDatabase(database)
      .select({
        ...sessionSummaryWithLastRunColumns(),
        kind: sessionsTable.kind,
        creator_account_id: sessionsTable.creatorAccountId,
        end_user_id: sessionsTable.endUserId,
        metadata_json: sessionsTable.metadataJson,
      })
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw publicNotFound("Thread not found.");
  }

  const metadata = parsePublicApiThreadRecordMetadata(row.metadata_json);

  if (
    apiVersion === "v1" &&
    (!metadata || metadata.api_version === "v2" || row.end_user_id === null)
  ) {
    throw publicNotFound("Thread not found.");
  }

  return {
    endUserId: row.end_user_id,
    metadata,
    row: {
      ...row,
      creator_account_id: parsePlatformId<AccountId>(row.creator_account_id, "Creator account ID"),
      end_user_id: row.end_user_id,
    },
    session: buildSessionSummaryFromJoinedRow(row),
  };
}

export async function findPublicThreadSnapshotByIdempotencyKey(
  database: D1Database,
  input: {
    agentId: AgentId | null;
    apiVersion?: PublicApiVersion | undefined;
    idempotencyKey: string;
    createdAfterMs?: number | undefined;
    tokenId: PersonalAccessTokenId;
    projectId?: ProjectId;
  },
): Promise<ThreadSnapshot | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...sessionSummaryWithLastRunColumns(),
        kind: sessionsTable.kind,
        creator_account_id: sessionsTable.creatorAccountId,
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
          sql`coalesce(json_extract(${sessionsTable.metadataJson}, '$.public_api.api_version'), 'v1') = ${input.apiVersion ?? "v1"}`,
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.source') = 'public_api'`,
          input.projectId === undefined
            ? sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.created_by.token_id') = ${input.tokenId}`
            : eq(sessionsTable.projectId, input.projectId),
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.idempotency_key') = ${input.idempotencyKey}`,
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  const metadata = parsePublicApiThreadRecordMetadata(row.metadata_json);

  if (
    !metadata ||
    metadata.idempotency_key !== input.idempotencyKey ||
    ((input.apiVersion ?? "v1") === "v1" && row.end_user_id === null)
  ) {
    return null;
  }

  return {
    endUserId: row.end_user_id,
    metadata,
    row: {
      ...row,
      creator_account_id: parsePlatformId<AccountId>(row.creator_account_id, "Creator account ID"),
      end_user_id: row.end_user_id,
    },
    session: buildSessionSummaryFromJoinedRow(row),
  };
}

export async function setSessionTitleFromThreadPrompt(input: {
  database: D1Database;
  prompt: string;
  sessionId: SessionId;
}): Promise<{
  title: string;
  updatedAt: string;
}> {
  const timestampMs = currentTimestampMs();
  const title = deriveSessionTitleFromPrompt(input.prompt, { timestampMs });

  await getAppDatabase(input.database)
    .update(sessionsTable)
    .set({
      title,
      updatedAt: timestampMs,
    })
    .where(eq(sessionsTable.id, input.sessionId))
    .run();

  return {
    title,
    updatedAt: toIsoString(timestampMs),
  };
}
