import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { useMemo } from "react";

import {
  getSessionEventDomain,
  isSessionEventAttentionWorthy,
  isSessionEventVisibleInMainFeed,
  isSessionStatusReschedulingEvent,
  isSessionStatusRunningEvent,
  isSessionStatusTerminatedEvent,
} from "./domain";
import type { SessionEventDomain } from "./domain";

export type SessionTurnStatus =
  | "completed"
  | "failed"
  | "pending"
  | "rescheduling"
  | "running"
  | "terminated";

export interface SessionTurn {
  endedAt: string | null;
  events: SessionProcessEvent[];
  id: string;
  index: number;
  runId: string | null;
  startedAt: string;
  status: SessionTurnStatus;
}

export interface SessionTurnCounts {
  agent: number;
  session: number;
  span: number;
  user: number;
}

interface MutableSessionTurn {
  endedAt: string | null;
  events: SessionProcessEvent[];
  id: string;
  runId: string | null;
  startedAt: string;
  status: SessionTurnStatus;
}

function createEmptyCounts(): SessionTurnCounts {
  return {
    agent: 0,
    session: 0,
    span: 0,
    user: 0,
  };
}

function createPendingTurn(events: SessionProcessEvent[]): MutableSessionTurn | null {
  const first = events[0] ?? null;

  if (first === null) {
    return null;
  }

  return {
    endedAt: null,
    events: [...events],
    id: `pending:${first.id}`,
    runId: null,
    startedAt: first.occurredAt,
    status: "pending",
  };
}

function finalizeTurns(turns: MutableSessionTurn[]): SessionTurn[] {
  return turns.map((turn, index) => ({
    ...turn,
    index: index + 1,
  }));
}

function createSessionTurns(events: readonly SessionProcessEvent[]): SessionTurn[] {
  const turns: MutableSessionTurn[] = [];
  let pendingEvents: SessionProcessEvent[] = [];
  let current: MutableSessionTurn | null = null;

  for (const event of events) {
    if (event.type === "run.started") {
      if (current !== null) {
        turns.push(current);
      }

      current = {
        endedAt: null,
        events: [...pendingEvents, event],
        id: event.id,
        runId: null,
        startedAt: pendingEvents[0]?.occurredAt ?? event.occurredAt,
        status: "running",
      };
      pendingEvents = [];
      continue;
    }

    if (current === null) {
      pendingEvents.push(event);
      continue;
    }

    current.events.push(event);

    if (event.type === "run.completed") {
      current.endedAt = event.occurredAt;
      current.status = "completed";
      turns.push(current);
      current = null;
      continue;
    }

    if (event.type === "run.failed") {
      current.endedAt = event.occurredAt;
      current.status = "failed";
      turns.push(current);
      current = null;
      continue;
    }

    if (isSessionStatusReschedulingEvent(event)) {
      current.status = "rescheduling";
      continue;
    }

    if (isSessionStatusRunningEvent(event) && current.status === "rescheduling") {
      current.status = "running";
      continue;
    }

    if (isSessionStatusTerminatedEvent(event)) {
      current.endedAt = event.occurredAt;
      current.status = "terminated";
      turns.push(current);
      current = null;
    }
  }

  if (current !== null) {
    turns.push(current);
  }

  const trailingPendingTurn = createPendingTurn(pendingEvents);

  if (trailingPendingTurn !== null) {
    turns.push(trailingPendingTurn);
  }

  return finalizeTurns(turns);
}

export function useSessionTurns(events: readonly SessionProcessEvent[]): SessionTurn[] {
  return useMemo(() => createSessionTurns(events), [events]);
}

export function countSessionTurnDomains(events: readonly SessionProcessEvent[]): SessionTurnCounts {
  const counts = createEmptyCounts();

  for (const event of events) {
    if (!isSessionEventVisibleInMainFeed(event)) {
      continue;
    }

    counts[getSessionEventDomain(event.type)] += 1;
  }

  return counts;
}

export function filterSessionTurnEvents(input: {
  domains: ReadonlySet<SessionEventDomain>;
  errorsOnly: boolean;
  events: readonly SessionProcessEvent[];
}): SessionProcessEvent[] {
  return input.events.filter((event) => {
    if (!isSessionEventVisibleInMainFeed(event)) {
      return false;
    }

    if (!input.domains.has(getSessionEventDomain(event.type))) {
      return false;
    }

    if (input.errorsOnly && !isSessionEventAttentionWorthy(event)) {
      return false;
    }

    return true;
  });
}

export function calculateSessionTurnDuration(turn: SessionTurn): number {
  const start = new Date(turn.startedAt).getTime();
  const end = new Date(turn.endedAt ?? turn.events.at(-1)?.occurredAt ?? turn.startedAt).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }

  return Math.max(0, end - start);
}

export function calculateSessionTurnTokens(events: readonly SessionProcessEvent[]): number | null {
  let total = 0;
  let sawTokens = false;

  for (const event of events) {
    if (event.tokens !== null) {
      total += event.tokens;
      sawTokens = true;
    }
  }

  return sawTokens ? total : null;
}
