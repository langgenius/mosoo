import { createStateSnapshotEvent } from "@mosoo/ag-ui-session";

import {
  closeOpenSocket,
  sendFrames,
} from "../../../../platform/cloudflare/durable-object-support";
import { requireActiveProjectSession } from "../../domain/session-access.policy";
import { loadSessionViewerState } from "../session-viewer-live-snapshot.repository";
import type { SessionViewerSocketContext } from "./socket-headers";

export async function sendViewerSocketStateSync(
  database: D1Database,
  attachment: SessionViewerSocketContext,
  socket: WebSocket,
  getReplayFrames: () => readonly string[],
): Promise<void> {
  try {
    await requireActiveProjectSession(database, attachment.viewer.id, {
      projectId: attachment.projectId,
      sessionId: attachment.sessionId,
    });
  } catch {
    closeOpenSocket(socket, 1008, "session.viewer.session.inactive");
    return;
  }

  while (socket.readyState === WebSocket.OPEN) {
    const replayFrames = getReplayFrames();
    const state = await loadSessionViewerState(database, {
      sessionId: attachment.sessionId,
      viewerId: attachment.viewer.id,
    });
    // A replaced buffer means frames were discarded while the snapshot loaded.
    if (replayFrames !== getReplayFrames()) continue;
    sendFrames(socket, [JSON.stringify(createStateSnapshotEvent(state)), ...replayFrames]);
    return;
  }
}
