import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AppId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { getParticipantSessionSummaryById } from "../../../sessions/application/session-summary-query.service";
import { scheduleAgentSessionRuntimePrewarm } from "./prewarm-agent-session-runtime.service";

export interface ScheduleSessionPrewarmRequest {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: {
    appId: string;
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
 * The viewer-socket entry point already prewarms once on initial connect, but
 * Durable Object hibernation after a few minutes of idle clears the warm
 * driver state with no automatic re-trigger. This service is the cheap path
 * that lets the client request another prewarm — e.g. when the user resumes
 * typing in the follow-up composer — without having to actually send a
 * message to discover that the runtime went cold.
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
  const appId = parsePlatformId<AppId>(request.input.appId, "app id");
  const viewerId = parsePlatformId<AccountId>(request.viewer.id, "viewer id");
  const session = await getParticipantSessionSummaryById(request.bindings.DB, viewerId, {
    appId,
    sessionId,
  });

  scheduleAgentSessionRuntimePrewarm({
    bindings: request.bindings,
    executionContext: request.executionContext,
    requestUrl: request.requestUrl,
    session: {
      id: session.id,
      organizationId: session.organizationId,
      appId: session.appId,
    },
    viewer: request.viewer,
  });

  return {
    scheduledAt: new Date().toISOString(),
    sessionId: session.id,
  };
}
