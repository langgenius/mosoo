import {
  applyAgUiEventsToSessionLiveState,
  createInitialSessionLiveState,
  createServerCustomEvent,
} from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent, SessionLiveState } from "@mosoo/ag-ui-session";
import { useCallback, useEffect, useRef, useState } from "react";

import { isTruthy } from "../../../shared/lib/truthiness";
import { SessionStreamRenderScheduler } from "./session-stream-render-scheduler";

interface SocketController {
  manuallyClosed: boolean;
  scheduler: SessionStreamRenderScheduler;
  sessionId: string;
  socket: WebSocket;
}

interface SessionStreamSnapshot {
  readonly hydrated: boolean;
  readonly liveState: SessionLiveState | null;
  readonly sessionId: string | null;
}

function buildSessionSocketUrl(projectId: string, sessionId: string): string {
  const url = new URL(`/api/ag-ui/session/${sessionId}/ws`, globalThis.location.origin);
  url.searchParams.set("projectId", projectId);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function createEmptyLiveState(sessionId: string): SessionLiveState {
  return createInitialSessionLiveState({
    sessionId,
    title: null,
    viewerId: "",
  });
}

function createSessionStreamSnapshot(sessionId: string | null): SessionStreamSnapshot {
  return {
    hydrated: false,
    liveState: isTruthy(sessionId) ? createEmptyLiveState(sessionId) : null,
    sessionId,
  };
}

export function useSessionStreamSocket(
  projectId: string | null,
  sessionId: string | null,
): {
  hydrated: boolean;
  liveState: SessionLiveState | null;
} {
  const [snapshot, setSnapshot] = useState<SessionStreamSnapshot>(() =>
    createSessionStreamSnapshot(sessionId),
  );
  const activeSessionIdRef = useRef<string | null>(sessionId);
  const liveStateRef = useRef<SessionLiveState | null>(snapshot.liveState);
  const socketRef = useRef<SocketController | null>(null);

  activeSessionIdRef.current = sessionId;

  let scopedSnapshot = snapshot;

  if (snapshot.sessionId !== sessionId) {
    scopedSnapshot = createSessionStreamSnapshot(sessionId);
    liveStateRef.current = scopedSnapshot.liveState;
    setSnapshot(scopedSnapshot);
  }

  const applyEvents = useCallback((targetSessionId: string, events: AgUiSessionEvent[]) => {
    if (activeSessionIdRef.current !== targetSessionId) {
      return;
    }

    setSnapshot((currentSnapshot) => {
      const baseState =
        currentSnapshot.liveState ?? liveStateRef.current ?? createEmptyLiveState(targetSessionId);
      const nextState = applyAgUiEventsToSessionLiveState(baseState, events);
      liveStateRef.current = nextState;
      return {
        hydrated: true,
        liveState: nextState,
        sessionId: targetSessionId,
      };
    });
  }, []);

  const closeSocket = useCallback((reason: string) => {
    const { current } = socketRef;

    if (!current) {
      return;
    }

    socketRef.current = null;
    current.manuallyClosed = true;

    if (activeSessionIdRef.current === current.sessionId) {
      current.scheduler.flushNow();
    } else {
      current.scheduler.clear();
    }

    if (
      current.socket.readyState === WebSocket.CONNECTING ||
      current.socket.readyState === WebSocket.OPEN
    ) {
      current.socket.close(1000, reason);
    }
  }, []);

  const connectToSession = useCallback(
    (targetProjectId: string, targetSessionId: string): void => {
      if (socketRef.current?.sessionId === targetSessionId) {
        return;
      }

      closeSocket("session.changed");

      const socket = new WebSocket(buildSessionSocketUrl(targetProjectId, targetSessionId));
      const controller: SocketController = {
        manuallyClosed: false,
        scheduler: new SessionStreamRenderScheduler((events) => {
          applyEvents(targetSessionId, events);
        }),
        sessionId: targetSessionId,
        socket,
      };

      socketRef.current = controller;

      socket.addEventListener("open", () => {
        if (socketRef.current !== controller) {
          return;
        }

        if (liveStateRef.current?.infra.reconnecting === true) {
          controller.scheduler.enqueueMany([
            createServerCustomEvent("mosoo.session.infra.running", {
              resumedAt: new Date().toISOString(),
            }),
          ]);
        }
      });

      socket.addEventListener("message", (messageEvent) => {
        if (socketRef.current !== controller || typeof messageEvent.data !== "string") {
          return;
        }

        controller.scheduler.enqueueMany([JSON.parse(messageEvent.data) as AgUiSessionEvent]);
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === controller) {
          socketRef.current = null;
        }

        if (activeSessionIdRef.current === targetSessionId) {
          controller.scheduler.flushNow();
        }

        if (!controller.manuallyClosed && activeSessionIdRef.current === targetSessionId) {
          controller.scheduler.enqueueMany([
            createServerCustomEvent("mosoo.session.infra.rescheduling", {
              lastSeen: new Date().toISOString(),
              reason: "websocket.closed",
              rescheduleStartedAt: new Date().toISOString(),
            }),
          ]);
          globalThis.setTimeout(() => {
            if (activeSessionIdRef.current === targetSessionId) {
              connectToSession(targetProjectId, targetSessionId);
            }
          }, 350);
        }
      });
    },
    [applyEvents, closeSocket],
  );

  useEffect(() => {
    if (!isTruthy(projectId) || !isTruthy(sessionId)) {
      closeSocket("session.cleared");
      return;
    }

    connectToSession(projectId, sessionId);

    return () => {
      closeSocket("session.effect.cleanup");
    };
  }, [closeSocket, connectToSession, projectId, sessionId]);

  useEffect(() => {
    liveStateRef.current = scopedSnapshot.liveState;
  }, [scopedSnapshot.liveState]);

  return {
    hydrated: scopedSnapshot.hydrated,
    liveState: scopedSnapshot.liveState,
  };
}
