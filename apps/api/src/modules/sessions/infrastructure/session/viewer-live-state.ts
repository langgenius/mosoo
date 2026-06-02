import type { SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { reconcileStaleActiveSessionRun } from "../../../runtime/application/session-runs/stale-run-reconciliation.service";
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
    return normalizeViewerLiveState(input.cachedState, input);
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
