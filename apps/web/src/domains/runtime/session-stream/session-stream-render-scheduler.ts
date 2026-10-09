import { isAgUiSessionRunTerminalEvent } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

interface QueuedSessionEvent {
  event: AgUiSessionEvent;
  // Grapheme clusters of a paceable text delta, precomputed at enqueue time so
  // per-frame budgeting is O(pending items). Null for events pacing ignores.
  segments: string[] | null;
}

export interface SessionStreamRenderSchedulerHost {
  cancelFrame: (handle: number) => void;
  cancelTimeout: (handle: number) => void;
  now: () => number;
  requestFrame: (callback: () => void) => number;
  requestTimeout: (callback: () => void, delayMs: number) => number;
}

export type SessionStreamRenderSchedulerApply = (events: AgUiSessionEvent[]) => void;

// Flood guard: bounds a single React commit during pathological event storms.
const MAX_EVENTS_PER_FRAME = 512;

// requestAnimationFrame stops firing when the window is hidden, occluded, or
// battery-throttled. Without a timer fallback the queue silently starves and
// the transcript freezes while the socket keeps receiving events.
const THROTTLED_FRAME_FALLBACK_MS = 50;

// The server publishes one viewer message per committed Driver event batch
// (apps/api rpc-event-ingestion-controller.ts), so one websocket message can
// carry hundreds of characters and rendering it in a single frame shows one
// visible jump per batch. Pacing spreads queued text across frames instead:
// each frame emits pending * dt / τ graphemes, an exponential drain with time
// constant τ. With τ ≈ 250ms a batch is still draining when the next one
// lands, so batch jumps fuse into continuous flow while on-screen text lags
// the socket by at most ~τ.
const PACING_TIME_CONSTANT_MS = 250;

// Rate clamps: never crawl below 20 graphemes/s on a tiny tail, never animate
// faster than 800 graphemes/s (beyond that it reads as a jump anyway). Both
// scale with real elapsed time, so 60Hz and 120Hz displays stream at the same
// visible speed and the timeout fallback keeps the same pace in hidden tabs.
const MIN_PACED_GRAPHEMES_PER_SECOND = 20;
const MAX_PACED_GRAPHEMES_PER_SECOND = 800;

// Backpressure valve: a backlog the max rate cannot drain within ~5s means the
// producer is far ahead of the animation (very fast model, long throttled
// pause). Deliver it whole rather than showing seconds-stale text.
const MAX_PENDING_PACED_GRAPHEMES = 4096;

// Split points must land on grapheme boundaries: slicing UTF-16 text at an
// arbitrary index can cut a surrogate pair or ZWJ emoji in half and render �.
// Without Intl.Segmenter, code-point iteration still keeps surrogate pairs
// intact; only multi-code-point clusters (ZWJ emoji, flags) may split.
function createGraphemeSegmenter(): (text: string) => string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return (text) => Array.from(segmenter.segment(text), (part) => part.segment);
  }

  return (text) => Array.from(text);
}

const segmentGraphemes = createGraphemeSegmenter();

// Only visible streaming text is paced. Tool-call args and lifecycle events
// pass through so pacing never delays structural updates.
function getPaceableTextDelta(
  event: AgUiSessionEvent,
  messageRole: "assistant" | "user" | undefined,
): string | null {
  if (event.type === "REASONING_MESSAGE_CONTENT" || event.type === "TEXT_MESSAGE_CONTENT") {
    if (event.type === "TEXT_MESSAGE_CONTENT" && messageRole === "user") {
      return null;
    }

    return event.delta.length > 0 ? event.delta : null;
  }

  if (event.type === "TEXT_MESSAGE_CHUNK") {
    if (event.role === "user") {
      return null;
    }

    return typeof event.delta === "string" && event.delta.length > 0 ? event.delta : null;
  }

  return null;
}

// Pacing applies only while a stream is visibly in flight. Once the queue
// holds proof that a stream segment finished — an END event, a run terminal
// event, or a snapshot that replaces state wholesale (reconnect catch-up) —
// everything up to that point is delivered unpaced: animating text the server
// already finished would only delay the settled state, and snapshot replays
// must never be animated.
const PACING_BARRIER_EVENT_TYPES = new Set<string>([
  "REASONING_MESSAGE_END",
  "STATE_SNAPSHOT",
  "TEXT_MESSAGE_END",
]);

function isPacingBarrierEvent(event: AgUiSessionEvent): boolean {
  return PACING_BARRIER_EVENT_TYPES.has(event.type) || isAgUiSessionRunTerminalEvent(event);
}

function withTextDelta(
  event: AgUiSessionEvent,
  delta: string,
  isRemainder: boolean,
): AgUiSessionEvent {
  if (event.type === "REASONING_MESSAGE_CONTENT" || event.type === "TEXT_MESSAGE_CONTENT") {
    return { ...event, delta };
  }

  if (event.type === "TEXT_MESSAGE_CHUNK") {
    if (!isRemainder) {
      return { ...event, delta };
    }

    // A chunk carrying a role upserts a blank message before appending (see
    // live-state.reducer.ts), so the remainder of a split chunk must not
    // repeat the role or it would wipe the text the head part just delivered.
    const { name: _name, role: _role, ...rest } = event;
    return { ...rest, delta };
  }

  return event;
}

function createBrowserFrameSchedulerHost(): SessionStreamRenderSchedulerHost {
  return {
    cancelFrame: (handle) => {
      globalThis.cancelAnimationFrame(handle);
    },
    cancelTimeout: (handle) => {
      globalThis.clearTimeout(handle);
    },
    now: () => globalThis.performance.now(),
    requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
    requestTimeout: (callback, delayMs) =>
      globalThis.setTimeout(callback, delayMs) as unknown as number,
  };
}

export class SessionStreamRenderScheduler {
  readonly #apply: SessionStreamRenderSchedulerApply;
  #frameHandle: number | null = null;
  readonly #host: SessionStreamRenderSchedulerHost;
  #lastDrainAt: number | null = null;
  readonly #messageRoles = new Map<string, "assistant" | "user">();
  #pacingCarry = 0;
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
    this.#lastDrainAt = null;
    this.#messageRoles.clear();
    this.#pacingCarry = 0;
  }

  public enqueueMany(events: AgUiSessionEvent[]): void {
    for (const event of events) {
      if (
        event.type === "TEXT_MESSAGE_START" &&
        (event.role === "assistant" || event.role === "user")
      ) {
        this.#messageRoles.set(event.messageId, event.role);
      }

      this.#queue.push(this.#toQueueItem(event));

      if (event.type === "TEXT_MESSAGE_END") {
        this.#messageRoles.delete(event.messageId);
      }
    }

    this.#schedule();
  }

  public flushNow(): void {
    this.#cancelPending();

    const events = this.#queue.map((item) => item.event);

    this.#queue = [];
    this.#lastDrainAt = null;
    this.#pacingCarry = 0;

    if (events.length > 0) {
      this.#apply(events);
    }
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

    // Idle → active: baseline pacing time at enqueue so the first frame sees
    // one frame's worth of elapsed time, not the whole idle gap.
    this.#lastDrainAt ??= this.#host.now();

    const drain = () => {
      this.#cancelPending();
      this.#drainFrame();
    };

    this.#frameHandle = this.#host.requestFrame(drain);
    this.#timeoutHandle = this.#host.requestTimeout(drain, THROTTLED_FRAME_FALLBACK_MS);
  }

  #drainFrame(): void {
    const events = this.#takeFrameBatch();

    if (events.length > 0) {
      this.#apply(events);
    }

    if (this.#queue.length === 0) {
      this.#lastDrainAt = null;
      this.#pacingCarry = 0;
    }

    this.#schedule();
  }

  #computePacingBudget(pendingPacedGraphemes: number, elapsedMs: number): number {
    if (pendingPacedGraphemes === 0) {
      this.#pacingCarry = 0;
      return 0;
    }

    if (pendingPacedGraphemes > MAX_PENDING_PACED_GRAPHEMES) {
      this.#pacingCarry = 0;
      return Number.POSITIVE_INFINITY;
    }

    const elapsedSeconds = elapsedMs / 1000;
    const proportional = (pendingPacedGraphemes * elapsedMs) / PACING_TIME_CONSTANT_MS;
    const paced = Math.min(
      Math.max(proportional, MIN_PACED_GRAPHEMES_PER_SECOND * elapsedSeconds),
      MAX_PACED_GRAPHEMES_PER_SECOND * elapsedSeconds,
    );
    const budget = this.#pacingCarry + paced;
    const wholeGraphemes = Math.floor(budget);

    // Fractional carry keeps sub-grapheme-per-frame rates moving instead of
    // rounding to zero forever.
    this.#pacingCarry = budget - wholeGraphemes;
    return wholeGraphemes;
  }

  #takeFrameBatch(): AgUiSessionEvent[] {
    let pacedFrom = 0;

    for (const [index, item] of this.#queue.entries()) {
      if (isPacingBarrierEvent(item.event)) {
        pacedFrom = index + 1;
      }
    }

    let pendingPacedGraphemes = 0;

    for (const item of this.#queue.slice(pacedFrom)) {
      pendingPacedGraphemes += item.segments?.length ?? 0;
    }

    const now = this.#host.now();
    const elapsedMs = Math.max(0, now - (this.#lastDrainAt ?? now));
    this.#lastDrainAt = now;

    let budget = this.#computePacingBudget(pendingPacedGraphemes, elapsedMs);

    const events: AgUiSessionEvent[] = [];
    let consumed = 0;

    for (const item of this.#queue) {
      if (events.length >= MAX_EVENTS_PER_FRAME) {
        break;
      }

      if (consumed < pacedFrom || item.segments === null) {
        events.push(item.event);
        consumed += 1;
        continue;
      }

      if (item.segments.length <= budget) {
        budget -= item.segments.length;
        events.push(item.event);
        consumed += 1;
        continue;
      }

      if (budget > 0) {
        const headDelta = item.segments.slice(0, budget).join("");
        const tailSegments = item.segments.slice(budget);

        events.push(withTextDelta(item.event, headDelta, false));
        this.#queue[consumed] = {
          event: withTextDelta(item.event, tailSegments.join(""), true),
          segments: tailSegments,
        };
      }

      // Budget exhausted at a paced event. Everything behind it stays queued
      // so no later event can overtake text still being typed out.
      break;
    }

    this.#queue.splice(0, consumed);

    return events;
  }

  #toQueueItem(event: AgUiSessionEvent): QueuedSessionEvent {
    const messageRole =
      "messageId" in event && typeof event.messageId === "string"
        ? this.#messageRoles.get(event.messageId)
        : undefined;
    const delta = getPaceableTextDelta(event, messageRole);

    return {
      event,
      segments: delta === null ? null : segmentGraphemes(delta),
    };
  }
}
