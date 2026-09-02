import type { SessionPermissionRequestView, SessionViewMessage } from "@mosoo/ag-ui-session";

import { useSessionStreamActions } from "./session-stream/session-stream-actions";
import { useSessionStreamSocket } from "./session-stream/session-stream-socket";

export type ChatMessage = SessionViewMessage;
export type PermissionRequest = SessionPermissionRequestView;

export function useSessionStream(projectId: string | null, sessionId: string | null) {
  const socket = useSessionStreamSocket(projectId, sessionId);
  const actions = useSessionStreamActions({
    activeSessionIdRef: socket.activeSessionIdRef,
    liveState: socket.liveState,
    projectId,
    sendViewerEvent: socket.sendViewerEvent,
  });

  return {
    hydrated: socket.hydrated,
    ...actions,
  };
}
