import { parsePlatformId } from "@mosoo/id";
import type { ProjectId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { requireActiveProjectSession } from "../domain/session-access.policy";
import { connectSessionViewerWebSocket } from "../infrastructure/session/client";

export async function connectAuthenticatedSessionViewerWebSocket(
  bindings: ApiBindings,
  input: {
    projectId: string;
    request: Request;
    sessionId: string;
    viewer: AuthenticatedViewer;
  },
): Promise<Response> {
  const sessionId = parsePlatformId<SessionId>(input.sessionId, "Session viewer socket session ID");
  const projectId = parsePlatformId<ProjectId>(input.projectId, "Session viewer socket project ID");
  await requireActiveProjectSession(bindings.DB, input.viewer.id, {
    projectId,
    sessionId,
  });

  return connectSessionViewerWebSocket(bindings, {
    projectId,
    request: input.request,
    sessionId,
    viewer: input.viewer,
  });
}
