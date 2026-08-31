import type { SessionMessage } from "@mosoo/contracts/session";
import { sessionMessagesTable } from "@mosoo/db";
import type { ProjectId, SessionId } from "@mosoo/id";
import { asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectSessionParticipantAccess } from "../domain/session-access.policy";
import { resolveStoredSessionMessageReferences } from "../infrastructure/session-message-reference.repository";
import { toSessionMessage } from "./session-message-mappers";
import { getSessionReadAccess } from "./session-read-access.service";

export async function getSessionMessages(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    projectId: ProjectId;
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
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<SessionMessage[]> {
  await ensureProjectSessionParticipantAccess(database, viewer.id, input);

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
      projection_format: sessionMessagesTable.projectionFormat,
      role: sessionMessagesTable.role,
      segments_json: sessionMessagesTable.segmentsJson,
      session_run_id: sessionMessagesTable.sessionRunId,
    })
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, sessionId))
    .orderBy(asc(sessionMessagesTable.seq))
    .all();

  const resolved = await resolveStoredSessionMessageReferences(database, sessionId, results);

  return resolved.map((row) => toSessionMessage(row));
}
