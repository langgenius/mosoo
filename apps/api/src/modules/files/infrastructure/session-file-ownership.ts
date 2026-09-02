import { sessionsTable } from "@mosoo/db";
import type { AccountId, ProjectId, SessionId } from "@mosoo/id";
import { and, eq, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { createFileNotFoundError } from "./file-errors";

export interface SessionFileAccessRow {
  id: SessionId;
  provider: string;
  title: string | null;
}

export interface ProjectSessionFileAccessRow extends SessionFileAccessRow {
  project_id: ProjectId;
}

export async function ensureSessionFileAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionFileAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        id: sessionsTable.id,
        provider: sessionsTable.provider,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, sessionId),
          or(
            eq(sessionsTable.creatorAccountId, viewerId),
            eq(sessionsTable.participantAccountId, viewerId),
          ),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw createFileNotFoundError("Session not found.");
  }

  return row;
}

export async function ensureProjectSessionFileAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<ProjectSessionFileAccessRow> {
  await ensureProjectOwnership(database, viewerId, input.projectId);

  const row =
    (await getAppDatabase(database)
      .select({
        id: sessionsTable.id,
        project_id: sessionsTable.projectId,
        provider: sessionsTable.provider,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.projectId, input.projectId),
          or(
            eq(sessionsTable.creatorAccountId, viewerId),
            eq(sessionsTable.participantAccountId, viewerId),
          ),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw createFileNotFoundError("Session not found.");
  }

  return row;
}
