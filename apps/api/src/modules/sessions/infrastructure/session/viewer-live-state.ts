import type { SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { reconcileStaleActiveSessionRun } from "../../../runtime/application/session-runs/stale-run-reconciliation.service";
import { loadSessionAgentTaskState } from "../session-agent-task-snapshot.repository";
import type { SessionLiveState } from "../session-live-state.types";
import { loadSessionViewerState } from "../session-viewer-live-snapshot.repository";

interface LoadViewerLiveStateInput {
  cachedState: SessionLiveState | null;
  database: D1Database;
  reconciledStaleRun?: boolean;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

export async function loadViewerLiveState(
  input: LoadViewerLiveStateInput,
): Promise<SessionLiveState> {
  const reconciledStaleRun =
    input.reconciledStaleRun ??
    (await reconcileStaleActiveSessionRun(input.database, input.sessionId));

  if (input.cachedState && !reconciledStaleRun) {
    const taskState = await loadSessionAgentTaskState(input.database, input.sessionId);
    const cacheGenerationIsCurrent =
      taskState !== null &&
      input.cachedState.lifecycle === "RUNNING" &&
      taskState.runId === input.cachedState.run.id &&
      taskState.runStatus === input.cachedState.run.status &&
      taskState.driverInstanceId === input.cachedState.infra.driverInstanceId;

    if (cacheGenerationIsCurrent) {
      return normalizeViewerLiveState(
        { ...input.cachedState, taskSnapshot: taskState.snapshot },
        input,
      );
    }
  }

  return loadSessionViewerState(input.database, {
    sessionId: input.sessionId,
    viewerId: input.viewer.id,
  });
}

function normalizeViewerLiveState(
  state: SessionLiveState,
  input: Pick<LoadViewerLiveStateInput, "sessionId" | "viewer">,
): SessionLiveState {
  return {
    ...state,
    sessionId: input.sessionId,
    viewerId: input.viewer.id,
  };
}
