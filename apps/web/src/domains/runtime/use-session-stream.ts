import { isSessionLiveStateStreaming } from "@mosoo/ag-ui-session";
import type { SessionLiveState, SessionRunView } from "@mosoo/ag-ui-session";
import type { AgentSessionEventInput } from "@mosoo/contracts/session";
import { useCallback } from "react";

import { toFileIds, toNullableSessionRunId, toProjectId, toSessionId } from "../../routes/typed-id";
import { sendAgentSessionEvents } from "../session/api/agent-session";
import { useSessionStreamSocket } from "./session-stream/session-stream-socket";

const NO_MESSAGES: SessionLiveState["messages"] = [];
const IDLE_RUN: SessionRunView = {
  completedAt: null,
  error: null,
  id: null,
  startedAt: null,
  status: "idle",
  traceId: null,
};

export function useSessionStream(projectId: string | null, sessionId: string | null) {
  const { hydrated, liveState } = useSessionStreamSocket(projectId, sessionId);
  const sendEvents = useCallback(
    async (targetSessionId: string, events: AgentSessionEventInput[]): Promise<void> => {
      if (projectId === null) {
        throw new Error("Project id is required to send session events.");
      }

      await sendAgentSessionEvents({
        events,
        projectId: toProjectId(projectId),
        sessionId: toSessionId(targetSessionId),
      });
    },
    [projectId],
  );
  const sendUserMessage = useCallback(
    async (message: {
      attachmentIds?: string[];
      clientRequestId: string;
      sessionId: string;
      text: string;
    }): Promise<void> => {
      await sendEvents(message.sessionId, [
        {
          attachmentIds: toFileIds(message.attachmentIds ?? []),
          clientRequestId: message.clientRequestId,
          text: message.text,
          type: "user_message",
        },
      ]);
    },
    [sendEvents],
  );
  const sendUserInterrupt = useCallback(
    async (interrupt: { runId?: string | null; sessionId: string }): Promise<void> => {
      await sendEvents(interrupt.sessionId, [
        {
          runId: toNullableSessionRunId(interrupt.runId),
          type: "user_interrupt",
        },
      ]);
    },
    [sendEvents],
  );

  return {
    hydrated,
    lifecycle: liveState?.lifecycle ?? "IDLE",
    messages: liveState?.messages ?? NO_MESSAGES,
    reconnecting: liveState?.infra.reconnecting ?? false,
    run: liveState?.run ?? IDLE_RUN,
    sendUserInterrupt,
    sendUserMessage,
    streaming: isSessionLiveStateStreaming(liveState),
  };
}
