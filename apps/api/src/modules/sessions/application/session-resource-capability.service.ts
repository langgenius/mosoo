import type { AgentSessionActionCapabilityName } from "@mosoo/contracts/session";
import type { ProjectId, SessionId } from "@mosoo/id";
import { getAvailableAgentSessionActionCapability } from "@mosoo/session-policy";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { SessionActionAuthorization } from "../domain/session-access.policy";
import {
  getProjectSessionParticipantCapabilityAccess,
  resolveSessionActionCreatorFlag,
} from "../domain/session-access.policy";

export async function ensureSessionResourceCapability(input: {
  action: AgentSessionActionCapabilityName;
  authorization?: SessionActionAuthorization;
  database: D1Database;
  projectId: ProjectId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  const session = await getProjectSessionParticipantCapabilityAccess(
    input.database,
    input.viewer.id,
    {
      projectId: input.projectId,
      sessionId: input.sessionId,
    },
  );

  getAvailableAgentSessionActionCapability({
    action: input.action,
    archivedAt: session.archived_at,
    isSessionCreator: resolveSessionActionCreatorFlag({
      authorization: input.authorization,
      isSessionCreator: session.is_session_creator === 1,
    }),
    runtimeId: session.runtime_id,
    status: session.status,
  });
}
