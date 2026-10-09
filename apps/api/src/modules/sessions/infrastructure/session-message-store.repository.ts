import type { SessionMessagePlanEntry, SessionMessageSegment } from "@mosoo/contracts/session";
import { sessionMessagesTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { PlatformId, SessionId, SessionMessageId, SessionRunId } from "@mosoo/id";
import { eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
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
  const timestampMs = currentTimestampMs();
  const messageId = input.id ?? createPlatformId<SessionMessageId>();
  const seq = await allocateSessionMessageSeq(database, {
    sessionId: input.sessionId,
    timestampMs,
  });

  await getAppDatabase(database)
    .insert(sessionMessagesTable)
    .values({
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
    })
    .run();

  return messageId;
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
