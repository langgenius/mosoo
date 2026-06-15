import type { SessionPermissionRequestView, SessionViewMessage } from "@mosoo/ag-ui-session";

import { useSessionStreamActions } from "./session-stream/session-stream-actions";
import { useSessionStreamSocket } from "./session-stream/session-stream-socket";

export type ChatMessage = SessionViewMessage;
export type PermissionRequest = SessionPermissionRequestView;

export function useSessionStream(appId: string | null, sessionId: string | null) {
  const socket = useSessionStreamSocket(appId, sessionId);
  const actions = useSessionStreamActions({
    activeSessionIdRef: socket.activeSessionIdRef,
    liveState: socket.liveState,
    appId,
    sendViewerEvent: socket.sendViewerEvent,
  });

  return {
    hydrated: socket.hydrated,
    ...actions,
  };
}
