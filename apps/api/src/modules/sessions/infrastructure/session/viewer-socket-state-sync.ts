import { createStateSnapshotEvent, serializeAgUiSessionEvents } from "@mosoo/ag-ui-session";
import type { SessionId } from "@mosoo/id";

import {
  closeOpenSocket,
  sendFrames,
} from "../../../../platform/cloudflare/durable-object-support";
import { reconcileStaleActiveSessionRun } from "../../../runtime/application/session-runs/stale-run-reconciliation.service";
import { ensureActiveSessionParticipantAccess } from "../../domain/session-access.policy";
import type { SessionLiveState } from "../session-live-state.types";
import { loadViewerLiveState } from "./viewer-live-state";
import type { ViewerSocketAttachment } from "./viewer-socket";

interface SendViewerSocketStateSyncOptions {
  attachment: ViewerSocketAttachment;
  cachedState: SessionLiveState | null;
  database: D1Database;
  getLatestCachedState(): SessionLiveState | null;
  updateLiveStateCache(state: SessionLiveState | null): void;
  ws: WebSocket;
}

interface ViewerSocketStateSyncTarget {
  attachment: ViewerSocketAttachment;
  socket: WebSocket;
}

interface SendViewerSocketStateSyncBatchOptions {
  cachedState: SessionLiveState | null;
  database: D1Database;
  getLatestCachedState(): SessionLiveState | null;
  sockets: ViewerSocketStateSyncTarget[];
  updateLiveStateCache(state: SessionLiveState | null): void;
}

export async function ensureViewerSocketSessionActive(
  database: D1Database,
  attachment: ViewerSocketAttachment,
): Promise<void> {
  await ensureActiveSessionParticipantAccess(database, attachment.viewer.id, attachment.sessionId);
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
    cachedState: options.cachedState,
    database: options.database,
    getLatestCachedState: options.getLatestCachedState,
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
  let cachedState = options.cachedState;
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

    cachedState ??= options.getLatestCachedState();
    const reconciledStaleRun = await getReconciledStaleRun(
      options.database,
      firstTarget.attachment.sessionId,
      reconciledStaleRunsBySessionId,
    );
    const state = await loadViewerLiveState({
      cachedState,
      database: options.database,
      reconciledStaleRun,
      sessionId: firstTarget.attachment.sessionId,
      viewer: firstTarget.attachment.viewer,
    });
    const latestState = options.getLatestCachedState();
    const stateToSend = latestState !== null && latestState !== cachedState ? latestState : state;
    const frames = createStateSyncFrames(stateToSend);

    options.updateLiveStateCache(stateToSend);
    cachedState = stateToSend;

    for (const target of targets) {
      sendFrames(target.socket, frames);
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
