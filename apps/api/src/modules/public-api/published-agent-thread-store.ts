import type { SessionSummary } from "@mosoo/contracts/session";
import {
  sessionEventsTable,
  sessionMessagesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, PublicThreadId, SessionId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../time";
import { deleteFilesForScope } from "../files/application/file-scope-cleanup.service";
import {
  buildSessionSummaryFromJoinedRow,
  sessionSummaryWithLastRunColumns,
} from "../sessions/application/session-summary-query.service";
import type { SessionSummaryWithLastRunRow } from "../sessions/application/session-summary-query.service";
import { deriveSessionTitleFromPrompt } from "../sessions/domain/session-title";
import { publicNotFound } from "./published-agent-api-errors";
import { toBackingSessionId } from "./published-agent-thread-ids";
import { parsePublicApiThreadMetadata } from "./published-agent-thread-metadata";
import type { PublicApiThreadMetadata } from "./published-agent-thread-metadata";

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
    await deleteFilesForScope(input.bindings, {
      scopeId: input.sessionId,
      scopeKind: "session",
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
