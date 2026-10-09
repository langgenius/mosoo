import { describe, expect, test } from "bun:test";

import { createServerCustomEvent, MOSOO_CUSTOM_EVENT } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import type { SessionStreamRenderSchedulerHost } from "../src/domains/runtime/session-stream/session-stream-render-scheduler";
import { SessionStreamRenderScheduler } from "../src/domains/runtime/session-stream/session-stream-render-scheduler";

const FRAME_MS = 16;

interface ManualHost {
  advance: (deltaMs: number) => void;
  fireFrame: (deltaMs?: number) => boolean;
  fireTimeout: (deltaMs?: number) => boolean;
  host: SessionStreamRenderSchedulerHost;
}

function createManualHost(): ManualHost {
  let now = 0;
  let nextHandle = 0;
  const frames = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();

  const fireNext = (callbacks: Map<number, () => void>, deltaMs: number): boolean => {
    now += deltaMs;
    const first = callbacks.entries().next();

    if (first.done) {
      return false;
    }

    callbacks.delete(first.value[0]);
    first.value[1]();
    return true;
  };

  return {
    advance: (deltaMs) => {
      now += deltaMs;
    },
    fireFrame: (deltaMs = FRAME_MS) => fireNext(frames, deltaMs),
    fireTimeout: (deltaMs = 50) => fireNext(timeouts, deltaMs),
    host: {
      cancelFrame: (handle) => {
        frames.delete(handle);
      },
      cancelTimeout: (handle) => {
        timeouts.delete(handle);
      },
      now: () => now,
      requestFrame: (callback) => {
        nextHandle += 1;
        frames.set(nextHandle, callback);
        return nextHandle;
      },
      requestTimeout: (callback) => {
        nextHandle += 1;
        timeouts.set(nextHandle, callback);
        return nextHandle;
      },
    },
  };
}

function drainFrames(manual: ManualHost, deltaMs = FRAME_MS, limit = 10_000): number {
  let fired = 0;

  while (manual.fireFrame(deltaMs)) {
    fired += 1;

    if (fired > limit) {
      throw new Error("Frame drain did not settle.");
    }
  }

  return fired;
}

function textEvent(delta: string, messageId = "message-1"): AgUiSessionEvent {
  return {
    delta,
    messageId,
    type: "TEXT_MESSAGE_CONTENT",
  };
}

function textEndEvent(messageId = "message-1"): AgUiSessionEvent {
  return {
    messageId,
    type: "TEXT_MESSAGE_END",
  };
}

function toolStartEvent(): AgUiSessionEvent {
  return {
    parentMessageId: "message-1",
    toolCallId: "tool-1",
    toolCallName: "Shell",
    type: "TOOL_CALL_START",
  };
}

function eventText(event: AgUiSessionEvent): string {
  if (event.type === "REASONING_MESSAGE_CONTENT" || event.type === "TEXT_MESSAGE_CONTENT") {
    return event.delta;
  }

  if (event.type === "TEXT_MESSAGE_CHUNK") {
    return event.delta ?? "";
  }

  return "";
}

function batchText(events: AgUiSessionEvent[]): string {
  return events.map(eventText).join("");
}

describe("session stream render scheduler", () => {
  test("paces a mid-stream batch across frames instead of one jump", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const text = "x".repeat(1000);

    scheduler.enqueueMany([textEvent(text)]);
    const frames = drainFrames(manual);

    // 800 graphemes/s at 16ms frames is 12-13 graphemes per frame.
    expect(frames).toBeGreaterThan(70);
    expect(batches.every((events) => batchText(events).length <= 13)).toBe(true);
    expect(batches.map(batchText).join("")).toBe(text);
  });

  test("delivers a batch that already ends the message without pacing", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const text = "x".repeat(1000);

    scheduler.enqueueMany([textEvent(text), textEndEvent()]);
    drainFrames(manual);

    expect(batches.length).toBe(1);
    expect(batches[0]?.length).toBe(2);
    expect(batchText(batches[0] ?? [])).toBe(text);
  });

  test("flushes the paced tail as soon as the end event arrives", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const text = "x".repeat(1000);

    scheduler.enqueueMany([textEvent(text)]);
    manual.fireFrame();
    manual.fireFrame();
    expect(batches.map(batchText).join("").length).toBeLessThan(30);

    scheduler.enqueueMany([textEndEvent()]);
    manual.fireFrame();

    expect(batches.length).toBe(3);
    expect(batches[2]?.at(-1)?.type).toBe("TEXT_MESSAGE_END");
    expect(batches.map(batchText).join("")).toBe(text);
  });

  test("run terminal events dump pending text immediately", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const text = "x".repeat(1000);

    scheduler.enqueueMany([
      textEvent(text),
      createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionRunUpdated.name, {
        lifecycle: "IDLE",
        run: {
          completedAt: null,
          error: null,
          id: "run-1",
          startedAt: null,
          status: "failed",
          traceId: null,
        },
      }),
    ]);
    drainFrames(manual);

    expect(batches.length).toBe(1);
    expect(batchText(batches[0] ?? [])).toBe(text);
  });

  test("state snapshots from reconnect catch-up are never animated", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);

    scheduler.enqueueMany([textEvent("x".repeat(500)), { snapshot: {}, type: "STATE_SNAPSHOT" }]);
    drainFrames(manual);

    expect(batches.length).toBe(1);
    expect(batches[0]?.length).toBe(2);
  });

  test("dumps the whole backlog once it outgrows the pacing window", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const text = "x".repeat(5000);

    scheduler.enqueueMany([textEvent(text)]);
    manual.fireFrame();

    expect(batches.length).toBe(1);
    expect(batchText(batches[0] ?? [])).toBe(text);
  });

  test("splits only at grapheme cluster boundaries", () => {
    const manual = createManualHost();
    const pieces: string[] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      pieces.push(batchText(events));
    }, manual.host);
    const family = "👨‍👩‍👧‍👦";
    const text = family.repeat(40);

    scheduler.enqueueMany([textEvent(text)]);
    const frames = drainFrames(manual);

    expect(frames).toBeGreaterThan(5);
    expect(pieces.join("")).toBe(text);

    for (const piece of pieces) {
      expect(piece.isWellFormed()).toBe(true);
      expect(new RegExp(`^(?:${family})*$`, "u").test(piece)).toBe(true);
    }
  });

  test("keeps a tiny tail moving through the minimum rate floor", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);

    scheduler.enqueueMany([textEvent("abc")]);
    manual.fireFrame();
    manual.fireFrame();
    manual.fireFrame();

    // 20 graphemes/s at 16ms frames stays below one grapheme for three frames.
    expect(batches.length).toBe(0);

    const frames = drainFrames(manual);

    expect(frames).toBeLessThanOrEqual(12);
    expect(batches.map(batchText).join("")).toBe("abc");
  });

  test("streams at the same visible speed on 60Hz and 120Hz displays", () => {
    const run = (frameMs: number, frameCount: number): number => {
      const manual = createManualHost();
      let delivered = "";
      const scheduler = new SessionStreamRenderScheduler((events) => {
        delivered += batchText(events);
      }, manual.host);

      scheduler.enqueueMany([textEvent("x".repeat(100))]);

      for (let index = 0; index < frameCount; index += 1) {
        manual.fireFrame(frameMs);
      }

      return delivered.length;
    };

    const at60Hz = run(16, 10);
    const at120Hz = run(8, 20);

    expect(Math.abs(at60Hz - at120Hz)).toBeLessThanOrEqual(2);
  });

  test("non-text events pass through but never overtake paced text", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const text = "x".repeat(200);

    scheduler.enqueueMany([toolStartEvent(), textEvent(text), toolStartEvent()]);
    drainFrames(manual);

    // The leading tool start rides the first frame; the trailing one may only
    // arrive after every queued character.
    expect(batches[0]?.[0]?.type).toBe("TOOL_CALL_START");
    const flat = batches.flat();
    expect(flat.at(-1)?.type).toBe("TOOL_CALL_START");
    expect(batchText(flat)).toBe(text);
  });

  test("split chunk remainders drop the role so replays cannot reset the message", () => {
    const manual = createManualHost();
    const chunks: AgUiSessionEvent[] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      chunks.push(...events);
    }, manual.host);
    const text = "x".repeat(600);

    scheduler.enqueueMany([
      { delta: text, messageId: "message-1", role: "assistant", type: "TEXT_MESSAGE_CHUNK" },
    ]);
    drainFrames(manual);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.type === "TEXT_MESSAGE_CHUNK" && chunks[0].role).toBe("assistant");

    for (const chunk of chunks.slice(1)) {
      expect(chunk.type === "TEXT_MESSAGE_CHUNK" && "role" in chunk).toBe(false);
    }

    expect(batchText(chunks)).toBe(text);
  });

  test("delivers user chunks atomically instead of pacing the server echo", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const event = {
      delta: "用户发送的内容",
      messageId: "message-user",
      role: "user",
      type: "TEXT_MESSAGE_CHUNK",
    } as const satisfies AgUiSessionEvent;

    scheduler.enqueueMany([event]);
    manual.fireFrame();

    expect(batches).toEqual([[event]]);
    expect(drainFrames(manual)).toBe(0);
  });

  test("delivers user start/content events atomically instead of pacing the server echo", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const events = [
      { messageId: "message-user", role: "user", type: "TEXT_MESSAGE_START" },
      textEvent("用".repeat(1000), "message-user"),
    ] as const satisfies readonly AgUiSessionEvent[];

    scheduler.enqueueMany([...events]);
    manual.fireFrame();

    expect(batches).toEqual([[...events]]);
    expect(drainFrames(manual)).toBe(0);
  });

  test("flushNow delivers the paced remainder exactly once", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const text = "x".repeat(1000);

    scheduler.enqueueMany([textEvent(text)]);
    manual.fireFrame();
    manual.fireFrame();
    scheduler.flushNow();

    expect(batches.map(batchText).join("")).toBe(text);
    expect(drainFrames(manual)).toBe(0);
  });

  test("does not burst after an idle gap", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);

    scheduler.enqueueMany([textEvent("abc"), textEndEvent()]);
    drainFrames(manual);
    expect(batches.length).toBe(1);

    manual.advance(60_000);
    scheduler.enqueueMany([textEvent("x".repeat(1000))]);
    manual.fireFrame();

    expect(batchText(batches[1] ?? []).length).toBeLessThanOrEqual(13);
  });

  test("drains through the timeout fallback when frames never fire", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const text = "x".repeat(200);

    scheduler.enqueueMany([textEvent(text)]);

    let ticks = 0;

    while (manual.fireTimeout(50)) {
      ticks += 1;

      if (ticks > 100) {
        throw new Error("Timeout drain did not settle.");
      }
    }

    expect(ticks).toBeGreaterThan(3);
    expect(batches.map(batchText).join("")).toBe(text);
  });

  test("delivers a finished stream through the flood guard in arrival order", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const events = Array.from({ length: 600 }, (_unused, index) => textEvent(`chunk-${index}`));

    scheduler.enqueueMany([...events, textEndEvent()]);
    drainFrames(manual);

    // 601 events exceed one frame's flood guard, never more than two frames.
    expect(batches.length).toBe(2);
    expect(batches.flat().map(eventText).join("")).toBe(events.map(eventText).join(""));
  });

  test("flushes only undelivered events after a partial frame drain", () => {
    const manual = createManualHost();
    const batches: AgUiSessionEvent[][] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      batches.push(events);
    }, manual.host);
    const events = Array.from({ length: 600 }, (_unused, index) => textEvent(`chunk-${index}`));

    scheduler.enqueueMany([...events, textEndEvent()]);
    manual.fireFrame();
    scheduler.flushNow();

    expect(batches.map((batch) => batch.length)).toEqual([512, 89]);
    expect(batches.flat().map(eventText).join("")).toBe(events.map(eventText).join(""));
    expect(drainFrames(manual)).toBe(0);
  });

  test("delivers mixed event types in arrival order", () => {
    const manual = createManualHost();
    const types: string[] = [];
    const scheduler = new SessionStreamRenderScheduler((events) => {
      for (const event of events) {
        types.push(event.type);
      }
    }, manual.host);

    scheduler.enqueueMany([textEvent("a"), toolStartEvent(), textEvent("b"), textEndEvent()]);
    drainFrames(manual);

    expect(types).toEqual([
      "TEXT_MESSAGE_CONTENT",
      "TOOL_CALL_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
    ]);
  });
});
