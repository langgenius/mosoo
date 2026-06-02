import type {
  SessionThreadUiState,
  UpdateSessionThreadUiStateInput,
} from "@mosoo/contracts/session";
import { sessionsTable, sessionThreadUiStatesTable } from "@mosoo/db";
import type { OrganizationId, SessionId } from "@mosoo/id";
import { and, desc, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureOrganizationMembership } from "../../organizations/domain/organization-access.policy";
import {
  ensureSessionParticipantAccess,
  sessionParticipantCondition,
} from "../domain/session-access.policy";

interface SessionThreadUiStateRow {
  pinned: number;
  read_at: number | null;
  session_id: SessionId;
  updated_at: number;
}

export const SESSION_THREAD_UI_STATE_LIST_LIMIT = 100;

function toSessionThreadUiState(row: SessionThreadUiStateRow): SessionThreadUiState {
  return {
    pinned: row.pinned === 1,
    readAt: row.read_at === null ? null : toIsoString(row.read_at),
    sessionId: row.session_id,
    updatedAt: toIsoString(row.updated_at),
  };
}

function parseReadAt(value: string | null | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const timestamp = Date.parse(value);
  const isoValue = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;

  if (isoValue !== value) {
    throw validationError("Thread readAt must be an ISO timestamp.");
  }

  if (timestamp > currentTimestampMs()) {
    throw validationError("Thread readAt cannot be in the future.");
  }

  return timestamp;
}

export async function listSessionThreadUiStates(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<SessionThreadUiState[]> {
  await ensureOrganizationMembership(database, viewer.id, organizationId);

  const results = await getAppDatabase(database)
    .select({
      pinned: sql<number>`${sessionThreadUiStatesTable.pinned}`,
      read_at: sessionThreadUiStatesTable.readAt,
      session_id: sessionThreadUiStatesTable.sessionId,
      updated_at: sessionThreadUiStatesTable.updatedAt,
    })
    .from(sessionThreadUiStatesTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionThreadUiStatesTable.sessionId))
    .where(
      and(
        eq(sessionThreadUiStatesTable.accountId, viewer.id),
        eq(sessionsTable.organizationId, organizationId),
        sessionParticipantCondition(viewer.id),
      ),
    )
    .orderBy(desc(sessionThreadUiStatesTable.updatedAt), desc(sessionThreadUiStatesTable.sessionId))
    .limit(SESSION_THREAD_UI_STATE_LIST_LIMIT)
    .all();

  return results.map(toSessionThreadUiState);
}

export async function updateSessionThreadUiState(input: {
  database: D1Database;
  input: UpdateSessionThreadUiStateInput;
  viewer: AuthenticatedViewer;
}): Promise<SessionThreadUiState> {
  await ensureSessionParticipantAccess(input.database, input.viewer.id, input.input.sessionId);

  const nextPinned = input.input.pinned ?? undefined;
  const nextReadAt = parseReadAt(input.input.readAt);
  const updatedAt = currentTimestampMs();
  const row =
    (await getAppDatabase(input.database)
      .insert(sessionThreadUiStatesTable)
      .values({
        accountId: input.viewer.id,
        pinned: nextPinned ?? false,
        readAt: nextReadAt ?? null,
        sessionId: input.input.sessionId,
        updatedAt,
      })
      .onConflictDoUpdate({
        set: {
          pinned:
            nextPinned === undefined
              ? sql<number>`${sessionThreadUiStatesTable.pinned}`
              : nextPinned,
          readAt:
            nextReadAt === undefined
              ? sql<number>`${sessionThreadUiStatesTable.readAt}`
              : nextReadAt,
          updatedAt,
        },
        target: [sessionThreadUiStatesTable.accountId, sessionThreadUiStatesTable.sessionId],
      })
      .returning({
        pinned: sql<number>`${sessionThreadUiStatesTable.pinned}`,
        read_at: sessionThreadUiStatesTable.readAt,
        session_id: sessionThreadUiStatesTable.sessionId,
        updated_at: sessionThreadUiStatesTable.updatedAt,
      })
      .get()) ?? null;

  if (row === null) {
    throw new Error("Session thread UI state could not be updated.");
  }

  return toSessionThreadUiState(row);
}
