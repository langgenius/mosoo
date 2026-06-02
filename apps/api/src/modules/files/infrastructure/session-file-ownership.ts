import { sessionsTable } from "@mosoo/db";
import type { AccountId, OrganizationId, SessionId } from "@mosoo/id";
import { and, eq, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { createFileNotFoundError } from "./file-errors";

export interface SessionFileAccessRow {
  id: SessionId;
  provider: string;
  title: string | null;
  organization_id: OrganizationId;
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
        organization_id: sessionsTable.organizationId,
        provider: sessionsTable.provider,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, sessionId),
          or(
            eq(sessionsTable.creatorAccountId, viewerId),
            eq(sessionsTable.attributedUserId, viewerId),
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
