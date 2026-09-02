import {
  appendCompactedAgUiSessionEvents,
  compactAgUiSessionEvents,
  getAgUiSessionEventDeltaLength,
  isAgUiSessionRunStartedEvent,
  isAgUiSessionRunTerminalEvent,
} from "@mosoo/ag-ui-session";
import type { DriverInstanceId, SessionId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { SessionDeliveryEvent } from "../../../sessions/application/session-live-state.service";
import {
  publishSessionViewerEventBatches,
  syncSessionViewerState,
} from "../../../sessions/infrastructure/session/client";

const SESSION_VIEWER_EVENT_DELIVERY_FLUSH_MS = 150;
const SESSION_VIEWER_EVENT_DELIVERY_MAX_DELTA_BYTES = 4 * 1024;
const SESSION_VIEWER_EVENT_DELIVERY_MAX_EVENTS = 64;
const SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES = 1_536 * 1024;
const sessionViewerEventEncoder = new TextEncoder();

interface BufferedSessionViewerEvents {
  deltaBytes: number;
  events: SessionDeliveryEvent[];
  previousRuntimeEventSeqCursor: number | null;
  requiresStateSync: boolean;
  runtimeEventSeqCursor: number | null;
  sessionId: SessionId | null;
}

interface SessionViewerEventDeliveryBufferOptions {
  ctx: DurableObjectState;
  env: ApiBindings;
  getDriverInstanceId: () => DriverInstanceId | null;
  withRuntimeLogContext: <T>(fn: () => T) => T;
}

function hasTerminalEvent(events: SessionDeliveryEvent[]): boolean {
  return events.some(isAgUiSessionRunTerminalEvent);
}

function hasRunStartedEvent(events: SessionDeliveryEvent[]): boolean {
  return events.some(isAgUiSessionRunStartedEvent);
}

function hasDeltaEvent(events: SessionDeliveryEvent[]): boolean {
  return events.some((event) => getAgUiSessionEventDeltaLength(event) > 0);
}

function measureSerializedBytes(events: SessionDeliveryEvent[]): number {
  return sessionViewerEventEncoder.encode(JSON.stringify(events)).byteLength;
}

export class SessionViewerEventDeliveryBuffer {
  #buffer: BufferedSessionViewerEvents | null = null;
  #delivery: Promise<void> | null = null;
  #pendingFirstDelta = false;
  readonly #pendingBatches: BufferedSessionViewerEvents[] = [];
  readonly #ctx: DurableObjectState;
  readonly #env: ApiBindings;
  readonly #getDriverInstanceId: () => DriverInstanceId | null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #timerDone: (() => void) | null = null;
  readonly #withRuntimeLogContext: <T>(fn: () => T) => T;

  constructor(options: SessionViewerEventDeliveryBufferOptions) {
    this.#ctx = options.ctx;
    this.#env = options.env;
    this.#getDriverInstanceId = options.getDriverInstanceId;
    this.#withRuntimeLogContext = options.withRuntimeLogContext;
  }

  enqueue(
    sessionId: SessionId | null,
    events: SessionDeliveryEvent[],
    runtimeEventSeqCursor: number | null = null,
    previousRuntimeEventSeqCursor: number | null = null,
  ): void {
    const compactedEvents = compactAgUiSessionEvents(events);

    if (compactedEvents.length === 0) {
      return;
    }

    if (runtimeEventSeqCursor !== null) {
      this.#queueBuffer();
      this.#pendingBatches.push({
        deltaBytes: compactedEvents.reduce(
          (total, event) => total + getAgUiSessionEventDeltaLength(event),
          0,
        ),
        events:
          measureSerializedBytes(compactedEvents) <=
          SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES
            ? compactedEvents
            : [],
        previousRuntimeEventSeqCursor,
        requiresStateSync:
          previousRuntimeEventSeqCursor === null ||
          measureSerializedBytes(compactedEvents) >
            SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES,
        runtimeEventSeqCursor,
        sessionId,
      });

      if (this.#delivery !== null) {
        this.#replacePendingWithStateSync(sessionId, runtimeEventSeqCursor);
      }

      if (hasRunStartedEvent(compactedEvents)) {
        this.#pendingFirstDelta = true;
      }
      const isFirstDeltaOfRun = this.#pendingFirstDelta && hasDeltaEvent(compactedEvents);
      if (isFirstDeltaOfRun) {
        this.#pendingFirstDelta = false;
      }
      if (isFirstDeltaOfRun || hasTerminalEvent(compactedEvents)) {
        void this.#startFlush();
      } else {
        this.#scheduleFlush();
      }
      return;
    }

    if (
      this.#buffer !== null &&
      (this.#buffer.sessionId !== sessionId ||
        this.#buffer.runtimeEventSeqCursor !== runtimeEventSeqCursor)
    ) {
      this.#queueBuffer();
    }

    for (const event of compactedEvents) {
      this.#appendEvent(sessionId, event, runtimeEventSeqCursor);
    }

    // O2: cut first-token latency. Arm on RUN_STARTED, then flush the first
    // delta of the run immediately instead of waiting out the 150ms timer.
    // This fires at most once per run, so per-delta batching for the rest of
    // the stream is preserved.
    if (hasRunStartedEvent(compactedEvents)) {
      this.#pendingFirstDelta = true;
    }
    const isFirstDeltaOfRun = this.#pendingFirstDelta && hasDeltaEvent(compactedEvents);
    if (isFirstDeltaOfRun) {
      this.#pendingFirstDelta = false;
    }

    if (isFirstDeltaOfRun || hasTerminalEvent(compactedEvents)) {
      void this.#startFlush();
      return;
    }

    if (this.#delivery !== null) {
      this.#replacePendingWithStateSync(sessionId, runtimeEventSeqCursor);
    }

    if (this.#buffer) {
      this.#scheduleFlush();
    }
  }

  async flush(): Promise<void> {
    this.#clearTimer();
    this.#queueBuffer();
    await this.#getOrStartDelivery();
  }

  async #deliverPendingBatches(): Promise<void> {
    try {
      while (this.#pendingBatches.length > 0) {
        const first = this.#pendingBatches.shift();

        if (!first) {
          return;
        }
        if (first.requiresStateSync) {
          try {
            await syncSessionViewerState(this.#env, first.sessionId);
          } catch (error) {
            this.#pendingBatches.unshift(first);
            throw error;
          }
          continue;
        }
        const batches = [first];
        let serializedBytes = measureSerializedBytes(first.events);
        for (;;) {
          const next = this.#pendingBatches[0];
          if (
            next === undefined ||
            next.requiresStateSync ||
            next.sessionId !== first.sessionId ||
            serializedBytes + measureSerializedBytes(next.events) >
              SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES
          ) {
            break;
          }
          batches.push(this.#pendingBatches.shift()!);
          serializedBytes += measureSerializedBytes(next.events);
        }

        try {
          await publishSessionViewerEventBatches(
            this.#env,
            first.sessionId,
            batches.map((batch) => ({
              events: batch.events,
              previousRuntimeEventSeqCursor: batch.previousRuntimeEventSeqCursor,
              runtimeEventSeqCursor: batch.runtimeEventSeqCursor,
            })),
          );
        } catch (error) {
          this.#pendingBatches.unshift(...batches);
          throw error;
        }
      }
    } finally {
      this.#delivery = null;
    }
  }

  async flushSafely(): Promise<void> {
    try {
      await this.flush();
    } catch (error) {
      this.#reportDeliveryError(error);
      this.resetAfterFlush();
    }
  }

  requestStateSync(sessionId: SessionId | null): void {
    this.#replacePendingWithStateSync(sessionId, null);
    void this.#startFlush();
  }

  resetAfterFlush(): void {
    this.#buffer = null;
    this.#pendingFirstDelta = false;
    this.#pendingBatches.length = 0;

    this.#clearTimer();
  }

  #appendEvent(
    sessionId: SessionId | null,
    event: SessionDeliveryEvent,
    runtimeEventSeqCursor: number | null,
  ): void {
    let buffered = this.#buffer;
    let events = buffered ? appendCompactedAgUiSessionEvents(buffered.events, [event]) : [event];
    let serializedBytes = measureSerializedBytes(events);

    if (buffered && serializedBytes > SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES) {
      void this.#startFlush();
      buffered = null;
      events = [event];
      serializedBytes = measureSerializedBytes(events);
    }

    this.#buffer = {
      deltaBytes: (buffered?.deltaBytes ?? 0) + getAgUiSessionEventDeltaLength(event),
      events,
      previousRuntimeEventSeqCursor: null,
      requiresStateSync: false,
      runtimeEventSeqCursor: buffered?.runtimeEventSeqCursor ?? runtimeEventSeqCursor,
      sessionId: buffered?.sessionId ?? sessionId,
    };

    if (
      events.length >= SESSION_VIEWER_EVENT_DELIVERY_MAX_EVENTS ||
      this.#buffer.deltaBytes >= SESSION_VIEWER_EVENT_DELIVERY_MAX_DELTA_BYTES ||
      serializedBytes >= SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES
    ) {
      void this.#startFlush();
    }
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#timerDone?.();
    this.#timerDone = null;
  }

  #getOrStartDelivery(): Promise<void> {
    if (this.#delivery) {
      this.#compactPendingBatches();
      return this.#delivery;
    }

    if (this.#pendingBatches.length === 0) {
      return Promise.resolve();
    }

    this.#compactPendingBatches();
    const delivery = this.#deliverPendingBatches();
    this.#delivery = delivery;
    return delivery;
  }

  #compactPendingBatches(): void {
    if (this.#pendingBatches.length < 2) {
      return;
    }

    const queued = this.#pendingBatches.splice(0);
    let events: SessionDeliveryEvent[] = [];
    let sessionId = queued[0]?.sessionId ?? null;
    let previousRuntimeEventSeqCursor = queued[0]?.previousRuntimeEventSeqCursor ?? null;
    let requiresStateSync = queued[0]?.requiresStateSync ?? false;
    let runtimeEventSeqCursor = queued[0]?.runtimeEventSeqCursor ?? null;

    for (const batch of queued) {
      if (
        batch.sessionId !== sessionId ||
        batch.runtimeEventSeqCursor !== runtimeEventSeqCursor ||
        batch.previousRuntimeEventSeqCursor !== previousRuntimeEventSeqCursor ||
        batch.requiresStateSync !== requiresStateSync
      ) {
        this.#queueCompactedEvents(
          sessionId,
          events,
          runtimeEventSeqCursor,
          previousRuntimeEventSeqCursor,
          requiresStateSync,
        );
        events = [];
        sessionId = batch.sessionId;
        previousRuntimeEventSeqCursor = batch.previousRuntimeEventSeqCursor;
        requiresStateSync = batch.requiresStateSync;
        runtimeEventSeqCursor = batch.runtimeEventSeqCursor;
      }

      events = appendCompactedAgUiSessionEvents(events, batch.events);
    }

    this.#queueCompactedEvents(
      sessionId,
      events,
      runtimeEventSeqCursor,
      previousRuntimeEventSeqCursor,
      requiresStateSync,
    );
  }

  #queueCompactedEvents(
    sessionId: SessionId | null,
    events: SessionDeliveryEvent[],
    runtimeEventSeqCursor: number | null,
    previousRuntimeEventSeqCursor: number | null,
    requiresStateSync: boolean,
  ): void {
    if (requiresStateSync) {
      this.#pendingBatches.push({
        deltaBytes: 0,
        events: [],
        previousRuntimeEventSeqCursor: null,
        requiresStateSync: true,
        runtimeEventSeqCursor,
        sessionId,
      });
      return;
    }

    if (runtimeEventSeqCursor !== null) {
      const compactedEvents = compactAgUiSessionEvents(events);
      const mustSync =
        measureSerializedBytes(compactedEvents) >
        SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES;
      this.#pendingBatches.push({
        deltaBytes: compactedEvents.reduce(
          (total, event) => total + getAgUiSessionEventDeltaLength(event),
          0,
        ),
        events: mustSync ? [] : compactedEvents,
        previousRuntimeEventSeqCursor,
        requiresStateSync: mustSync,
        runtimeEventSeqCursor,
        sessionId,
      });
      return;
    }
    for (const event of events) {
      const previous = this.#pendingBatches.at(-1);
      const nextEvents = previous
        ? appendCompactedAgUiSessionEvents(previous.events, [event])
        : [event];
      const nextDeltaBytes = (previous?.deltaBytes ?? 0) + getAgUiSessionEventDeltaLength(event);

      if (
        previous &&
        previous.sessionId === sessionId &&
        !previous.requiresStateSync &&
        previous.runtimeEventSeqCursor === runtimeEventSeqCursor &&
        nextEvents.length <= SESSION_VIEWER_EVENT_DELIVERY_MAX_EVENTS &&
        nextDeltaBytes <= SESSION_VIEWER_EVENT_DELIVERY_MAX_DELTA_BYTES &&
        measureSerializedBytes(nextEvents) <= SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES
      ) {
        previous.deltaBytes = nextDeltaBytes;
        previous.events = nextEvents;
        continue;
      }

      this.#pendingBatches.push({
        deltaBytes: getAgUiSessionEventDeltaLength(event),
        events: [event],
        previousRuntimeEventSeqCursor,
        requiresStateSync: false,
        runtimeEventSeqCursor,
        sessionId,
      });
    }
  }

  #queueBuffer(): void {
    if (!this.#buffer) {
      return;
    }

    this.#pendingBatches.push(this.#buffer);
    this.#buffer = null;
  }

  #replacePendingWithStateSync(
    sessionId: SessionId | null,
    runtimeEventSeqCursor: number | null,
  ): void {
    this.#buffer = null;
    this.#pendingBatches.length = 0;
    this.#clearTimer();
    this.#pendingBatches.push({
      deltaBytes: 0,
      events: [],
      previousRuntimeEventSeqCursor: null,
      requiresStateSync: true,
      runtimeEventSeqCursor,
      sessionId,
    });
  }

  #scheduleFlush(): void {
    if (this.#timer !== null) {
      return;
    }

    const task = new Promise<void>((resolve) => {
      this.#timerDone = resolve;
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#timerDone = null;
        void this.#startFlush().finally(resolve);
      }, SESSION_VIEWER_EVENT_DELIVERY_FLUSH_MS);
    });
    this.#ctx.waitUntil(task);
  }

  #startFlush(): Promise<void> {
    this.#clearTimer();
    this.#queueBuffer();

    if (this.#delivery) {
      this.#compactPendingBatches();
      return this.#delivery;
    }

    if (this.#pendingBatches.length === 0) {
      return Promise.resolve();
    }

    const task = this.flushSafely();

    this.#ctx.waitUntil(task);
    return task;
  }

  #reportDeliveryError(error: unknown): void {
    this.#withRuntimeLogContext(() => {
      logError("runtime.driver.session_viewer_events.deliver.failed", {
        ...createErrorLogContext(error),
        driverInstanceId: this.#getDriverInstanceId(),
      });
    });
  }
}
