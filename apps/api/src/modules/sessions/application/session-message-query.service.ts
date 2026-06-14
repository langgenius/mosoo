import type { SessionMessage } from "@mosoo/contracts/session";
import { sessionMessagesTable } from "@mosoo/db";
import type { AppId, SessionId } from "@mosoo/id";
import { asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureAppSessionParticipantAccess } from "../domain/session-access.policy";
import { toSessionMessage } from "./session-message-mappers";
import { getSessionReadAccess } from "./session-read-access.service";

export async function getSessionMessages(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionMessage[]> {
  await getSessionReadAccess(database, viewer.id, input);

  return listSessionMessages(database, input.sessionId);
}

export async function getThreadSessionMessages(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionMessage[]> {
  await ensureAppSessionParticipantAccess(database, viewer.id, input);

  return listSessionMessages(database, input.sessionId);
}

async function listSessionMessages(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionMessage[]> {
  const results = await getAppDatabase(database)
    .select({
      content_text: sessionMessagesTable.contentText,
      created_at: sessionMessagesTable.createdAt,
      created_by_account_id: sessionMessagesTable.createdByAccountId,
      id: sessionMessagesTable.id,
      plan_json: sessionMessagesTable.planJson,
      role: sessionMessagesTable.role,
      segments_json: sessionMessagesTable.segmentsJson,
    })
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, sessionId))
    .orderBy(asc(sessionMessagesTable.seq))
    .all();

  return results.map((row) => toSessionMessage(row));
}
