import { describe, expect, test } from "bun:test";

import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import type { SessionStreamRenderSchedulerHost } from "../src/domains/runtime/session-stream/session-stream-render-scheduler";
import { SessionStreamRenderScheduler } from "../src/domains/runtime/session-stream/session-stream-render-scheduler";

function createManualHost(): {
  frameCallbacks: (() => void)[];
  host: SessionStreamRenderSchedulerHost;
  timeoutCallbacks: (() => void)[];
} {
  const frameCallbacks: (() => void)[] = [];
  const timeoutCallbacks: (() => void)[] = [];

  return {
    frameCallbacks,
    host: {
      cancelFrame: () => {},
      cancelTimeout: () => {},
      requestFrame: (callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      },
      requestTimeout: (callback) => {
        timeoutCallbacks.push(callback);
        return timeoutCallbacks.length;
      },
    },
    timeoutCallbacks,
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
  test("delivers every queued text chunk unthrottled and in order", () => {
    const { frameCallbacks, host } = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((_sessionId, events) => {
      batches.push(events);
      return true;
    }, host);
    const events = Array.from({ length: 600 }, (_unused, index) => textEvent(`chunk-${index}`));

    scheduler.enqueueMany("session-1", events);
    drainFrames(frameCallbacks);

    // 600 events exceed one frame's flood guard, never more than two frames.
    expect(batches.length).toBe(2);
    expect(
      batches.flat().map((event) => (event.type === "TEXT_MESSAGE_CONTENT" ? event.delta : "")),
    ).toEqual(events.map((event) => (event.type === "TEXT_MESSAGE_CONTENT" ? event.delta : "")));
  });

  test("keeps another session queued while flushing the first session", () => {
    const { frameCallbacks, host } = createManualHost();
    const applied: { events: AgUiSessionEvent[]; sessionId: string }[] = [];
    const scheduler = new SessionStreamRenderScheduler((sessionId, events) => {
      applied.push({ events, sessionId });
      return true;
    }, host);

    scheduler.enqueueMany("session-1", [textEvent("a"), textEvent("b")]);
    scheduler.enqueueMany("session-2", [textEvent("c")]);
    scheduler.flushNow("session-1");
    drainFrames(frameCallbacks);

    expect(applied.map((batch) => batch.sessionId)).toEqual(["session-1", "session-2"]);
    expect(
      applied.map((batch) =>
        batch.events
          .map((event) => (event.type === "TEXT_MESSAGE_CONTENT" ? event.delta : ""))
          .join(""),
      ),
    ).toEqual(["ab", "c"]);
  });

  test("delivers mixed event types in arrival order", () => {
    const { frameCallbacks, host } = createManualHost();
    const types: string[] = [];
    const scheduler = new SessionStreamRenderScheduler((_sessionId, events) => {
      for (const event of events) {
        types.push(event.type);
      }
      return true;
    }, host);

    scheduler.enqueueMany("session-1", [textEvent("a"), stateDeltaEvent(), textEvent("b")]);
    drainFrames(frameCallbacks);

    expect(types).toEqual(["TEXT_MESSAGE_CONTENT", "STATE_DELTA", "TEXT_MESSAGE_CONTENT"]);
  });

  test("requeues a rejected batch without losing content", () => {
    const { frameCallbacks, host } = createManualHost();
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

    scheduler.enqueueMany("session-1", [textEvent("x".repeat(1300))]);
    drainFrames(frameCallbacks);

    expect(rejectNextBatch).toBe(false);
    expect(appliedDeltas.join("")).toBe("x".repeat(1300));
  });

  test("drains through the timeout fallback when frames never fire", () => {
    const { host, timeoutCallbacks } = createManualHost();
    const appliedDeltas: string[] = [];
    const scheduler = new SessionStreamRenderScheduler((_sessionId, events) => {
      for (const event of events) {
        if (event.type === "TEXT_MESSAGE_CONTENT") {
          appliedDeltas.push(event.delta);
        }
      }
      return true;
    }, host);

    scheduler.enqueueMany("session-1", [textEvent("hidden"), textEvent("window")]);
    // requestAnimationFrame is throttled or paused: only the timer fires.
    drainFrames(timeoutCallbacks);

    expect(appliedDeltas).toEqual(["hidden", "window"]);
  });
});
