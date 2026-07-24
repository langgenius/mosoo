import { createSessionLiveStateMessage } from "@mosoo/ag-ui-session";
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

// Safety valve only: a persisted send always reconciles via echo or snapshot
// (normally well under a second); the TTL bounds how long the composer can
// stay blocked in the black-swan case of server-side content transformation.
export const PENDING_SEND_TTL_MS = 10_000;

// The TTL sweep runs on an interval, not a one-shot timer: a one-shot whose
// prune no-ops (identity-preserved state, e.g. after a backwards wall-clock
// step) would never re-arm and could leave the composer blocked forever.
export const PENDING_SEND_SWEEP_INTERVAL_MS = 5_000;

export function createPendingSendMessage(pending: PendingSend): SessionViewMessage {
  return createSessionLiveStateMessage({
    content: pending.text,
    createdAt: new Date(pending.createdAtMs).toISOString(),
    id: `pending:${pending.clientRequestId}`,
    role: "user",
  });
}

export function mergePendingSendMessages(
  messages: SessionViewMessage[],
  pendingMessages: readonly SessionViewMessage[],
): SessionViewMessage[] {
  if (pendingMessages.length === 0) {
    return messages;
  }

  return [...messages, ...pendingMessages];
}

function indexUserMessageIdsByTrimmedContent(
  messages: readonly SessionViewMessage[],
): Map<string, Set<string>> {
  const idsByContent = new Map<string, Set<string>>();

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const content = message.content.trim();
    const ids = idsByContent.get(content);

    if (ids === undefined) {
      idsByContent.set(content, new Set([message.id]));
    } else {
      ids.add(message.id);
    }
  }

  return idsByContent;
}

function hasEchoOfPendingSend(
  userMessageIdsByContent: ReadonlyMap<string, ReadonlySet<string>>,
  pending: PendingSend,
): boolean {
  const candidateIds = userMessageIdsByContent.get(pending.text.trim());

  if (candidateIds === undefined) {
    return false;
  }

  if (pending.baselineUserMessageIds.length === 0) {
    return candidateIds.size > 0;
  }

  const baselineIds = new Set(pending.baselineUserMessageIds);

  for (const candidateId of candidateIds) {
    if (!baselineIds.has(candidateId)) {
      return true;
    }
  }

  return false;
}

export function prunePendingSends(
  pendingSends: PendingSend[],
  messages: readonly SessionViewMessage[],
  nowMs: number,
): PendingSend[] {
  if (pendingSends.length === 0) {
    return pendingSends;
  }

  const userMessageIdsByContent = indexUserMessageIdsByTrimmedContent(messages);
  const remaining = pendingSends.filter(
    (pending) =>
      nowMs - pending.createdAtMs < PENDING_SEND_TTL_MS &&
      !hasEchoOfPendingSend(userMessageIdsByContent, pending),
  );

  // Identity preservation is load-bearing: the model prunes inside a state
  // updater on every sweep, and the unchanged reference is what stops React
  // from re-rendering in a loop.
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
