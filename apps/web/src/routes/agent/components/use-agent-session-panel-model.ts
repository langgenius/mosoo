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
  createPendingSendMessage,
  mergePendingSendMessages,
  PENDING_SEND_SWEEP_INTERVAL_MS,
  prunePendingSends,
  prunePendingSendsForSession,
} from "./agent-session-pending-sends";
import type { PendingSend } from "./agent-session-pending-sends";

const SPECULATIVE_CREATE_FAILURE_COOLDOWN_MS = 30_000;

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
  // Bumped by reset/new-session/retry so an in-flight create that they
  // superseded cannot re-select its (now orphaned) session when it resolves.
  const sessionEpochRef = useRef(0);
  const speculativeCreateFailedAtMsRef = useRef(0);

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

  // Fresh messages for the sweep interval without keying the effect on
  // stream.messages — that identity changes every animation frame during
  // streaming and would tear the interval down per frame.
  const streamMessagesRef = useRef(stream.messages);
  streamMessagesRef.current = stream.messages;

  // Reconcile the optimistic overlay against server truth at render time, so
  // the frame that first contains the echoed message never also paints the
  // pending bubble (a post-commit effect alone leaves a duplicate frame). The
  // session filter runs here too so a pending entry bound to another session
  // can never ghost into the newly selected session's thread mid-switch.
  const reconciledPendingSends = useMemo(
    () =>
      prunePendingSends(
        prunePendingSendsForSession(pendingSends, activeSessionId),
        stream.messages,
        Date.now(),
      ),
    [activeSessionId, pendingSends, stream.messages],
  );

  useEffect(() => {
    setPendingSends((current) => prunePendingSendsForSession(current, activeSessionId));
  }, [activeSessionId]);

  // State GC + TTL sweep: gates and visuals read the render-time reconciled
  // value, so state only needs to catch up eventually — eagerly when the
  // overlay changes, then every sweep tick so a stuck entry expires even when
  // no further events arrive and the composer can never stay blocked forever.
  useEffect(() => {
    if (pendingSends.length === 0) {
      return;
    }

    const sweep = (): void => {
      setPendingSends((current) =>
        prunePendingSends(current, streamMessagesRef.current, Date.now()),
      );
    };

    sweep();
    const interval = globalThis.setInterval(sweep, PENDING_SEND_SWEEP_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(interval);
    };
  }, [pendingSends]);

  async function refreshSessions(): Promise<void> {
    if (input.appId === null) {
      return;
    }

    await sessionsQuery.refetch();
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

  const streamingWithPending = stream.streaming || reconciledPendingSends.length > 0;

  async function createSessionAndSelect(
    options: { waitForRuntimeReady?: boolean } = {},
  ): Promise<string> {
    if (input.appId === null) {
      throw new Error("App id is required to create an agent session.");
    }

    const epoch = sessionEpochRef.current;
    const createdSession = await createAgentSession(
      toAppId(input.appId),
      toAgentId(input.agentId),
      input.sessionType,
      {
        waitForRuntimeReady: options.waitForRuntimeReady === true,
      },
    );

    if (sessionEpochRef.current !== epoch) {
      // Reset/new-session superseded this create while it was in flight; the
      // orphaned session is reaped by the next reset.
      return createdSession.id;
    }

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
    supersedeInFlightSessionCreate();
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
    supersedeInFlightSessionCreate();
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
        appId: input.appId,
        readinessBlockMessage,
        sending,
        // isSuccess, not isFetched: a failed list query must not spawn
        // invisible sessions the broken list cannot show.
        sessionListLoaded: sessionsQuery.isSuccess,
        sessionType: input.sessionType,
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

  async function retryProviderCheck(): Promise<void> {
    if (sending) {
      return;
    }

    setSending(true);
    supersedeInFlightSessionCreate();
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
        streaming: streamingWithPending,
        typedText,
      })
    ) {
      return false;
    }

    setSending(true);
    clearComposerError();
    options.onAccepted?.();

    const clientRequestId = crypto.randomUUID();
    // Sending into an existing but not-yet-hydrated session would capture an
    // empty baseline, letting an identical message from history falsely prune
    // the overlay — skip optimism there (sub-second race, pre-existing UX).
    const canRenderOptimistically = activeSessionId === null || stream.hydrated;
    const pendingSend: PendingSend = {
      baselineUserMessageIds: stream.messages
        .filter((message) => message.role === "user")
        .map((message) => message.id),
      clientRequestId,
      createdAtMs: Date.now(),
      sessionId: activeSessionId,
      text: payload.text,
    };

    if (canRenderOptimistically) {
      setPendingSends((current) => [...current, pendingSend]);
    }

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

    const runId = stream.run.id;

    try {
      // A null runId is resolved to the session's active run server-side, so
      // Stop works during the optimistic window too: once the send HTTP has
      // resolved, the queued run exists and gets interrupted.
      await stream.sendUserInterrupt({ runId, sessionId: activeSessionId });
    } catch (error) {
      if (runId !== null) {
        throw error;
      }
      // Best-effort in the optimistic window: with no known run a failed
      // interrupt just means there was nothing to stop yet.
    }
  }

  // Two-step memo keeps the pending bubbles' object identity stable across
  // streaming frames, so assistant-ui's per-message memoization holds.
  const pendingSendMessages = useMemo(
    () => reconciledPendingSends.map((pending) => createPendingSendMessage(pending)),
    [reconciledPendingSends],
  );
  const displayMessages = useMemo(
    () => mergePendingSendMessages(stream.messages, pendingSendMessages),
    [stream.messages, pendingSendMessages],
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
      activeSessionId !== null && !stream.hydrated && reconciledPendingSends.length === 0,
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
    streaming: streamingWithPending,
  };
}
