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

  const state = await loadSessionViewerState(database, {
    sessionId: attachment.sessionId,
    viewerId: attachment.viewer.id,
  });
  // Read after the load: frames broadcast meanwhile are re-applied on top of
  // the snapshot that replaces the viewer's state.
  sendFrames(socket, [JSON.stringify(createStateSnapshotEvent(state)), ...getReplayFrames()]);
}
