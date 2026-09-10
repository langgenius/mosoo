import { parsePlatformId } from "@mosoo/id";
import type { ProjectId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getActiveProjectSessionParticipantAccess } from "../domain/session-access.policy";
import { connectSessionViewerWebSocket } from "../infrastructure/session/client";

export type SessionViewerSocketConnector = (
  bindings: ApiBindings,
  input: {
    request: Request;
    projectId: ProjectId;
    sessionId: SessionId;
    viewer: AuthenticatedViewer;
  },
) => Promise<Response>;

export async function connectAuthenticatedSessionViewerWebSocket(
  bindings: ApiBindings,
  input: {
    projectId: string;
    request: Request;
    sessionViewerSocketConnector?: SessionViewerSocketConnector | null;
    sessionId: string;
    viewer: AuthenticatedViewer;
  },
): Promise<Response> {
  const sessionId = parsePlatformId<SessionId>(input.sessionId, "Session viewer socket session ID");
  const projectId = parsePlatformId<ProjectId>(input.projectId, "Session viewer socket project ID");
  const viewer = input.viewer;
  const viewerId = viewer.id;
  await getActiveProjectSessionParticipantAccess(bindings.DB, viewerId, {
    projectId,
    sessionId,
  });
  const sessionViewerSocketConnector =
    input.sessionViewerSocketConnector ?? connectSessionViewerWebSocket;
  const response = await sessionViewerSocketConnector(bindings, {
    projectId,
    request: input.request,
    sessionId,
    viewer,
  });

  // Viewer reconnects only subscribe to durable events; they must not wake compute.
  return response;
}
