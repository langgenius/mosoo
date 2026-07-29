import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

interface QueuedSessionEvent {
  event: AgUiSessionEvent;
  sessionId: string;
}

export interface SessionStreamRenderSchedulerHost {
  cancelFrame: (handle: number) => void;
  cancelTimeout: (handle: number) => void;
  requestFrame: (callback: () => void) => number;
  requestTimeout: (callback: () => void, delayMs: number) => number;
}

export type SessionStreamRenderSchedulerApply = (
  targetSessionId: string,
  events: AgUiSessionEvent[],
) => boolean;

// Flood guard only: bounds a single React commit during pathological event
// storms. Everything queued for the session is otherwise delivered on the
// next frame — requestAnimationFrame batching is the smoothing; an artificial
// per-frame character budget just throttles visible streaming.
const MAX_EVENTS_PER_FRAME = 512;

// requestAnimationFrame stops firing when the window is hidden, occluded, or
// battery-throttled. Without a timer fallback the queue silently starves and
// the transcript freezes while the socket keeps receiving events.
const THROTTLED_FRAME_FALLBACK_MS = 50;

function createBrowserFrameSchedulerHost(): SessionStreamRenderSchedulerHost {
  return {
    cancelFrame: (handle) => {
      globalThis.cancelAnimationFrame(handle);
    },
    cancelTimeout: (handle) => {
      globalThis.clearTimeout(handle);
    },
    requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
    requestTimeout: (callback, delayMs) =>
      globalThis.setTimeout(callback, delayMs) as unknown as number,
  };
}

export class SessionStreamRenderScheduler {
  readonly #apply: SessionStreamRenderSchedulerApply;
  #frameHandle: number | null = null;
  readonly #host: SessionStreamRenderSchedulerHost;
  #queue: QueuedSessionEvent[] = [];
  #queueOffset = 0;
  #timeoutHandle: number | null = null;

  public constructor(
    apply: SessionStreamRenderSchedulerApply,
    host: SessionStreamRenderSchedulerHost = createBrowserFrameSchedulerHost(),
  ) {
    this.#apply = apply;
    this.#host = host;
  }

  public clear(): void {
    this.#cancelPending();
    this.#queue = [];
    this.#queueOffset = 0;
  }

  public enqueue(sessionId: string, event: AgUiSessionEvent): void {
    this.enqueueMany(sessionId, [event]);
  }

  public enqueueMany(sessionId: string, events: AgUiSessionEvent[]): void {
    if (events.length === 0) {
      return;
    }

    for (const event of events) {
      this.#queue.push({
        event,
        sessionId,
      });
    }

    this.#schedule();
  }

  public flushNow(sessionId: string): void {
    this.#cancelPending();

    const events: AgUiSessionEvent[] = [];
    const remaining: QueuedSessionEvent[] = [];

    for (let index = this.#queueOffset; index < this.#queue.length; index += 1) {
      const item = this.#queue[index];

      if (!item) {
        continue;
      }

      if (item.sessionId === sessionId) {
        events.push(item.event);
      } else {
        remaining.push(item);
      }
    }

    this.#queue = remaining;
    this.#queueOffset = 0;

    if (events.length > 0) {
      if (!this.#apply(sessionId, events)) {
        this.#queue = [
          ...events.map((event) => ({
            event,
            sessionId,
          })),
          ...this.#queue,
        ];
        this.#queueOffset = 0;
      }
    }

    this.#schedule();
  }

  #cancelPending(): void {
    if (this.#frameHandle !== null) {
      this.#host.cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }

    if (this.#timeoutHandle !== null) {
      this.#host.cancelTimeout(this.#timeoutHandle);
      this.#timeoutHandle = null;
    }
  }

  #schedule(): void {
    if (this.#frameHandle !== null || this.#timeoutHandle !== null || this.#queue.length === 0) {
      return;
    }

    const drain = () => {
      this.#cancelPending();
      this.#drainFrame();
    };

    this.#frameHandle = this.#host.requestFrame(drain);
    this.#timeoutHandle = this.#host.requestTimeout(drain, THROTTLED_FRAME_FALLBACK_MS);
  }

  #drainFrame(): void {
    const batch = this.#takeFrameBatch();

    if (batch && batch.events.length > 0 && !this.#apply(batch.sessionId, batch.events)) {
      this.#queue = [
        ...batch.events.map((event) => ({
          event,
          sessionId: batch.sessionId,
        })),
        ...this.#queue.slice(this.#queueOffset),
      ];
      this.#queueOffset = 0;
    }

    this.#schedule();
  }

  #compactConsumedQueue(): void {
    if (this.#queueOffset === 0) {
      return;
    }

    if (this.#queueOffset >= this.#queue.length) {
      this.#queue = [];
      this.#queueOffset = 0;
      return;
    }

    if (
      this.#queueOffset >= MAX_EVENTS_PER_FRAME * 4 &&
      this.#queueOffset * 2 >= this.#queue.length
    ) {
      this.#queue = this.#queue.slice(this.#queueOffset);
      this.#queueOffset = 0;
    }
  }

  #takeFrameBatch(): {
    events: AgUiSessionEvent[];
    sessionId: string;
  } | null {
    const first = this.#queue[this.#queueOffset];

    if (!first) {
      this.#compactConsumedQueue();
      return null;
    }

    const { sessionId } = first;
    const events: AgUiSessionEvent[] = [];
    let nextQueueOffset = this.#queueOffset;

    while (nextQueueOffset < this.#queue.length && events.length < MAX_EVENTS_PER_FRAME) {
      const item = this.#queue[nextQueueOffset];

      if (!item || item.sessionId !== sessionId) {
        break;
      }

      events.push(item.event);
      nextQueueOffset += 1;
    }

    this.#queueOffset = nextQueueOffset;
    this.#compactConsumedQueue();

    return { events, sessionId };
  }
}
