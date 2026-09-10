import { parsePlatformId } from "@mosoo/id";
import type { AccountId, ProjectId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { getParticipantSessionSummaryById } from "../../../sessions/application/session-summary-query.service";
import { scheduleAgentSessionRuntimePrewarm } from "./prewarm-agent-session-runtime.service";

export interface ScheduleSessionPrewarmRequest {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: {
    projectId: string;
    sessionId: string;
  };
  requestUrl: string;
  viewer: AuthenticatedViewer;
}

export interface SessionRuntimePrewarmAck {
  scheduledAt: string;
  sessionId: SessionId;
}

/**
 * Re-schedules the prewarm pipeline for an existing session.
 *
 * Viewer sockets only subscribe to events. Explicit composer activity can
 * request prewarm here before a user sends another message.
 *
 * Authorization piggy-backs on participant access (same gate that lets a
 * viewer read messages). The underlying scheduler is fire-and-forget through
 * `waitUntil`, runs with `failureMode: "best_effort"`, and skips when an
 * active run is already present, so repeated calls are safe and idempotent.
 */
export async function scheduleSessionPrewarm(
  request: ScheduleSessionPrewarmRequest,
): Promise<SessionRuntimePrewarmAck> {
  const sessionId = parsePlatformId<SessionId>(request.input.sessionId, "session id");
  const projectId = parsePlatformId<ProjectId>(request.input.projectId, "project id");
  const viewerId = parsePlatformId<AccountId>(request.viewer.id, "viewer id");
  const session = await getParticipantSessionSummaryById(request.bindings.DB, viewerId, {
    projectId,
    sessionId,
  });

  scheduleAgentSessionRuntimePrewarm({
    bindings: request.bindings,
    executionContext: request.executionContext,
    requestUrl: request.requestUrl,
    session: {
      id: session.id,
      projectId: session.projectId,
    },
    viewer: request.viewer,
  });

  return {
    scheduledAt: new Date().toISOString(),
    sessionId: session.id,
  };
}
