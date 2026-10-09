import { createLiveStateMessage } from "@mosoo/ag-ui-session";
import type { SessionViewMessage } from "@mosoo/ag-ui-session";
import { ignorePromiseRejection } from "@mosoo/effects";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { useSessionStream } from "@/domains/runtime/use-session-stream";
import {
  createAgentSession,
  listAgentSessions,
  triggerAgentSessionPrewarm,
} from "@/domains/session/api/agent-session";
import { deleteAgentSession } from "@/domains/session/api/mutations";
import { createSessionResourceMentionMessagePayload } from "@/features/session-chat/session-resource-mentions";
import { toAgentId, toProjectId, toSessionId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";

import type {
  AgentSessionPanelModel,
  ComposerError,
  SendOptions,
  UseAgentSessionPanelModelInput,
} from "./agent-session-panel-model-types";
import {
  getReadinessBlockMessage,
  hasStaleSessionConfiguration,
  isComposerSendBlocked,
  shouldSpeculativelyCreateSessionOnTyping,
} from "./agent-session-panel-rules";

const SPECULATIVE_CREATE_FAILURE_COOLDOWN_MS = 30_000;

/** A send in flight: its user message and the user messages the transcript held before it. */
interface PendingSend {
  readonly message: SessionViewMessage;
  readonly userMessageCount: number;
}

function countUserMessages(messages: readonly SessionViewMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}

/**
 * Shows the message of a send in flight like a sent user message until the
 * server echo lands, which is the transcript gaining a user message.
 */
export function withPendingSend(
  messages: SessionViewMessage[],
  pendingSend: PendingSend | null,
): SessionViewMessage[] {
  if (pendingSend === null || countUserMessages(messages) > pendingSend.userMessageCount) {
    return messages;
  }

  return [...messages, pendingSend.message];
}

export function getResetSessionIds(input: {
  readonly activeSessionId: string | null;
  readonly sessions: readonly { readonly id: string }[];
}): string[] {
  const sessionIds = new Set(input.sessions.map((session) => session.id));

  if (input.activeSessionId !== null) {
    sessionIds.add(input.activeSessionId);
  }

  return [...sessionIds];
}

export function useAgentSessionPanelModel(
  input: UseAgentSessionPanelModelInput,
): AgentSessionPanelModel {
  const { t } = useTranslation();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null | undefined>();
  const [composerError, setComposerError] = useState<ComposerError | null>(null);
  const [sending, setSending] = useState(false);
  // Set only while handleSend is in flight; the send's own finally clears it.
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const sessionCreatePromiseRef = useRef<Promise<string> | null>(null);
  const unlistedCreatedSessionIdRef = useRef<string | null>(null);
  // Bumped by reset/retry so an in-flight create that they superseded cannot
  // re-select its (now orphaned) session when it resolves.
  const sessionEpochRef = useRef(0);
  const speculativeCreateFailedAtMsRef = useRef(0);

  const sessionsQuery = useQuery({
    enabled: input.projectId !== null,
    queryFn: async () => {
      if (input.projectId === null) return [];
      return listAgentSessions(toProjectId(input.projectId), toAgentId(input.agentId), {
        archived: false,
        type: "preview",
      });
    },
    queryKey: ["agent-session-list", input.agentId, "preview", "active"],
  });

  const agentSessions = sessionsQuery.data ?? [];
  const defaultSessionId = agentSessions[0]?.id ?? null;
  // The list excludes expired Previews, so a selected Preview that drops out of
  // it is gone and the next action starts a new one.
  const selectedPreviewWasRemoved =
    sessionsQuery.isSuccess &&
    selectedSessionId !== undefined &&
    selectedSessionId !== null &&
    selectedSessionId !== unlistedCreatedSessionIdRef.current &&
    !agentSessions.some((session) => session.id === selectedSessionId);
  const activeSessionId = selectedPreviewWasRemoved
    ? null
    : selectedSessionId === undefined
      ? defaultSessionId
      : selectedSessionId;
  const activeSession =
    activeSessionId === null
      ? null
      : (agentSessions.find((session) => session.id === activeSessionId) ?? null);
  const configurationRefreshRequired = hasStaleSessionConfiguration({
    activeSession,
    configurationChangedAt: input.configurationChangedAt,
  });
  const stream = useSessionStream(input.projectId, activeSessionId);
  const readiness = activeSessionId === null ? input.readiness : null;
  const readinessBlockMessage = getReadinessBlockMessage(readiness);
  // A send in flight counts as a running turn, so the composer shows Stop
  // instead of accepting a second message.
  const streaming = stream.streaming || pendingSend !== null;
  // Memoized so the transcript keeps one array identity between stream updates.
  const messages = useMemo(
    () => withPendingSend(stream.messages, pendingSend),
    [pendingSend, stream.messages],
  );

  async function refreshSessions(): Promise<void> {
    if (input.projectId === null) {
      return;
    }

    const current = await sessionsQuery.refetch();
    if (current.data?.some((session) => session.id === unlistedCreatedSessionIdRef.current)) {
      // Once listed, the list owns the created Preview; a later removal must
      // start a new one instead of reusing the settled create.
      unlistedCreatedSessionIdRef.current = null;
      sessionCreatePromiseRef.current = null;
    }
  }

  function clearComposerError(): void {
    setComposerError(null);
  }

  // "Supersede any in-flight create" is one invariant: the epoch bump and the
  // promise-slot reset must always move together.
  function supersedeInFlightSessionCreate(): void {
    sessionEpochRef.current += 1;
    sessionCreatePromiseRef.current = null;
  }

  async function createSessionAndSelect(): Promise<string> {
    if (input.projectId === null) {
      throw new Error("Project id is required to create an agent session.");
    }

    const epoch = sessionEpochRef.current;
    const createdSession = await createAgentSession(
      toProjectId(input.projectId),
      toAgentId(input.agentId),
      "preview",
    );

    if (sessionEpochRef.current !== epoch) {
      // Reset superseded this create while it was in flight; the orphaned
      // session is reaped by the next reset.
      return createdSession.id;
    }

    setSelectedSessionId(createdSession.id);
    unlistedCreatedSessionIdRef.current = createdSession.id;
    void refreshSessions();
    return createdSession.id;
  }

  async function handleResetSession(): Promise<void> {
    if (sending) {
      return;
    }

    setSending(true);
    supersedeInFlightSessionCreate();
    clearComposerError();

    try {
      if (input.projectId === null) {
        throw new Error("Project id is required to reset agent sessions.");
      }

      const projectId = toProjectId(input.projectId);
      const resetSessionIds = getResetSessionIds({
        activeSessionId,
        sessions: agentSessions,
      });

      for (const sessionId of resetSessionIds) {
        await deleteAgentSession(projectId, toSessionId(sessionId));
      }

      setSelectedSessionId(null);
      await refreshSessions();
    } catch (error) {
      setComposerError({
        message: error instanceof Error ? error.message : t("agent.sessionResetFailed"),
        retryable: false,
      });
    } finally {
      setSending(false);
    }
  }

  async function ensureActiveSession(): Promise<string> {
    if (activeSessionId !== null) {
      return activeSessionId;
    }

    // Typing-triggered speculative creation and send-triggered creation share
    // one in-flight promise so a send never races a second create. A resolved
    // promise stays cached on purpose: activeSessionId state can lag a render
    // and re-awaiting it returns the same id. Failures clear the slot (only if
    // it still owns it — reset may have handed the slot to a newer create) so
    // the next attempt retries and owns error surfacing.
    if (sessionCreatePromiseRef.current === null) {
      const createPromise = createSessionAndSelect().catch((error: unknown) => {
        if (sessionCreatePromiseRef.current === createPromise) {
          sessionCreatePromiseRef.current = null;
        }

        throw error;
      });

      sessionCreatePromiseRef.current = createPromise;
    }

    return sessionCreatePromiseRef.current;
  }

  function notifyComposerTyping(): void {
    if (input.projectId === null) {
      return;
    }

    if (activeSessionId !== null) {
      if (stream.lifecycle === "TERMINATED" || readinessBlockMessage !== null) {
        return;
      }

      triggerAgentSessionPrewarm(toProjectId(input.projectId), toSessionId(activeSessionId));
      return;
    }

    // Cooldown after a failed speculative create so a failing endpoint is not
    // re-hit on every keystroke; a real send retries immediately regardless.
    if (
      Date.now() - speculativeCreateFailedAtMsRef.current <
      SPECULATIVE_CREATE_FAILURE_COOLDOWN_MS
    ) {
      return;
    }

    if (
      shouldSpeculativelyCreateSessionOnTyping({
        activeSessionId,
        projectId: input.projectId,
        readinessBlockMessage,
        sending,
        // isSuccess, not isFetched: a failed list query must not spawn
        // invisible sessions the broken list cannot show.
        sessionListLoaded: sessionsQuery.isSuccess,
      })
    ) {
      // Silent by design: the user has not acted yet, so the send path owns
      // error surfacing when creation genuinely fails.
      void ensureActiveSession().catch((error: unknown) => {
        speculativeCreateFailedAtMsRef.current = Date.now();
        ignorePromiseRejection(error);
      });
    }
  }

  async function handleSend(options: SendOptions): Promise<boolean> {
    const typedText = options.text.trim();
    const payload = createSessionResourceMentionMessagePayload({
      mentions: options.sessionResourceMentions ?? [],
      message: typedText,
    });

    if (
      isComposerSendBlocked({
        lifecycle: stream.lifecycle,
        readinessBlockMessage,
        reconnecting: stream.reconnecting,
        sending,
        streaming,
        typedText,
      })
    ) {
      return false;
    }

    const clientRequestId = crypto.randomUUID();
    setSending(true);
    clearComposerError();
    setPendingSend({
      message: createLiveStateMessage({
        content: payload.text,
        id: `pending:${clientRequestId}`,
        role: "user",
      }),
      userMessageCount: countUserMessages(stream.messages),
    });

    try {
      const sessionId = await ensureActiveSession();
      await stream.sendUserMessage({
        attachmentIds: payload.attachmentIds,
        clientRequestId,
        sessionId,
        text: payload.text,
      });

      void refreshSessions();
      return true;
    } catch (error) {
      setComposerError({
        actionLabel: t("agent.retrySend"),
        message: error instanceof Error ? error.message : t("agent.messageSendFailed"),
        retryable: true,
      });
      // The server rejects work on an expired Preview; once the list drops it,
      // Retry starts a new Preview.
      void refreshSessions();
      return false;
    } finally {
      setPendingSend(null);
      setSending(false);
    }
  }

  async function cancel(): Promise<void> {
    if (activeSessionId === null) {
      return;
    }

    const runId = stream.run.id;

    try {
      // A null runId is resolved to the session's active run server-side, so
      // Stop also works for a run whose id the stream has not reported yet.
      await stream.sendUserInterrupt({ runId, sessionId: activeSessionId });
    } catch (error) {
      if (runId !== null) {
        throw error;
      }
      // Stop shows while a send is in flight, before its run exists; with no
      // known run a failed interrupt just means there was nothing to stop yet.
    }
  }

  return {
    activeSession,
    activeSessionId,
    cancel,
    composerError,
    configurationRefreshRequired,
    ensureActiveSession,
    handleResetSession,
    handleSend,
    isConversationLoading: activeSessionId !== null && !stream.hydrated && pendingSend === null,
    lifecycle: stream.lifecycle,
    messages,
    notifyComposerTyping,
    readiness,
    readinessBlockMessage,
    reconnecting: stream.reconnecting,
    refreshSessions,
    run: stream.run,
    sending,
    sessionLoadError: sessionsQuery.error instanceof Error ? sessionsQuery.error.message : null,
    streaming,
  };
}
