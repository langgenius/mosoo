import type { AgUiSessionEvent, TextMessageContentEvent } from "@mosoo/ag-ui-session";

interface QueuedSessionEvent {
  enqueuedAt: number;
  event: AgUiSessionEvent;
  sessionId: string;
}

export interface SessionStreamRenderSchedulerHost {
  cancelFrame: (handle: number) => void;
  now: () => number;
  requestFrame: (callback: () => void) => number;
}

export type SessionStreamRenderSchedulerApply = (
  targetSessionId: string,
  events: AgUiSessionEvent[],
) => boolean;

const SMOOTH_TEXT_CHARS_PER_FRAME = 24;
const CATCH_UP_TEXT_CHARS_PER_FRAME = 96;
const SURGE_TEXT_CHARS_PER_FRAME = 256;
const CATCH_UP_TEXT_QUEUE_CHARS = 320;
const SURGE_TEXT_QUEUE_CHARS = 1200;
const CATCH_UP_OLDEST_TEXT_MS = 300;
const SURGE_OLDEST_TEXT_MS = 900;
const MAX_IMMEDIATE_EVENTS_PER_FRAME = 160;
const MIN_SEMANTIC_SLICE_CHARS = 4;
const PREFERRED_TEXT_BOUNDARIES = new Set([
  "\n",
  "\r",
  "\t",
  " ",
  ",",
  ".",
  "!",
  "?",
  ";",
  ":",
  ")",
  "]",
  "}",
  "，",
  "。",
  "！",
  "？",
  "；",
  "：",
  "、",
  "）",
  "】",
  "》",
]);

function createBrowserFrameSchedulerHost(): SessionStreamRenderSchedulerHost {
  return {
    cancelFrame: (handle) => {
      globalThis.cancelAnimationFrame(handle);
    },
    now: () => performance.now(),
    requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
  };
}

function isTextContentEvent(event: AgUiSessionEvent): event is TextMessageContentEvent {
  return event.type === "TEXT_MESSAGE_CONTENT";
}

function sliceTextContentEvent(
  event: TextMessageContentEvent,
  budget: number,
): {
  consumed: TextMessageContentEvent;
  remaining: TextMessageContentEvent | null;
} {
  const sliceLength = preferredTextSliceLength(event.delta, budget);
  const consumedDelta = event.delta.slice(0, sliceLength);
  const remainingDelta = event.delta.slice(sliceLength);

  return {
    consumed: { ...event, delta: consumedDelta },
    remaining: remainingDelta.length > 0 ? { ...event, delta: remainingDelta } : null,
  };
}

function preferredTextSliceLength(delta: string, budget: number): number {
  if (delta.length <= budget) {
    return delta.length;
  }

  const hardEnd = codePointSliceEnd(delta, budget);
  const minSemanticEnd = Math.min(hardEnd, MIN_SEMANTIC_SLICE_CHARS);

  for (let index = hardEnd; index >= minSemanticEnd; index -= 1) {
    if (PREFERRED_TEXT_BOUNDARIES.has(delta.charAt(index - 1))) {
      return index;
    }
  }

  return hardEnd;
}

function codePointSliceEnd(text: string, budget: number): number {
  let end = 0;

  for (const character of text) {
    const nextEnd = end + character.length;

    if (nextEnd > budget) {
      return end > 0 ? end : nextEnd;
    }

    end = nextEnd;
  }

  return text.length;
}

export class SessionStreamRenderScheduler {
  readonly #apply: SessionStreamRenderSchedulerApply;
  #frameHandle: number | null = null;
  readonly #host: SessionStreamRenderSchedulerHost;
  #queue: QueuedSessionEvent[] = [];

  public constructor(
    apply: SessionStreamRenderSchedulerApply,
    host: SessionStreamRenderSchedulerHost = createBrowserFrameSchedulerHost(),
  ) {
    this.#apply = apply;
    this.#host = host;
  }

  public clear(): void {
    if (this.#frameHandle !== null) {
      this.#host.cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }

    this.#queue = [];
  }

  public enqueue(sessionId: string, event: AgUiSessionEvent): void {
    this.enqueueMany(sessionId, [event]);
  }

  public enqueueMany(sessionId: string, events: AgUiSessionEvent[]): void {
    if (events.length === 0) {
      return;
    }

    const enqueuedAt = this.#host.now();

    for (const event of events) {
      this.#queue.push({
        enqueuedAt,
        event,
        sessionId,
      });
    }

    this.#schedule();
  }

  public flushNow(sessionId: string): void {
    if (this.#frameHandle !== null) {
      this.#host.cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }

    const events: AgUiSessionEvent[] = [];
    const remaining: QueuedSessionEvent[] = [];

    for (const item of this.#queue) {
      if (item.sessionId === sessionId) {
        events.push(item.event);
      } else {
        remaining.push(item);
      }
    }

    this.#queue = remaining;

    if (events.length > 0) {
      if (!this.#apply(sessionId, events)) {
        this.#queue = [
          ...events.map((event) => ({
            enqueuedAt: this.#host.now(),
            event,
            sessionId,
          })),
          ...this.#queue,
        ];
      }
    }

    this.#schedule();
  }

  #schedule(): void {
    if (this.#frameHandle !== null || this.#queue.length === 0) {
      return;
    }

    this.#frameHandle = this.#host.requestFrame(() => {
      this.#frameHandle = null;
      this.#drainFrame();
    });
  }

  #drainFrame(): void {
    const batch = this.#takeFrameBatch();

    if (batch && batch.events.length > 0 && !this.#apply(batch.sessionId, batch.events)) {
      this.#queue = [
        ...batch.events.map((event) => ({
          enqueuedAt: this.#host.now(),
          event,
          sessionId: batch.sessionId,
        })),
        ...this.#queue,
      ];
    }

    this.#schedule();
  }

  #takeFrameBatch(): {
    events: AgUiSessionEvent[];
    sessionId: string;
  } | null {
    const first = this.#queue[0];

    if (!first) {
      return null;
    }

    const { sessionId } = first;
    const events: AgUiSessionEvent[] = [];
    let textBudget: number | null = null;
    let immediateEvents = 0;
    let consumedQueueItems = 0;

    while (consumedQueueItems < this.#queue.length) {
      const item = this.#queue[consumedQueueItems];

      if (!item || item.sessionId !== sessionId) {
        break;
      }

      if (isTextContentEvent(item.event)) {
        if (item.event.delta.length === 0) {
          consumedQueueItems += 1;
          continue;
        }

        textBudget ??= this.#textBudgetForSession(sessionId);

        if (textBudget <= 0) {
          break;
        }

        const sliced = sliceTextContentEvent(item.event, textBudget);
        events.push(sliced.consumed);
        textBudget -= sliced.consumed.delta.length;

        if (sliced.remaining) {
          this.#queue[consumedQueueItems] = {
            ...item,
            event: sliced.remaining,
          };
          break;
        }

        consumedQueueItems += 1;
        continue;
      }

      events.push(item.event);
      consumedQueueItems += 1;
      immediateEvents += 1;

      if (immediateEvents >= MAX_IMMEDIATE_EVENTS_PER_FRAME && events.length > 0) {
        break;
      }
    }

    if (consumedQueueItems > 0) {
      this.#queue.splice(0, consumedQueueItems);
    }

    return { events, sessionId };
  }

  #textBudgetForSession(sessionId: string): number {
    const now = this.#host.now();
    let oldestTextAge = 0;
    let queuedTextChars = 0;

    for (const item of this.#queue) {
      if (item.sessionId !== sessionId || !isTextContentEvent(item.event)) {
        continue;
      }

      queuedTextChars += item.event.delta.length;
      oldestTextAge = Math.max(oldestTextAge, now - item.enqueuedAt);

      if (queuedTextChars >= SURGE_TEXT_QUEUE_CHARS || oldestTextAge >= SURGE_OLDEST_TEXT_MS) {
        return SURGE_TEXT_CHARS_PER_FRAME;
      }
    }

    if (queuedTextChars >= CATCH_UP_TEXT_QUEUE_CHARS || oldestTextAge >= CATCH_UP_OLDEST_TEXT_MS) {
      return CATCH_UP_TEXT_CHARS_PER_FRAME;
    }

    return SMOOTH_TEXT_CHARS_PER_FRAME;
  }
}
