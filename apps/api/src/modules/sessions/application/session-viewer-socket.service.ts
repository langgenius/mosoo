import type { SessionType } from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";
import type { ProjectId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getActiveProjectSessionParticipantAccess } from "../domain/session-access.policy";
import { connectSessionViewerWebSocket } from "../infrastructure/session/client";

interface ActiveViewerSocketSession {
  id: SessionId;
  projectId: ProjectId;
  type: SessionType;
}

export interface SessionViewerSocketRuntimePrewarmRequest {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  requestUrl: string;
  session: {
    id: SessionId;
    projectId: ProjectId;
  };
  viewer: AuthenticatedViewer;
}

export type SessionViewerSocketRuntimePrewarmScheduler = (
  request: SessionViewerSocketRuntimePrewarmRequest,
) => void;

export type SessionViewerSocketConnector = (
  bindings: ApiBindings,
  input: {
    request: Request;
    projectId: ProjectId;
    sessionId: SessionId;
    viewer: AuthenticatedViewer;
  },
) => Promise<Response>;

export function shouldSchedulePreviewRuntimePrewarmForViewerSocket(input: {
  responseStatus: number;
  sessionType: SessionType;
}): boolean {
  return input.sessionType === "preview" && input.responseStatus === 101;
}

function scheduleSessionViewerSocketRuntimePrewarm(
  request: SessionViewerSocketRuntimePrewarmRequest,
): void {
  if (!request.executionContext) {
    return;
  }

  request.executionContext.waitUntil(
    import("../../runtime/application/session-runs/prewarm-agent-session-runtime.service").then(
      ({ prewarmAgentSessionRuntime }) =>
        prewarmAgentSessionRuntime({
          bindings: request.bindings,
          failureMode: "best_effort",
          requestUrl: request.requestUrl,
          session: request.session,
          viewer: request.viewer,
        }),
    ),
  );
}

function schedulePreviewRuntimePrewarmForViewerSocket(input: {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  requestUrl: string;
  responseStatus: number;
  runtimePrewarmScheduler?: SessionViewerSocketRuntimePrewarmScheduler | null;
  session: ActiveViewerSocketSession;
  viewer: AuthenticatedViewer;
}): void {
  if (
    !shouldSchedulePreviewRuntimePrewarmForViewerSocket({
      responseStatus: input.responseStatus,
      sessionType: input.session.type,
    })
  ) {
    return;
  }

  const runtimePrewarmScheduler =
    input.runtimePrewarmScheduler ?? scheduleSessionViewerSocketRuntimePrewarm;

  runtimePrewarmScheduler({
    bindings: input.bindings,
    executionContext: input.executionContext,
    requestUrl: input.requestUrl,
    session: {
      id: input.session.id,
      projectId: input.session.projectId,
    },
    viewer: input.viewer,
  });
}

export async function connectAuthenticatedSessionViewerWebSocket(
  bindings: ApiBindings,
  input: {
    executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
    projectId: string;
    request: Request;
    runtimePrewarmScheduler?: SessionViewerSocketRuntimePrewarmScheduler | null;
    sessionViewerSocketConnector?: SessionViewerSocketConnector | null;
    sessionId: string;
    viewer: AuthenticatedViewer;
  },
): Promise<Response> {
  const sessionId = parsePlatformId<SessionId>(input.sessionId, "Session viewer socket session ID");
  const projectId = parsePlatformId<ProjectId>(input.projectId, "Session viewer socket project ID");
  const viewer = input.viewer;
  const viewerId = viewer.id;
  const access = await getActiveProjectSessionParticipantAccess(bindings.DB, viewerId, {
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

  schedulePreviewRuntimePrewarmForViewerSocket({
    bindings,
    executionContext: input.executionContext ?? null,
    requestUrl: input.request.url,
    responseStatus: response.status,
    runtimePrewarmScheduler: input.runtimePrewarmScheduler ?? null,
    session: {
      id: sessionId,
      projectId: access.project_id,
      type: access.type,
    },
    viewer,
  });

  return response;
}
