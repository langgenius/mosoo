import { createStateSnapshotEvent, serializeAgUiSessionEvents } from "@mosoo/ag-ui-session";
import type { SessionId } from "@mosoo/id";

import {
  closeOpenSocket,
  sendFrames,
} from "../../../../platform/cloudflare/durable-object-support";
import { reconcileStaleActiveSessionRun } from "../../../runtime/application/session-runs/stale-run-reconciliation.service";
import { getActiveProjectSessionParticipantAccess } from "../../domain/session-access.policy";
import type { SessionLiveState } from "../session-live-state.types";
import { loadSessionViewerStateSnapshot } from "../session-viewer-live-snapshot.repository";
import type { ViewerSocketAttachment } from "./viewer-socket";

interface SendViewerSocketStateSyncOptions {
  attachment: ViewerSocketAttachment;
  database: D1Database;
  updateLiveStateCache(state: SessionLiveState | null): void;
  ws: WebSocket;
}

interface ViewerSocketStateSyncTarget {
  attachment: ViewerSocketAttachment;
  socket: WebSocket;
}

interface SendViewerSocketStateSyncBatchOptions {
  database: D1Database;
  sockets: ViewerSocketStateSyncTarget[];
  updateLiveStateCache(state: SessionLiveState | null): void;
}

export async function ensureViewerSocketSessionActive(
  database: D1Database,
  attachment: ViewerSocketAttachment,
): Promise<void> {
  await getActiveProjectSessionParticipantAccess(database, attachment.viewer.id, {
    projectId: attachment.projectId,
    sessionId: attachment.sessionId,
  });
}

export function closeInactiveViewerSocket(ws: WebSocket): void {
  closeOpenSocket(ws, 1008, "session.viewer.session.inactive");
}

export function isKnownInactiveViewerSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "Viewer session is inactive.";
  return message === "Session not found." || message === "Session is archived.";
}

export async function sendViewerSocketStateSync(
  options: SendViewerSocketStateSyncOptions,
): Promise<void> {
  await sendViewerSocketStateSyncBatch({
    database: options.database,
    sockets: [
      {
        attachment: options.attachment,
        socket: options.ws,
      },
    ],
    updateLiveStateCache: options.updateLiveStateCache,
  });
}

export async function sendViewerSocketStateSyncBatch(
  options: SendViewerSocketStateSyncBatchOptions,
): Promise<void> {
  const groupedTargets = groupOpenViewerSockets(options.sockets);
  const reconciledStaleRunsBySessionId = new Map<SessionId, boolean>();

  for (const targets of groupedTargets.values()) {
    const [firstTarget] = targets;

    if (!firstTarget) {
      continue;
    }

    try {
      await ensureViewerSocketSessionActive(options.database, firstTarget.attachment);
    } catch (error) {
      for (const target of targets) {
        closeInactiveViewerSocket(target.socket);
      }

      if (isKnownInactiveViewerSessionError(error)) {
        continue;
      }

      throw error;
    }

    await getReconciledStaleRun(
      options.database,
      firstTarget.attachment.sessionId,
      reconciledStaleRunsBySessionId,
    );
    const snapshot = await loadSessionViewerStateSnapshot(options.database, {
      sessionId: firstTarget.attachment.sessionId,
      viewerId: firstTarget.attachment.viewer.id,
    });
    const stateToSend = snapshot.state;
    const frames = createStateSyncFrames(stateToSend);

    options.updateLiveStateCache(stateToSend);

    for (const target of targets) {
      try {
        sendFrames(target.socket, frames);
        target.socket.serializeAttachment({
          ...target.attachment,
          runtimeEventSeqCursor: snapshot.runtimeEventSeqCursor,
        } satisfies ViewerSocketAttachment);
      } catch {
        closeOpenSocket(target.socket, 1011, "session.viewer.state-sync-failed");
      }
    }
  }
}

async function getReconciledStaleRun(
  database: D1Database,
  sessionId: SessionId,
  cache: Map<SessionId, boolean>,
): Promise<boolean> {
  const cached = cache.get(sessionId);

  if (cached !== undefined) {
    return cached;
  }

  const reconciled = await reconcileStaleActiveSessionRun(database, sessionId);

  cache.set(sessionId, reconciled);
  return reconciled;
}

function createStateSyncFrames(state: SessionLiveState): string[] {
  return serializeAgUiSessionEvents([createStateSnapshotEvent(state)]);
}

function groupOpenViewerSockets(
  sockets: ViewerSocketStateSyncTarget[],
): Map<string, ViewerSocketStateSyncTarget[]> {
  const targetsByViewer = new Map<string, ViewerSocketStateSyncTarget[]>();

  for (const target of sockets) {
    if (target.socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    const key = `${target.attachment.sessionId}:${target.attachment.viewer.id}`;
    const targets = targetsByViewer.get(key);

    if (targets) {
      targets.push(target);
      continue;
    }

    targetsByViewer.set(key, [target]);
  }

  return targetsByViewer;
}
