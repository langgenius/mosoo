import type { SessionMessage } from "@mosoo/contracts/session";
import type { ProjectId, SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { requireProjectSession } from "../domain/session-access.policy";
import { listSessionMessages } from "../infrastructure/session-message-snapshot.repository";

export async function getThreadSessionMessages(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<SessionMessage[]> {
  await requireProjectSession(database, viewer.id, input);

  return listSessionMessages(database, input.sessionId);
}
