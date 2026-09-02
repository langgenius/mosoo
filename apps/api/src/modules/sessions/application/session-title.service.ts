import type { RenameSessionInput, SessionSummary } from "@mosoo/contracts/session";
import { sessionsTable } from "@mosoo/db";
import type { PlatformId, RuntimeEventId, SessionId } from "@mosoo/id";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectSessionParticipantAccess } from "../domain/session-access.policy";
import { normalizeSessionTitle } from "../domain/session-title";
import {
  getSessionSummaryById,
  hydrateSessionSummariesFromRows,
  sessionSummaryColumns,
} from "./session-query.service";
import type { SessionSummaryRow } from "./session-summary-query.service";

export interface RenameSessionRequest {
  database: D1Database;
  input: RenameSessionInput;
  viewer: AuthenticatedViewer;
}

export interface DurableSessionAutoTitleInput {
  creatorAccountId: PlatformId;
  eventSeq: number;
  sessionId: SessionId;
  title: string;
}

export function prepareDurableSessionAutoTitleProjection(
  database: D1Database,
  input: {
    createdAt: number;
    eventId: RuntimeEventId;
    eventSeq: number;
    semanticHash: string;
    sessionId: SessionId;
    title: string;
  },
): D1PreparedStatement[] {
  if (!Number.isSafeInteger(input.eventSeq) || input.eventSeq < 0) {
    throw new Error("Session auto-title event seq must be a non-negative safe integer.");
  }

  const title = normalizeSessionTitle(input.title);
  const receiptFence = `EXISTS (
    SELECT 1
      FROM session_event AS receipt
     WHERE receipt.id = ?
       AND receipt.session_id = ?
       AND receipt.event_type = 'session.info.updated'
       AND receipt.semantic_hash = ?
       AND receipt.seq = ?
  )`;
  const update = database
    .prepare(
      `UPDATE session
          SET auto_title_event_seq = ?, title = ?, updated_at = ?
        WHERE id = ?
          AND renamed = 0
          AND (title IS NULL OR auto_title_event_seq IS NOT NULL)
          AND (auto_title_event_seq IS NULL OR auto_title_event_seq < ?)
          AND ${receiptFence}`,
    )
    .bind(
      input.eventSeq,
      title,
      input.createdAt,
      input.sessionId,
      input.eventSeq,
      input.eventId,
      input.sessionId,
      input.semanticHash,
      input.eventSeq,
    );
  const guard = database
    .prepare(
      `INSERT INTO session_event (id)
       SELECT ?
        WHERE ${receiptFence}
          AND NOT EXISTS (
            SELECT 1
              FROM session
             WHERE id = ?
               AND (
                 renamed = 1
                 OR (auto_title_event_seq IS NULL AND title IS NOT NULL)
                 OR auto_title_event_seq > ?
                 OR (auto_title_event_seq = ? AND title = ?)
               )
          )`,
    )
    .bind(
      input.eventId,
      input.eventId,
      input.sessionId,
      input.semanticHash,
      input.eventSeq,
      input.sessionId,
      input.eventSeq,
      input.eventSeq,
      title,
    );

  return [update, guard];
}

async function hydrateUpdatedSessionSummary(
  database: D1Database,
  row: SessionSummaryRow,
): Promise<SessionSummary> {
  const [session] = await hydrateSessionSummariesFromRows(database, [row]);

  if (session === undefined) {
    throw new Error("Session not found.");
  }

  return session;
}

export async function renameSession({
  database,
  input,
  viewer,
}: RenameSessionRequest): Promise<SessionSummary> {
  await ensureProjectSessionParticipantAccess(database, viewer.id, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  const normalizedTitle = normalizeSessionTitle(input.title);
  const timestampMs = currentTimestampMs();

  const updated =
    (await getAppDatabase(database)
      .update(sessionsTable)
      .set({
        renamed: true,
        title: normalizedTitle,
        updatedAt: timestampMs,
      })
      .where(
        and(eq(sessionsTable.id, input.sessionId), eq(sessionsTable.projectId, input.projectId)),
      )
      .returning(sessionSummaryColumns())
      .get()) ?? null;

  if (!updated) {
    throw new Error("Session not found.");
  }

  return hydrateUpdatedSessionSummary(database, updated);
}

export async function autoTitleSession(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RenameSessionInput,
): Promise<SessionSummary> {
  await ensureProjectSessionParticipantAccess(database, viewer.id, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  const normalizedTitle = normalizeSessionTitle(input.title);

  const updated =
    (await getAppDatabase(database)
      .update(sessionsTable)
      .set({
        title: normalizedTitle,
        updatedAt: currentTimestampMs(),
      })
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.projectId, input.projectId),
          isNull(sessionsTable.title),
          eq(sessionsTable.renamed, false),
        ),
      )
      .returning(sessionSummaryColumns())
      .get()) ?? null;

  if (!updated) {
    return getSessionSummaryById(database, viewer.id, {
      projectId: input.projectId,
      sessionId: input.sessionId,
    });
  }

  return hydrateUpdatedSessionSummary(database, updated);
}

export async function applyDurableSessionAutoTitle(
  database: D1Database,
  input: DurableSessionAutoTitleInput,
): Promise<void> {
  if (!Number.isSafeInteger(input.eventSeq) || input.eventSeq < 0) {
    throw new Error("Session auto-title event seq must be a non-negative safe integer.");
  }

  const title = normalizeSessionTitle(input.title);
  const appDatabase = getAppDatabase(database);

  await appDatabase
    .update(sessionsTable)
    .set({
      autoTitleEventSeq: input.eventSeq,
      title,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(sessionsTable.id, input.sessionId),
        eq(sessionsTable.creatorAccountId, input.creatorAccountId),
        eq(sessionsTable.renamed, false),
        or(isNull(sessionsTable.title), isNotNull(sessionsTable.autoTitleEventSeq)),
        or(
          isNull(sessionsTable.autoTitleEventSeq),
          lt(sessionsTable.autoTitleEventSeq, input.eventSeq),
        ),
      ),
    )
    .run();

  const stored =
    (await appDatabase
      .select({
        autoTitleEventSeq: sessionsTable.autoTitleEventSeq,
        renamed: sessionsTable.renamed,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.creatorAccountId, input.creatorAccountId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (stored === null) {
    throw new Error("Session not found for durable auto-title.");
  }

  if (stored.renamed || (stored.autoTitleEventSeq === null && stored.title !== null)) {
    return;
  }

  if (stored.autoTitleEventSeq === null || stored.autoTitleEventSeq < input.eventSeq) {
    throw new Error("Session auto-title CAS did not persist the durable event.");
  }

  if (stored.autoTitleEventSeq === input.eventSeq && stored.title !== title) {
    throw new Error("Session auto-title event seq was replayed with conflicting content.");
  }
}
