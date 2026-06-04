import {
  applyAgUiEventsToSessionLiveState,
  createInitialSessionLiveState,
  createServerCustomEvent,
  createViewerCustomEvent,
  parseAgUiSessionEventJson,
} from "@mosoo/ag-ui-session";
import type {
  AgUiSessionEvent,
  SessionLiveState,
  MosooViewerCustomEvent,
} from "@mosoo/ag-ui-session";
import { createPromiseDeferred, ignorePromiseRejection } from "@mosoo/effects";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { isTruthy } from "../../../shared/lib/truthiness";
import { SessionStreamRenderScheduler } from "./session-stream-render-scheduler";
export interface SendViewerEventOptions {
  maxAttempts?: number;
}

export type SessionStreamEventSender = (
  targetSessionId: string,
  event: MosooViewerCustomEvent,
  options?: SendViewerEventOptions,
) => Promise<void>;

interface SocketController {
  manuallyClosed: boolean;
  openPromise: Promise<WebSocket>;
  rejectOpen: (error: Error) => void;
  resolveOpen: (socket: WebSocket) => void;
  sessionId: string;
  socket: WebSocket;
}

interface SessionStreamSnapshot {
  readonly hydrated: boolean;
  readonly liveState: SessionLiveState | null;
  readonly sessionId: string | null;
}

function buildSessionSocketUrl(sessionId: string): string {
  const url = new URL(`/api/ag-ui/session/${sessionId}/ws`, globalThis.location.origin);
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

export function useSessionStreamSocket(sessionId: string | null): {
  activeSessionIdRef: MutableRefObject<string | null>;
  hydrated: boolean;
  liveState: SessionLiveState | null;
  sendViewerEvent: SessionStreamEventSender;
} {
  const [snapshot, setSnapshot] = useState<SessionStreamSnapshot>(() =>
    createSessionStreamSnapshot(sessionId),
  );
  const activeSessionIdRef = useRef<string | null>(sessionId);
  const liveStateRef = useRef<SessionLiveState | null>(snapshot.liveState);
  const renderSchedulerRef = useRef<SessionStreamRenderScheduler | null>(null);
  const socketRef = useRef<SocketController | null>(null);

  activeSessionIdRef.current = sessionId;

  let scopedSnapshot = snapshot;

  if (snapshot.sessionId !== sessionId) {
    scopedSnapshot = createSessionStreamSnapshot(sessionId);
    liveStateRef.current = scopedSnapshot.liveState;
    setSnapshot(scopedSnapshot);
  }

  const applyScheduledEvents = useCallback(
    (targetSessionId: string, queuedEvents: AgUiSessionEvent[]): boolean => {
      if (queuedEvents.length === 0 || activeSessionIdRef.current !== targetSessionId) {
        return false;
      }

      setSnapshot((currentSnapshot) => {
        const baseState =
          currentSnapshot.liveState ??
          liveStateRef.current ??
          createEmptyLiveState(targetSessionId);
        const nextState = applyAgUiEventsToSessionLiveState(baseState, queuedEvents);
        liveStateRef.current = nextState;
        return {
          hydrated: true,
          liveState: nextState,
          sessionId: targetSessionId,
        };
      });
      return true;
    },
    [],
  );

  const queueSocketEvents = useCallback(
    (targetSessionId: string, events: AgUiSessionEvent[]) => {
      if (events.length === 0) {
        return;
      }

      renderSchedulerRef.current ??= new SessionStreamRenderScheduler(applyScheduledEvents);
      renderSchedulerRef.current.enqueueMany(targetSessionId, events);
    },
    [applyScheduledEvents],
  );

  const closeSocket = useCallback((reason: string) => {
    const { current } = socketRef;

    if (!current) {
      return;
    }

    socketRef.current = null;
    current.manuallyClosed = true;
    current.rejectOpen(new Error(reason));

    if (activeSessionIdRef.current === current.sessionId) {
      renderSchedulerRef.current?.flushNow(current.sessionId);
    } else {
      renderSchedulerRef.current?.clear();
    }

    if (
      current.socket.readyState === WebSocket.CONNECTING ||
      current.socket.readyState === WebSocket.OPEN
    ) {
      current.socket.close(1000, reason);
    }
  }, []);

  const connectToSession = useCallback(
    async (targetSessionId: string): Promise<WebSocket> => {
      const { current } = socketRef;

      if (current?.sessionId === targetSessionId) {
        if (current.socket.readyState === WebSocket.OPEN) {
          return current.socket;
        }

        return current.openPromise;
      }

      closeSocket("session.changed");

      const openDeferred = createPromiseDeferred<WebSocket>();
      const socket = new WebSocket(buildSessionSocketUrl(targetSessionId));

      const controller: SocketController = {
        manuallyClosed: false,
        openPromise: openDeferred.promise,
        rejectOpen: openDeferred.reject,
        resolveOpen: openDeferred.resolve,
        sessionId: targetSessionId,
        socket,
      };

      socketRef.current = controller;

      socket.addEventListener("open", () => {
        if (socketRef.current !== controller) {
          return;
        }

        if (liveStateRef.current?.infra.reconnecting === true) {
          queueSocketEvents(targetSessionId, [
            createServerCustomEvent("mosoo.session.infra.running", {
              resumedAt: new Date().toISOString(),
            }),
          ]);
        }

        controller.resolveOpen(socket);
      });

      socket.addEventListener("message", (messageEvent) => {
        if (socketRef.current !== controller || typeof messageEvent.data !== "string") {
          return;
        }

        try {
          const event = parseAgUiSessionEventJson(messageEvent.data);
          queueSocketEvents(targetSessionId, [event]);
        } catch {
          /* Ignore malformed server events. */
        }
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === controller) {
          socketRef.current = null;
        }

        if (activeSessionIdRef.current === targetSessionId) {
          renderSchedulerRef.current?.flushNow(targetSessionId);
        }

        controller.rejectOpen(new Error("Session websocket closed."));

        if (!controller.manuallyClosed && activeSessionIdRef.current === targetSessionId) {
          queueSocketEvents(targetSessionId, [
            createServerCustomEvent("mosoo.session.infra.rescheduling", {
              lastSeen: new Date().toISOString(),
              reason: "websocket.closed",
              rescheduleStartedAt: new Date().toISOString(),
            }),
          ]);
          globalThis.setTimeout(() => {
            if (activeSessionIdRef.current !== targetSessionId) {
              return;
            }

            void connectToSession(targetSessionId).then((nextSocket) => {
              nextSocket.send(
                JSON.stringify(
                  createViewerCustomEvent("mosoo.session.sync.request", {
                    reason: "reconnect",
                  }),
                ),
              );
            });
          }, 350);
        }
      });

      socket.addEventListener("error", () => {
        if (socketRef.current !== controller) {
          return;
        }

        controller.rejectOpen(new Error("Session websocket failed."));
      });

      return controller.openPromise;
    },
    [closeSocket, queueSocketEvents],
  );

  const sendViewerEvent = useCallback<SessionStreamEventSender>(
    async (targetSessionId, event, options) => {
      const maxAttempts = options?.maxAttempts ?? 1;

      async function sendAttempt(attempt: number): Promise<void> {
        try {
          const socket = await connectToSession(targetSessionId);

          if (socket.readyState !== WebSocket.OPEN) {
            throw new Error("Session websocket is not open.");
          }

          socket.send(JSON.stringify(event));
          return;
        } catch (error) {
          const lastError =
            error instanceof Error ? error : new Error("Session websocket send failed.");

          const { current } = socketRef;

          if (current?.sessionId === targetSessionId) {
            closeSocket("session.retry");
          }

          if (attempt === maxAttempts - 1 && activeSessionIdRef.current === targetSessionId) {
            void connectToSession(targetSessionId).catch(ignorePromiseRejection);
          }

          if (attempt >= maxAttempts - 1) {
            throw lastError;
          }

          await sendAttempt(attempt + 1);
        }
      }

      await sendAttempt(0);
    },
    [closeSocket, connectToSession],
  );

  useEffect(() => {
    if (!isTruthy(sessionId)) {
      closeSocket("session.cleared");
      return;
    }

    void connectToSession(sessionId).catch(ignorePromiseRejection);

    return () => {
      closeSocket("session.effect.cleanup");
    };
  }, [closeSocket, connectToSession, sessionId]);

  useEffect(() => {
    liveStateRef.current = scopedSnapshot.liveState;
  }, [scopedSnapshot.liveState]);

  return {
    activeSessionIdRef,
    hydrated: scopedSnapshot.hydrated,
    liveState: scopedSnapshot.liveState,
    sendViewerEvent,
  };
}
