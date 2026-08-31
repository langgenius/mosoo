import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, ProjectId, SessionId, SessionRunId } from "@mosoo/id";
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
import { ensureProjectSessionParticipantAccess } from "../../../sessions/domain/session-access.policy";
import { resolvePermissionRequest } from "./resolve-permission-request.service";
type PermissionDecision = "allow_once" | "reject_once";

export interface SessionPermissionStateUpdate {
  events: RuntimeEventEnvelope[];
  state: SessionLiveState;
}

interface ResolveSessionPermissionDecisionInput {
  bindings: ApiBindings;
  cachedState?: SessionLiveState | null;
  decision: PermissionDecision;
  projectId: ProjectId;
  requestId: string;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

interface RejectSessionPermissionRequestsInput {
  bindings: ApiBindings;
  cachedState?: SessionLiveState | null;
  onPermissionCleanupError: (error: unknown, requestId: string) => void;
  projectId: ProjectId;
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
  events: RuntimeEventEnvelope[];
}): Promise<SessionPermissionStateUpdate> {
  return {
    events: input.events,
    state: input.events.reduce(applyRuntimeEventToSessionLiveState, input.currentState),
  };
}

async function createPermissionResolvedEvent(input: {
  outcome?: PermissionDecision;
  requestId: string;
  runId: SessionRunId;
  sessionId: SessionId;
}): Promise<RuntimeEventEnvelope> {
  return createSessionRuntimeEvent({
    actor: "user",
    kind: "permission.resolved",
    origin: "viewer",
    payload: {
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      requestId: input.requestId,
    },
    runId: input.runId,
    sessionId: input.sessionId,
  });
}

export async function resolveSessionPermissionDecision(
  input: ResolveSessionPermissionDecisionInput,
): Promise<SessionPermissionStateUpdate | null> {
  await ensureProjectSessionParticipantAccess(input.bindings.DB, input.viewer.id, {
    projectId: input.projectId,
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
    projectId: input.projectId,
    requestId: input.requestId,
    runId: parsePlatformId<SessionRunId>(request.runId, "permission request run id"),
    sessionId: input.sessionId,
  });

  const runId = parsePlatformId<SessionRunId>(request.runId, "permission request run id");

  return createPermissionStateUpdate({
    currentState,
    events: [
      await createPermissionResolvedEvent({
        outcome: input.decision,
        requestId: input.requestId,
        runId,
        sessionId: input.sessionId,
      }),
    ],
  });
}

export async function rejectSessionPermissionRequests(
  input: RejectSessionPermissionRequestsInput,
): Promise<SessionPermissionStateUpdate | null> {
  await ensureProjectSessionParticipantAccess(input.bindings.DB, input.viewer.id, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  const currentState = await loadCurrentPermissionState(input);

  if (currentState.permissionRequests.length === 0) {
    return null;
  }

  const cleanupResults = await runOrderedAsyncTasks(
    currentState.permissionRequests.map((request) => async () => {
      try {
        await resolvePermissionRequest(input.bindings, input.viewer, {
          decision: "reject_once",
          driverInstanceId: requirePermissionRequestDriverInstanceId(request),
          projectId: input.projectId,
          requestId: request.requestId,
          runId: parsePlatformId<SessionRunId>(request.runId, "permission request run id"),
          sessionId: input.sessionId,
        });
        return { rejected: true, request };
      } catch (error) {
        input.onPermissionCleanupError(error, request.requestId);
        return { rejected: false, request };
      }
    }),
  );

  const rejectedRequests = cleanupResults.flatMap((result) =>
    result.rejected ? [result.request] : [],
  );

  if (rejectedRequests.length === 0) {
    return null;
  }

  return createPermissionStateUpdate({
    currentState,
    events: await Promise.all(
      rejectedRequests.map((request) =>
        createPermissionResolvedEvent({
          outcome: "reject_once",
          requestId: request.requestId,
          runId: parsePlatformId<SessionRunId>(request.runId, "permission request run id"),
          sessionId: input.sessionId,
        }),
      ),
    ),
  });
}
