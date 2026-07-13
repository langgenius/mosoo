import { describe, expect, test } from "bun:test";

import type { SessionProcessEvent } from "@mosoo/contracts/session";

import { projectSessionTurns } from "../src/shared/ui/session-events/turns";

function eventOf(
  id: string,
  type: SessionProcessEvent["type"],
  second: number,
): SessionProcessEvent {
  return {
    content: type,
    durationMs: 1,
    id,
    occurredAt: `2026-07-13T00:00:${String(second).padStart(2, "0")}.000Z`,
    status: type === "run.failed" ? "error" : "available",
    tokens: null,
    type,
  };
}

describe("session Turn projection", () => {
  test("marks a Turn failed when a Run fails before run.started", () => {
    const events = [
      eventOf("event-1", "user.message", 1),
      eventOf("event-2", "session.status", 2),
      eventOf("event-3", "run.failed", 3),
    ];

    expect(projectSessionTurns(events)).toEqual([
      expect.objectContaining({
        endedAt: events[2]?.occurredAt,
        events,
        index: 1,
        status: "failed",
      }),
    ]);
  });

  test("keeps consecutive Runs that fail before run.started in separate Turns", () => {
    const events = [
      eventOf("event-1", "user.message", 1),
      eventOf("event-2", "run.failed", 2),
      eventOf("event-3", "user.message", 3),
      eventOf("event-4", "run.failed", 4),
    ];

    expect(
      projectSessionTurns(events).map(({ events: turnEvents, index, status }) => ({
        eventIds: turnEvents.map((event) => event.id),
        index,
        status,
      })),
    ).toEqual([
      { eventIds: ["event-1", "event-2"], index: 1, status: "failed" },
      { eventIds: ["event-3", "event-4"], index: 2, status: "failed" },
    ]);
  });

  test("keeps the normal run.started to run.completed projection", () => {
    const events = [
      eventOf("event-1", "user.message", 1),
      eventOf("event-2", "run.started", 2),
      eventOf("event-3", "agent.message.delta", 3),
      eventOf("event-4", "run.completed", 4),
    ];

    expect(projectSessionTurns(events)).toEqual([
      expect.objectContaining({
        endedAt: events[3]?.occurredAt,
        events,
        id: "event-2",
        index: 1,
        startedAt: events[0]?.occurredAt,
        status: "completed",
      }),
    ]);
  });

  test("keeps unmatched trailing events in a pending Turn", () => {
    const events = [eventOf("event-1", "user.message", 1), eventOf("event-2", "session.status", 2)];

    expect(projectSessionTurns(events)).toEqual([
      expect.objectContaining({
        endedAt: null,
        events,
        id: "pending:event-1",
        index: 1,
        status: "pending",
      }),
    ]);
  });
});
