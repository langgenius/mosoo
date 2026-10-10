import type { SessionMessagePlanEntry, SessionMessageSegment } from "@mosoo/contracts/session";
import { sessionMessagesTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { PlatformId, SessionId, SessionMessageId, SessionRunId } from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

export interface InsertSessionMessageInput {
  content: string;
  createdByAccountId: PlatformId;
  // Optional stable id. Runtime assistant projection already has a deterministic
  // live message id, so storing it directly keeps hydration dedupe exact.
  id?: SessionMessageId;
  plan?: SessionMessagePlanEntry[];
  role: "assistant" | "user";
  segments?: SessionMessageSegment[];
  sessionId: SessionId;
  sessionRunId?: SessionRunId | null;
}

export type PreparedSessionMessageInsert = Awaited<ReturnType<typeof prepareSessionMessageInsert>>;

/**
 * Appends one message to the `session_message` transcript for a session and bumps the
 * parent session's `last_message_at` / `updated_at` markers so list views
 * order correctly without a secondary join. The caller is responsible for
 * enforcing ownership and ordering; this repository only persists the row.
 *
 * @param {D1Database} database D1 database binding that owns the session transcript tables.
 * @param {InsertSessionMessageInput} input Message payload plus optional caller-supplied stable id.
 * @returns {Promise<SessionMessageId>} Persisted session message id.
 */
export async function insertSessionMessage(
  database: D1Database,
  input: InsertSessionMessageInput,
): Promise<SessionMessageId> {
  const prepared = await prepareSessionMessageInsert(database, input);
  await getAppDatabase(database).insert(sessionMessagesTable).values(prepared.row).run();
  return prepared.row.id;
}

export async function prepareSessionMessageInsert(
  database: D1Database,
  input: InsertSessionMessageInput,
) {
  const timestampMs = currentTimestampMs();
  const messageId = input.id ?? createPlatformId<SessionMessageId>();
  const seq = await allocateSessionMessageSeq(database, {
    sessionId: input.sessionId,
    timestampMs,
  });

  const row: typeof sessionMessagesTable.$inferSelect = {
    contentText: input.content,
    createdAt: timestampMs,
    createdByAccountId: input.createdByAccountId,
    id: messageId,
    planJson: input.plan && input.plan.length > 0 ? JSON.stringify(input.plan) : null,
    role: input.role,
    segmentsJson:
      input.segments && input.segments.length > 0 ? JSON.stringify(input.segments) : null,
    seq,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId ?? null,
  };

  return {
    row,
    insert(db: AppDatabase, condition: SQL) {
      return db.insert(sessionMessagesTable).select(
        db
          .select({
            contentText: sql<string>`${row.contentText}`.as("content_text"),
            createdAt: sql<number>`${row.createdAt}`.as("created_at"),
            createdByAccountId: sql<PlatformId>`${row.createdByAccountId}`.as(
              "created_by_account_id",
            ),
            id: sql<SessionMessageId>`${row.id}`.as("id"),
            planJson: sql<string | null>`${row.planJson}`.as("plan_json"),
            role: sql<"assistant" | "user">`${row.role}`.as("role"),
            segmentsJson: sql<string | null>`${row.segmentsJson}`.as("segments_json"),
            seq: sql<number>`${row.seq}`.as("seq"),
            sessionId: sql<SessionId>`${row.sessionId}`.as("session_id"),
            sessionRunId: sql<SessionRunId | null>`${row.sessionRunId}`.as("session_run_id"),
          })
          .from(sessionsTable)
          .where(and(eq(sessionsTable.id, row.sessionId), condition)),
      );
    },
  };
}

async function allocateSessionMessageSeq(
  database: D1Database,
  input: {
    sessionId: SessionId;
    timestampMs: number;
  },
): Promise<number> {
  const appDb = getAppDatabase(database);
  const session =
    (await appDb
      .update(sessionsTable)
      .set({
        lastMessageAt: input.timestampMs,
        messageSeqCursor: sql`${sessionsTable.messageSeqCursor} + 1`,
        updatedAt: input.timestampMs,
      })
      .where(eq(sessionsTable.id, input.sessionId))
      .returning({ seq: sessionsTable.messageSeqCursor })
      .get()) ?? null;

  if (session === null) {
    throw new Error("Session not found while allocating a message sequence.");
  }

  return session.seq;
}
