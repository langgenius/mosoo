import type { SessionViewMessage } from "@mosoo/ag-ui-session";

// Optimistic overlay for user messages that were submitted but not yet echoed
// back over the session WebSocket. Lives outside SessionLiveState on purpose:
// STATE_SNAPSHOT / MESSAGES_SNAPSHOT wholesale-replace reducer state, and the
// echoed message id is a server ULID the client cannot predict, so entries are
// reconciled by (user role + trimmed content + not a previously seen id).
export interface PendingSend {
  readonly baselineUserMessageIds: readonly string[];
  readonly clientRequestId: string;
  readonly createdAtMs: number;
  readonly sessionId: string | null;
  readonly text: string;
}

// Safety valve only: a persisted send always reconciles via echo or snapshot;
// the TTL covers the black-swan case of server-side content transformation so
// the composer can never stay blocked forever behind a stuck overlay entry.
export const PENDING_SEND_TTL_MS = 30_000;

export function createPendingSendMessage(pending: PendingSend): SessionViewMessage {
  return {
    content: pending.text,
    createdAt: new Date(pending.createdAtMs).toISOString(),
    id: `pending:${pending.clientRequestId}`,
    plan: [],
    role: "user",
    segments: [],
  };
}

export function mergePendingSendMessages(
  messages: SessionViewMessage[],
  pendingSends: readonly PendingSend[],
): SessionViewMessage[] {
  if (pendingSends.length === 0) {
    return messages;
  }

  return [...messages, ...pendingSends.map(createPendingSendMessage)];
}

function isEchoOfPendingSend(message: SessionViewMessage, pending: PendingSend): boolean {
  return (
    message.role === "user" &&
    !pending.baselineUserMessageIds.includes(message.id) &&
    message.content.trim() === pending.text.trim()
  );
}

export function prunePendingSends(
  pendingSends: PendingSend[],
  messages: readonly SessionViewMessage[],
  nowMs: number,
): PendingSend[] {
  if (pendingSends.length === 0) {
    return pendingSends;
  }

  const remaining = pendingSends.filter(
    (pending) =>
      nowMs - pending.createdAtMs < PENDING_SEND_TTL_MS &&
      !messages.some((message) => isEchoOfPendingSend(message, pending)),
  );

  // Identity preservation is load-bearing: the model prunes inside a state
  // updater on every message batch, and the unchanged reference is what stops
  // React from re-rendering in a loop.
  return remaining.length === pendingSends.length ? pendingSends : remaining;
}

export function prunePendingSendsForSession(
  pendingSends: PendingSend[],
  activeSessionId: string | null,
): PendingSend[] {
  const remaining = pendingSends.filter(
    (pending) => pending.sessionId === null || pending.sessionId === activeSessionId,
  );

  return remaining.length === pendingSends.length ? pendingSends : remaining;
}
