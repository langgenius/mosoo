import { sessionsTable } from "@mosoo/db";
import type { AccountId, OrganizationId, AppId, SessionId } from "@mosoo/id";
import { and, eq, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { ensureAppOwnership } from "../../apps/application/app.service";
import { createFileNotFoundError } from "./file-errors";

export interface SessionFileAccessRow {
  id: SessionId;
  provider: string;
  title: string | null;
  organization_id: OrganizationId;
}

export interface AppSessionFileAccessRow extends SessionFileAccessRow {
  app_id: AppId;
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

export async function ensureAppSessionFileAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<AppSessionFileAccessRow> {
  await ensureAppOwnership(database, viewerId, input.appId);

  const row =
    (await getAppDatabase(database)
      .select({
        id: sessionsTable.id,
        organization_id: sessionsTable.organizationId,
        app_id: sessionsTable.appId,
        provider: sessionsTable.provider,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.appId, input.appId),
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
