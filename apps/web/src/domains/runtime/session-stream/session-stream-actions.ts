import { createViewerCustomEvent, isSessionLiveStateStreaming } from "@mosoo/ag-ui-session";
import type {
  SessionLiveState,
  SessionPermissionRequestView,
  SessionRunView,
} from "@mosoo/ag-ui-session";
import { useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";

import { toFileIds, toNullableSessionRunId, toSessionId } from "../../../routes/typed-id";
import { isTruthy } from "../../../shared/lib/truthiness";
import { sendAgentSessionEvents } from "../../session/api/agent-session";
import type { SendViewerEventOptions, SessionStreamEventSender } from "./session-stream-socket";

function createEmptyRunState(): SessionRunView {
  return {
    completedAt: null,
    error: null,
    id: null,
    startedAt: null,
    status: "idle",
    traceId: null,
  };
}

export function isSessionStreamStreaming(
  liveState: Pick<SessionLiveState, "lifecycle"> | null,
): boolean {
  return isSessionLiveStateStreaming(liveState);
}

interface UseSessionStreamActionsInput {
  activeSessionIdRef: MutableRefObject<string | null>;
  liveState: SessionLiveState | null;
  sendViewerEvent: SessionStreamEventSender;
}

export function useSessionStreamActions(input: UseSessionStreamActionsInput): {
  messages: SessionLiveState["messages"];
  lifecycle: SessionLiveState["lifecycle"];
  permissionRequests: SessionPermissionRequestView[];
  planEntries: SessionLiveState["plan"];
  readiness: SessionLiveState["readiness"];
  reconnecting: boolean;
  run: SessionRunView;
  sendPermissionDecision: (input: {
    decision: "allow_once" | "reject_once";
    requestId: string;
    sessionId: string;
  }) => Promise<void>;
  sendUserInterrupt: (input: { runId?: string | null; sessionId: string }) => Promise<void>;
  sendUserMessage: (input: {
    attachmentIds?: string[];
    clientRequestId: string;
    sessionId: string;
    text: string;
  }) => Promise<void>;
  sessionFiles: SessionLiveState["files"];
  sessionTitle: string | null;
  streaming: boolean;
  syncSession: () => Promise<void>;
} {
  const syncSession = useCallback(async (): Promise<void> => {
    const activeSessionId = input.activeSessionIdRef.current;

    if (!isTruthy(activeSessionId)) {
      return;
    }

    const options: SendViewerEventOptions = { maxAttempts: 2 };
    await input.sendViewerEvent(
      activeSessionId,
      createViewerCustomEvent("mosoo.session.sync.request", {
        reason: "manual",
      }),
      options,
    );
  }, [input.activeSessionIdRef, input.sendViewerEvent]);
  const sendUserMessage = useCallback(
    async (message: {
      attachmentIds?: string[];
      clientRequestId: string;
      sessionId: string;
      text: string;
    }): Promise<void> => {
      await sendAgentSessionEvents({
        events: [
          {
            attachmentIds: toFileIds(message.attachmentIds ?? []),
            clientRequestId: message.clientRequestId,
            text: message.text,
            type: "user_message",
          },
        ],
        sessionId: toSessionId(message.sessionId),
      });
    },
    [],
  );
  const sendPermissionDecision = useCallback(
    async (decision: {
      decision: "allow_once" | "reject_once";
      requestId: string;
      sessionId: string;
    }): Promise<void> => {
      await sendAgentSessionEvents({
        events: [
          {
            decision: decision.decision,
            requestId: decision.requestId,
            type: "permission_decision",
          },
        ],
        sessionId: toSessionId(decision.sessionId),
      });
    },
    [],
  );
  const sendUserInterrupt = useCallback(
    async (interrupt: { runId?: string | null; sessionId: string }): Promise<void> => {
      await sendAgentSessionEvents({
        events: [
          {
            runId: toNullableSessionRunId(interrupt.runId),
            type: "user_interrupt",
          },
        ],
        sessionId: toSessionId(interrupt.sessionId),
      });
    },
    [],
  );

  const messages = useMemo(() => input.liveState?.messages ?? [], [input.liveState]);
  const permissionRequests = useMemo(
    () => input.liveState?.permissionRequests ?? [],
    [input.liveState],
  );
  const planEntries = useMemo(() => input.liveState?.plan ?? [], [input.liveState]);
  const readiness = useMemo(() => input.liveState?.readiness ?? null, [input.liveState]);
  const reconnecting = useMemo(
    () => input.liveState?.infra.reconnecting ?? false,
    [input.liveState],
  );
  const sessionFiles = useMemo(() => input.liveState?.files ?? [], [input.liveState]);
  const streaming = useMemo(() => isSessionStreamStreaming(input.liveState), [input.liveState]);

  return {
    lifecycle: input.liveState?.lifecycle ?? "IDLE",
    messages,
    permissionRequests,
    planEntries,
    readiness,
    reconnecting,
    run: input.liveState?.run ?? createEmptyRunState(),
    sendPermissionDecision,
    sendUserInterrupt,
    sendUserMessage,
    sessionFiles,
    sessionTitle: input.liveState?.title ?? null,
    streaming,
    syncSession,
  };
}
