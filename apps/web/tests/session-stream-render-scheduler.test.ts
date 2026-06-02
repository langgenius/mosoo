import { describe, expect, test } from "bun:test";

import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import type { SessionStreamRenderSchedulerHost } from "../src/domains/runtime/session-stream/session-stream-render-scheduler";
import { SessionStreamRenderScheduler } from "../src/domains/runtime/session-stream/session-stream-render-scheduler";

function createManualFrameHost(): {
  callbacks: (() => void)[];
  getNowCalls: () => number;
  host: SessionStreamRenderSchedulerHost;
} {
  const callbacks: (() => void)[] = [];
  let nowCalls = 0;

  return {
    callbacks,
    getNowCalls: () => nowCalls,
    host: {
      cancelFrame: () => {},
      now: () => {
        nowCalls += 1;
        return 0;
      },
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    },
  };
}

function drainFrames(callbacks: (() => void)[]): void {
  while (callbacks.length > 0) {
    callbacks.shift()?.();
  }
}

function textEvent(delta: string): AgUiSessionEvent {
  return {
    delta,
    messageId: "message-1",
    type: "TEXT_MESSAGE_CONTENT",
  };
}

function stateDeltaEvent(): AgUiSessionEvent {
  return {
    delta: [],
    type: "STATE_DELTA",
  };
}

describe("session stream render scheduler", () => {
  test("drains long text queues without dropping or reordering chunks", () => {
    const { callbacks, host } = createManualFrameHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((_sessionId, events) => {
      batches.push(events);
      return true;
    }, host);
    const events = Array.from({ length: 300 }, () => textEvent("x"));

    scheduler.enqueueMany("session-1", events);
    drainFrames(callbacks);

    expect(batches.length).toBeGreaterThan(1);
    expect(
      batches.flat().map((event) => (event.type === "TEXT_MESSAGE_CONTENT" ? event.delta : "")),
    ).toEqual(Array.from({ length: 300 }, () => "x"));
  });

  test("keeps another session queued while flushing the first session", () => {
    const { callbacks, host } = createManualFrameHost();
    const applied: { events: AgUiSessionEvent[]; sessionId: string }[] = [];
    const scheduler = new SessionStreamRenderScheduler((sessionId, events) => {
      applied.push({ events, sessionId });
      return true;
    }, host);

    scheduler.enqueueMany("session-1", [textEvent("a"), textEvent("b")]);
    scheduler.enqueueMany("session-2", [textEvent("c")]);
    scheduler.flushNow("session-1");
    drainFrames(callbacks);

    expect(applied.map((batch) => batch.sessionId)).toEqual(["session-1", "session-2"]);
    expect(
      applied.map((batch) =>
        batch.events
          .map((event) => (event.type === "TEXT_MESSAGE_CONTENT" ? event.delta : ""))
          .join(""),
      ),
    ).toEqual(["ab", "c"]);
  });

  test("does not scan the text budget for non-text backlogs", () => {
    const { callbacks, getNowCalls, host } = createManualFrameHost();
    let applied = 0;
    const scheduler = new SessionStreamRenderScheduler((_sessionId, events) => {
      applied += events.length;
      return true;
    }, host);

    scheduler.enqueueMany(
      "session-1",
      Array.from({ length: 500 }, () => stateDeltaEvent()),
    );

    expect(getNowCalls()).toBe(1);

    drainFrames(callbacks);

    expect(applied).toBe(500);
    expect(getNowCalls()).toBe(1);
  });

  test("requeues a failed partial text slice without losing content", () => {
    const { callbacks, host } = createManualFrameHost();
    const content = "x".repeat(1300);
    const appliedDeltas: string[] = [];
    let rejectNextBatch = true;
    const scheduler = new SessionStreamRenderScheduler((_sessionId, events) => {
      if (rejectNextBatch) {
        rejectNextBatch = false;
        return false;
      }

      for (const event of events) {
        if (event.type === "TEXT_MESSAGE_CONTENT") {
          appliedDeltas.push(event.delta);
        }
      }

      return true;
    }, host);

    scheduler.enqueueMany("session-1", [textEvent(content)]);
    drainFrames(callbacks);

    expect(rejectNextBatch).toBe(false);
    expect(appliedDeltas.join("")).toBe(content);
  });
});
