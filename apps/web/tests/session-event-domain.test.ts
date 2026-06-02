import { describe, expect, test } from "bun:test";

import type { SessionProcessEvent } from "@mosoo/contracts/session";

import {
  SESSION_EVENT_FILTER_DOMAINS,
  getSessionEventDomain,
  isSessionEventVisibleInMainFeed,
} from "../src/shared/ui/session-events/domain";

function eventOf(type: SessionProcessEvent["type"], content = type): SessionProcessEvent {
  return {
    content,
    durationMs: 1,
    id: `event:${type}`,
    occurredAt: "2026-05-20T00:00:00.000Z",
    status: "available",
    tokens: type === "usage.updated" ? 42 : null,
    type,
  };
}

describe("session event v1.5 domain model", () => {
  test("keeps span as a reserved domain but removes it from filter chips and visible rows", () => {
    const usage = eventOf("usage.updated");

    expect(getSessionEventDomain(usage.type)).toBe("span");
    expect(SESSION_EVENT_FILTER_DOMAINS).toEqual(["user", "agent", "session"]);
    expect(isSessionEventVisibleInMainFeed(usage)).toBe(false);
  });

  test("groups visible feed events by actor domain", () => {
    const userMessage = eventOf("user.message");
    const assistantMessage = eventOf("agent.message.delta");
    const toolUse = eventOf("tool.use.started", "WebSearch details: {}");
    const runStarted = eventOf("run.started");

    expect(getSessionEventDomain(userMessage.type)).toBe("user");
    expect(getSessionEventDomain(assistantMessage.type)).toBe("agent");
    expect(getSessionEventDomain(toolUse.type)).toBe("agent");
    expect(getSessionEventDomain(runStarted.type)).toBe("session");
    expect(isSessionEventVisibleInMainFeed(userMessage)).toBe(true);
    expect(isSessionEventVisibleInMainFeed(assistantMessage)).toBe(true);
    expect(isSessionEventVisibleInMainFeed(toolUse)).toBe(true);
    expect(isSessionEventVisibleInMainFeed(runStarted)).toBe(true);
  });
});
