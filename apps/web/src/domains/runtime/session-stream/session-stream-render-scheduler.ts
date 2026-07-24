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
            event,
            sessionId,
          })),
          ...this.#queue,
        ];
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
    let consumedQueueItems = 0;

    while (consumedQueueItems < this.#queue.length && events.length < MAX_EVENTS_PER_FRAME) {
      const item = this.#queue[consumedQueueItems];

      if (!item || item.sessionId !== sessionId) {
        break;
      }

      events.push(item.event);
      consumedQueueItems += 1;
    }

    if (consumedQueueItems > 0) {
      this.#queue.splice(0, consumedQueueItems);
    }

    return { events, sessionId };
  }
}
