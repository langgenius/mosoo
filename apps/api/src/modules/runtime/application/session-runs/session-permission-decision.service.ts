import type { SessionLiveState, SessionPermissionRequestView } from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, ProjectId, SessionId } from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { createSessionRuntimeEvent } from "../../../sessions/application/session-event-write.service";
import { requireProjectSession } from "../../../sessions/domain/session-access.policy";
import { loadSessionViewerState } from "../../../sessions/infrastructure/session-viewer-live-snapshot.repository";
import { resolvePermissionRequest } from "./resolve-permission-request.service";
type PermissionDecision = "allow_once" | "reject_once";

interface ResolveSessionPermissionDecisionInput {
  bindings: ApiBindings;
  decision: PermissionDecision;
  requestId: string;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

interface RejectSessionPermissionRequestsInput {
  bindings: ApiBindings;
  onPermissionCleanupError: (error: unknown, requestId: string) => void;
  projectId: ProjectId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

async function loadCurrentPermissionState(input: {
  bindings: ApiBindings;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}): Promise<SessionLiveState> {
  return loadSessionViewerState(input.bindings.DB, {
    sessionId: input.sessionId,
    viewerId: input.viewer.id,
  });
}

function requirePermissionRequestDriverInstanceId(
  request: SessionPermissionRequestView,
): DriverInstanceId {
  if (request.driverInstanceId === null) {
    throw new Error("Permission request is missing its driver instance.");
  }

  return parsePlatformId(request.driverInstanceId, "driver instance id");
}

function createPermissionResolvedEvent(input: {
  outcome?: PermissionDecision;
  permissionRequests: SessionPermissionRequestView[];
  requestId?: string;
  sessionId: SessionId;
}): RuntimeEventEnvelope {
  return createSessionRuntimeEvent({
    actor: "user",
    kind: "permission.resolved",
    origin: "viewer",
    payload: {
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      permissionRequests: input.permissionRequests,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    },
    sessionId: input.sessionId,
  });
}

export async function resolveSessionPermissionDecision(
  input: ResolveSessionPermissionDecisionInput,
): Promise<RuntimeEventEnvelope | null> {
  const currentState = await loadCurrentPermissionState(input);
  const request = currentState.permissionRequests.find(
    (candidate) => candidate.requestId === input.requestId,
  );

  if (request === undefined) {
    return null;
  }

  await resolvePermissionRequest(input.bindings, {
    decision: input.decision,
    driverInstanceId: requirePermissionRequestDriverInstanceId(request),
    requestId: input.requestId,
    sessionId: input.sessionId,
  });

  const permissionRequests = currentState.permissionRequests.filter(
    (candidate) => candidate.requestId !== input.requestId,
  );

  return createPermissionResolvedEvent({
    outcome: input.decision,
    permissionRequests,
    requestId: input.requestId,
    sessionId: input.sessionId,
  });
}

export async function rejectSessionPermissionRequests(
  input: RejectSessionPermissionRequestsInput,
): Promise<RuntimeEventEnvelope | null> {
  await requireProjectSession(input.bindings.DB, input.viewer.id, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  const currentState = await loadCurrentPermissionState(input);

  if (currentState.permissionRequests.length === 0) {
    return null;
  }

  const remainingRequests: SessionPermissionRequestView[] = [];

  for (const request of currentState.permissionRequests) {
    try {
      await resolvePermissionRequest(input.bindings, {
        decision: "reject_once",
        driverInstanceId: requirePermissionRequestDriverInstanceId(request),
        requestId: request.requestId,
        sessionId: input.sessionId,
      });
    } catch (error) {
      input.onPermissionCleanupError(error, request.requestId);
      remainingRequests.push(request);
    }
  }

  if (remainingRequests.length === currentState.permissionRequests.length) {
    return null;
  }

  return createPermissionResolvedEvent({
    permissionRequests: remainingRequests,
    sessionId: input.sessionId,
  });
}
