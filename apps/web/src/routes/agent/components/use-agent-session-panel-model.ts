import type { SessionType } from "@mosoo/contracts/session";
import { ignorePromiseRejection } from "@mosoo/effects";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useSessionStream } from "@/domains/runtime/use-session-stream";
import type { PermissionRequest } from "@/domains/runtime/use-session-stream";
import { listAgentSessions, triggerAgentSessionPrewarm } from "@/domains/session/api/agent-session";
import { createSessionResourceMentionMessagePayload } from "@/features/session-chat/session-resource-mentions";
import { useSessionChatLayoutState } from "@/features/session-chat/use-session-chat-layout-state";
import { toAgentId, toAppId, toSessionId } from "@/routes/typed-id";

import type {
  AgentSessionPanelModel,
  ComposerError,
  PermissionDecision,
  SendOptions,
  UseAgentSessionPanelModelInput,
} from "./agent-session-panel-model-types";
import {
  createSessionAutoTitle,
  getReadinessBlockMessage,
  hasStaleSessionConfiguration,
  isComposerSendBlocked,
  selectSessionPanelReadiness,
  shouldSpeculativelyCreateSessionOnTyping,
  shouldWaitForRuntimeReadyOnNewSession,
} from "./agent-session-panel-rules";
import {
  autoTitleSession,
  createAgentSession,
  deleteAgentSession,
} from "./agent-session-panel-session-actions";
import {
  mergePendingSendMessages,
  PENDING_SEND_TTL_MS,
  prunePendingSends,
  prunePendingSendsForSession,
} from "./agent-session-pending-sends";
import type { PendingSend } from "./agent-session-pending-sends";

async function autoTitleSessionAndRefresh(input: {
  appId: string | null;
  refreshSessions: () => Promise<void>;
  sessionId: string;
  title: string;
}): Promise<void> {
  if (input.appId === null) {
    return;
  }

  await autoTitleSession(toAppId(input.appId), toSessionId(input.sessionId), input.title).catch(
    ignorePromiseRejection,
  );
  void input.refreshSessions();
}

export function getResetSessionIds(input: {
  readonly activeSessionId: string | null;
  readonly sessions: readonly { readonly id: string }[];
  readonly sessionType: SessionType;
}): string[] {
  if (input.sessionType !== "preview") {
    return input.activeSessionId === null ? [] : [input.activeSessionId];
  }

  const sessionIds = new Set(input.sessions.map((session) => session.id));

  if (input.activeSessionId !== null) {
    sessionIds.add(input.activeSessionId);
  }

  return [...sessionIds];
}

export function removeSessionConfigurationRevisionKeys(
  current: Readonly<Record<string, string>>,
  sessionIds: readonly string[],
): Record<string, string> {
  const next = { ...current };

  for (const sessionId of sessionIds) {
    delete next[sessionId];
  }

  return next;
}

export function useAgentSessionPanelModel(
  input: UseAgentSessionPanelModelInput,
): AgentSessionPanelModel {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null | undefined>();
  const [sessionConfigurationRevisions, setSessionConfigurationRevisions] = useState<
    Record<string, string>
  >({});
  const [inputValue, setInputValue] = useState("");
  const [composerError, setComposerError] = useState<ComposerError | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingSends, setPendingSends] = useState<PendingSend[]>([]);
  const sessionCreatePromiseRef = useRef<Promise<string> | null>(null);

  const sessionsQuery = useQuery({
    enabled: input.appId !== null,
    queryFn: async () =>
      input.appId === null
        ? []
        : listAgentSessions(toAppId(input.appId), toAgentId(input.agentId), {
            archived: false,
            participantOnly: true,
            type: input.sessionType,
          }),
    queryKey: ["agent-session-list", input.agentId, input.sessionType, "active"],
  });

  const agentSessions = sessionsQuery.data ?? [];
  const defaultSessionId = agentSessions[0]?.id ?? null;
  const activeSessionId = selectedSessionId === undefined ? defaultSessionId : selectedSessionId;
  const activeSession =
    activeSessionId === null
      ? null
      : (agentSessions.find((session) => session.id === activeSessionId) ?? null);
  const activeSessionRevision =
    activeSessionId === null ? null : (sessionConfigurationRevisions[activeSessionId] ?? null);
  const configurationRefreshRequired = hasStaleSessionConfiguration({
    activeSession,
    activeSessionRevision,
    configurationChangedAt: input.configurationChangedAt,
    configurationRevisionKey: input.configurationRevisionKey,
    requireFreshConfiguration: input.requireFreshConfiguration,
  });
  const stream = useSessionStream(input.appId, activeSessionId);
  const readiness = selectSessionPanelReadiness({
    agentReadiness: input.readiness,
    streamReadiness: stream.readiness,
  });
  const readinessBlockMessage = getReadinessBlockMessage(readiness);
  const permissionScrollSignal = useMemo(
    () => stream.permissionRequests.map((request) => request.requestId).join("|"),
    [stream.permissionRequests],
  );
  const layout = useSessionChatLayoutState(stream.messages, permissionScrollSignal);

  // Reconcile the optimistic overlay against server truth: drop an entry as
  // soon as its echo (or any snapshot containing the persisted message) lands.
  useEffect(() => {
    setPendingSends((current) => prunePendingSends(current, stream.messages, Date.now()));
  }, [stream.messages]);

  useEffect(() => {
    setPendingSends((current) => prunePendingSendsForSession(current, activeSessionId));
  }, [activeSessionId]);

  // TTL sweep so a stuck entry expires even when no further events arrive;
  // without it the composer could stay blocked behind a never-reconciled send.
  useEffect(() => {
    if (pendingSends.length === 0) {
      return;
    }

    const nextExpiryMs = Math.min(
      ...pendingSends.map((pending) => pending.createdAtMs + PENDING_SEND_TTL_MS),
    );
    const timer = globalThis.setTimeout(
      () => {
        setPendingSends((current) => prunePendingSends(current, stream.messages, Date.now()));
      },
      Math.max(0, nextExpiryMs - Date.now()),
    );

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [pendingSends, stream.messages]);

  async function refreshSessions(): Promise<void> {
    if (input.appId === null) {
      return;
    }

    await sessionsQuery.refetch();
  }

  function clearComposerError(): void {
    setComposerError(null);
  }

  async function createSessionAndSelect(
    options: { waitForRuntimeReady?: boolean } = {},
  ): Promise<string> {
    if (input.appId === null) {
      throw new Error("App id is required to create an agent session.");
    }

    const createdSession = await createAgentSession(
      toAppId(input.appId),
      toAgentId(input.agentId),
      input.sessionType,
      {
        waitForRuntimeReady: options.waitForRuntimeReady === true,
      },
    );
    const revisionKey = input.configurationRevisionKey;

    if (revisionKey !== null && revisionKey.length > 0) {
      setSessionConfigurationRevisions((current) => ({
        ...current,
        [createdSession.id]: revisionKey,
      }));
    }

    setSelectedSessionId(createdSession.id);
    void refreshSessions();
    return createdSession.id;
  }

  async function handleStartNewSession(): Promise<void> {
    if (sending) {
      return;
    }

    setSending(true);
    sessionCreatePromiseRef.current = null;
    setSelectedSessionId(null);
    setInputValue("");
    setPendingSends([]);
    clearComposerError();

    try {
      await createSessionAndSelect({
        waitForRuntimeReady: shouldWaitForRuntimeReadyOnNewSession(input),
      });
    } catch (error) {
      setComposerError({
        actionLabel: "Retry",
        message: error instanceof Error ? error.message : "Session setup failed.",
        retryable: true,
      });
    } finally {
      setSending(false);
    }
  }

  async function handleResetSession(): Promise<void> {
    if (sending) {
      return;
    }

    setSending(true);
    sessionCreatePromiseRef.current = null;
    setInputValue("");
    setPendingSends([]);
    clearComposerError();

    try {
      if (input.appId === null) {
        throw new Error("App id is required to reset agent sessions.");
      }

      const appId = toAppId(input.appId);
      const resetSessionIds = getResetSessionIds({
        activeSessionId,
        sessionType: input.sessionType,
        sessions: agentSessions,
      });

      for (const sessionId of resetSessionIds) {
        await deleteAgentSession(appId, toSessionId(sessionId));
      }

      if (resetSessionIds.length > 0) {
        setSessionConfigurationRevisions((current) =>
          removeSessionConfigurationRevisionKeys(current, resetSessionIds),
        );
      }

      setSelectedSessionId(null);
      await refreshSessions();
    } catch (error) {
      setComposerError({
        message: error instanceof Error ? error.message : "Session reset failed.",
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
    // and re-awaiting it returns the same id. Failures clear the slot so the
    // next attempt retries and owns error surfacing.
    if (sessionCreatePromiseRef.current === null) {
      sessionCreatePromiseRef.current = createSessionAndSelect().catch((error: unknown) => {
        sessionCreatePromiseRef.current = null;
        throw error;
      });
    }

    return sessionCreatePromiseRef.current;
  }

  function notifyComposerTyping(): void {
    if (input.appId === null) {
      return;
    }

    if (activeSessionId !== null) {
      if (
        stream.lifecycle === "TERMINATED" ||
        configurationRefreshRequired ||
        readinessBlockMessage !== null
      ) {
        return;
      }

      triggerAgentSessionPrewarm(toAppId(input.appId), toSessionId(activeSessionId));
      return;
    }

    if (
      shouldSpeculativelyCreateSessionOnTyping({
        activeSessionId,
        appId: input.appId,
        readinessBlockMessage,
        sending,
        sessionListLoaded: sessionsQuery.isFetched,
        sessionType: input.sessionType,
      })
    ) {
      // Silent by design: the user has not acted yet, so the send path owns
      // error surfacing when creation genuinely fails.
      void ensureActiveSession().catch(ignorePromiseRejection);
    }
  }

  async function retryProviderCheck(): Promise<void> {
    if (sending) {
      return;
    }

    setSending(true);
    sessionCreatePromiseRef.current = null;
    clearComposerError();
    setSelectedSessionId(null);

    try {
      await createSessionAndSelect();
    } catch (error) {
      setComposerError({
        actionLabel: "Retry",
        message: error instanceof Error ? error.message : "Provider check failed.",
        retryable: true,
      });
    } finally {
      setSending(false);
    }
  }

  async function handleSend(options: SendOptions = {}): Promise<boolean> {
    const typedText = (options.text ?? inputValue).trim();
    const payload = createSessionResourceMentionMessagePayload({
      mentions: options.sessionResourceMentions ?? [],
      message: typedText,
    });

    if (
      isComposerSendBlocked({
        configurationRefreshRequired,
        lifecycle: stream.lifecycle,
        readinessBlockMessage,
        reconnecting: stream.reconnecting,
        sending,
        // In-flight optimistic sends block re-submit like a running turn: the
        // server allows one active run, so a second Enter before the echo
        // would only surface an active-run error.
        streaming: stream.streaming || pendingSends.length > 0,
        typedText,
      })
    ) {
      return false;
    }

    setSending(true);
    clearComposerError();

    const clientRequestId = crypto.randomUUID();
    const pendingSend: PendingSend = {
      baselineUserMessageIds: stream.messages
        .filter((message) => message.role === "user")
        .map((message) => message.id),
      clientRequestId,
      createdAtMs: Date.now(),
      sessionId: activeSessionId,
      text: payload.text,
    };
    setPendingSends((current) => [...current, pendingSend]);

    const shouldAutoTitle =
      activeSessionId === null ||
      activeSession?.lastMessageAt === null ||
      activeSession?.lastMessageAt === undefined;

    try {
      const sessionId = await ensureActiveSession();

      if (pendingSend.sessionId !== sessionId) {
        setPendingSends((current) =>
          current.map((pending) =>
            pending.clientRequestId === clientRequestId ? { ...pending, sessionId } : pending,
          ),
        );
      }

      await stream.sendUserMessage({
        attachmentIds: payload.attachmentIds,
        clientRequestId,
        sessionId,
        text: payload.text,
      });
      setInputValue("");

      if (layout.inputRef.current) {
        layout.inputRef.current.style.height = "auto";
      }

      if (shouldAutoTitle) {
        const title = createSessionAutoTitle(typedText);
        const titledSessionId = sessionId;

        globalThis.setTimeout(() => {
          void autoTitleSessionAndRefresh({
            appId: input.appId,
            refreshSessions,
            sessionId: titledSessionId,
            title,
          });
        }, 500);
      }

      void refreshSessions();
      return true;
    } catch (error) {
      setPendingSends((current) =>
        current.filter((pending) => pending.clientRequestId !== clientRequestId),
      );
      setComposerError({
        actionLabel: "Retry send",
        message: error instanceof Error ? error.message : "Message send failed.",
        retryable: true,
      });
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleKeyDown(event: KeyboardEvent, options: SendOptions = {}): Promise<boolean> {
    if (event.key !== "Enter" || event.shiftKey) {
      return false;
    }

    if (event.nativeEvent.isComposing) {
      return false;
    }

    event.preventDefault();
    return handleSend(options);
  }

  async function resolvePermission(
    request: PermissionRequest,
    decision: PermissionDecision,
  ): Promise<void> {
    if (activeSessionId === null) {
      return;
    }

    await stream.sendPermissionDecision({
      decision,
      requestId: request.requestId,
      sessionId: activeSessionId,
    });
  }

  async function cancel(): Promise<void> {
    if (activeSessionId === null) {
      return;
    }

    await stream.sendUserInterrupt({ runId: stream.run.id, sessionId: activeSessionId });
  }

  const displayMessages = useMemo(
    () => mergePendingSendMessages(stream.messages, pendingSends),
    [stream.messages, pendingSends],
  );

  return {
    activeSession,
    activeSessionId,
    cancel,
    composerError,
    configurationRefreshRequired,
    ensureActiveSession,
    fileInputRef: layout.fileInputRef,
    handleKeyDown,
    handleResetSession,
    handleSend,
    handleStartNewSession,
    input: inputValue,
    inputRef: layout.inputRef,
    isConversationLoading:
      activeSessionId !== null && !stream.hydrated && pendingSends.length === 0,
    lifecycle: stream.lifecycle,
    messages: displayMessages,
    messagesEndRef: layout.messagesEndRef,
    notifyComposerTyping,
    permissionRequests: stream.permissionRequests,
    readiness,
    readinessBlockMessage,
    reconnecting: stream.reconnecting,
    resolvePermission,
    retryProviderCheck,
    run: stream.run,
    sending,
    sessionCount: agentSessions.length,
    sessionLoadError: sessionsQuery.error instanceof Error ? sessionsQuery.error.message : null,
    setInput: setInputValue,
    streaming: stream.streaming || pendingSends.length > 0,
  };
}
