import type { SessionSummary } from "@mosoo/contracts/session";
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
  PublicThreadId,
  SessionId,
} from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../time";
import { fileStore } from "../files/application/file-store";
import {
  buildSessionSummaryFromJoinedRow,
  sessionSummaryWithLastRunColumns,
} from "../sessions/application/session-summary-query.service";
import type { SessionSummaryWithLastRunRow } from "../sessions/application/session-summary-query.service";
import { deriveSessionTitleFromPrompt } from "../sessions/domain/session-title";
import { publicNotFound } from "./public-api-errors";
import { toBackingSessionId } from "./public-thread-ids";
import { parsePublicApiThreadMetadata } from "./public-thread-metadata";
import type { PublicApiThreadMetadata } from "./public-thread-metadata";

export interface ThreadSnapshotRow extends SessionSummaryWithLastRunRow {
  attributed_user_id: AccountId | null;
  creator_account_id: AccountId;
  metadata_json: string;
}

export interface ThreadSnapshot {
  metadata: PublicApiThreadMetadata;
  row: ThreadSnapshotRow;
  session: SessionSummary;
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
): Promise<ThreadSnapshot> {
  const sessionId = toBackingSessionId(threadId);
  const row =
    (await getAppDatabase(database)
      .select({
        ...sessionSummaryWithLastRunColumns(),
        attributed_user_id: sessionsTable.attributedUserId,
        creator_account_id: sessionsTable.creatorAccountId,
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

  const metadata = parsePublicApiThreadMetadata(row.metadata_json);

  if (!metadata) {
    throw publicNotFound("Thread not found.");
  }

  return {
    metadata,
    row: {
      ...row,
      creator_account_id: parsePlatformId<AccountId>(row.creator_account_id, "Creator account ID"),
    },
    session: buildSessionSummaryFromJoinedRow(row),
  };
}

export async function findPublicThreadSnapshotByIdempotencyKey(
  database: D1Database,
  input: {
    agentId: AgentId;
    idempotencyKey: string;
    tokenId: PersonalAccessTokenId;
  },
): Promise<ThreadSnapshot | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...sessionSummaryWithLastRunColumns(),
        attributed_user_id: sessionsTable.attributedUserId,
        creator_account_id: sessionsTable.creatorAccountId,
        metadata_json: sessionsTable.metadataJson,
      })
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(
        and(
          eq(sessionsTable.agentId, input.agentId),
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.source') = 'public_api'`,
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.created_by.token_id') = ${input.tokenId}`,
          sql`json_extract(${sessionsTable.metadataJson}, '$.public_api.idempotency_key') = ${input.idempotencyKey}`,
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  const metadata = parsePublicApiThreadMetadata(row.metadata_json);

  if (!metadata || metadata.idempotency_key !== input.idempotencyKey) {
    return null;
  }

  return {
    metadata,
    row: {
      ...row,
      creator_account_id: parsePlatformId<AccountId>(row.creator_account_id, "Creator account ID"),
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
