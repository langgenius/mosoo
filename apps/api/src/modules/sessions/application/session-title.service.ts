import type { RenameSessionInput, SessionSummary } from "@mosoo/contracts/session";
import { sessionsTable } from "@mosoo/db";
import { and, eq, isNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureSessionParticipantAccess } from "../domain/session-access.policy";
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
  await ensureSessionParticipantAccess(database, viewer.id, input.sessionId);
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
      .where(eq(sessionsTable.id, input.sessionId))
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
  await ensureSessionParticipantAccess(database, viewer.id, input.sessionId);
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
          isNull(sessionsTable.title),
          eq(sessionsTable.renamed, false),
        ),
      )
      .returning(sessionSummaryColumns())
      .get()) ?? null;

  if (!updated) {
    return getSessionSummaryById(database, viewer.id, input.sessionId);
  }

  return hydrateUpdatedSessionSummary(database, updated);
}
