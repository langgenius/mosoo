import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, AppId, SessionId } from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { runOrderedAsyncTasks } from "../../../../shared/ordered-async";
import { isTruthy } from "../../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { createSessionRuntimeEvent } from "../../../sessions/application/session-event-write.service";
import {
  applyRuntimeEventToSessionLiveState,
  loadSessionViewerState,
} from "../../../sessions/application/session-live-state.service";
import type { SessionLiveState } from "../../../sessions/application/session-live-state.service";
import { ensureAppSessionParticipantAccess } from "../../../sessions/domain/session-access.policy";
import { resolvePermissionRequest } from "./resolve-permission-request.service";
type PermissionDecision = "allow_once" | "reject_once";

export interface SessionPermissionStateUpdate {
  event: RuntimeEventEnvelope;
  state: SessionLiveState;
}

interface ResolveSessionPermissionDecisionInput {
  bindings: ApiBindings;
  cachedState?: SessionLiveState | null;
  decision: PermissionDecision;
  appId: AppId;
  requestId: string;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

interface RejectSessionPermissionRequestsInput {
  bindings: ApiBindings;
  cachedState?: SessionLiveState | null;
  onPermissionCleanupError: (error: unknown, requestId: string) => void;
  appId: AppId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

async function loadCurrentPermissionState(input: {
  bindings: ApiBindings;
  cachedState?: SessionLiveState | null;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}): Promise<SessionLiveState> {
  if (isTruthy(input.cachedState)) {
    return input.cachedState;
  }

  return loadSessionViewerState(input.bindings.DB, {
    sessionId: input.sessionId,
    viewerId: parsePlatformId(input.viewer.id, "viewer id"),
  });
}

function requirePermissionRequestDriverInstanceId(
  request: SessionLiveState["permissionRequests"][number],
): DriverInstanceId {
  if (request.driverInstanceId === null) {
    throw new Error("Permission request is missing its driver instance.");
  }

  return parsePlatformId(request.driverInstanceId, "driver instance id");
}

async function createPermissionStateUpdate(input: {
  currentState: SessionLiveState;
  outcome?: PermissionDecision;
  permissionRequests: SessionLiveState["permissionRequests"];
  requestId?: string;
  sessionId: SessionId;
}): Promise<SessionPermissionStateUpdate> {
  const event = createSessionRuntimeEvent({
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

  return {
    event,
    state: applyRuntimeEventToSessionLiveState(input.currentState, event),
  };
}

export async function resolveSessionPermissionDecision(
  input: ResolveSessionPermissionDecisionInput,
): Promise<SessionPermissionStateUpdate | null> {
  await ensureAppSessionParticipantAccess(input.bindings.DB, input.viewer.id, {
    appId: input.appId,
    sessionId: input.sessionId,
  });
  const currentState = await loadCurrentPermissionState(input);
  const request = currentState.permissionRequests.find(
    (candidate) => candidate.requestId === input.requestId,
  );

  if (request === undefined) {
    return null;
  }

  await resolvePermissionRequest(input.bindings, input.viewer, {
    decision: input.decision,
    driverInstanceId: requirePermissionRequestDriverInstanceId(request),
    appId: input.appId,
    requestId: input.requestId,
    sessionId: input.sessionId,
  });

  const permissionRequests = currentState.permissionRequests.filter(
    (candidate) => candidate.requestId !== input.requestId,
  );

  return createPermissionStateUpdate({
    currentState,
    outcome: input.decision,
    permissionRequests,
    requestId: input.requestId,
    sessionId: input.sessionId,
  });
}

export async function rejectSessionPermissionRequests(
  input: RejectSessionPermissionRequestsInput,
): Promise<SessionPermissionStateUpdate | null> {
  await ensureAppSessionParticipantAccess(input.bindings.DB, input.viewer.id, {
    appId: input.appId,
    sessionId: input.sessionId,
  });
  const currentState = await loadCurrentPermissionState(input);

  if (currentState.permissionRequests.length === 0) {
    return null;
  }

  const remainingRequests: SessionLiveState["permissionRequests"] = [];

  const cleanupResults = await runOrderedAsyncTasks(
    currentState.permissionRequests.map((request) => async () => {
      try {
        await resolvePermissionRequest(input.bindings, input.viewer, {
          decision: "reject_once",
          driverInstanceId: requirePermissionRequestDriverInstanceId(request),
          appId: input.appId,
          requestId: request.requestId,
          sessionId: input.sessionId,
        });
        return { rejected: true, request };
      } catch (error) {
        input.onPermissionCleanupError(error, request.requestId);
        return { rejected: false, request };
      }
    }),
  );

  for (const result of cleanupResults) {
    if (!result.rejected) {
      remainingRequests.push(result.request);
    }
  }

  if (remainingRequests.length === currentState.permissionRequests.length) {
    return null;
  }

  return createPermissionStateUpdate({
    currentState,
    permissionRequests: remainingRequests,
    sessionId: input.sessionId,
  });
}
