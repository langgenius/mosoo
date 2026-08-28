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
import { publishSessionViewerEvents } from "../../../sessions/application/session-viewer-events.service";

const SESSION_VIEWER_EVENT_DELIVERY_FLUSH_MS = 150;
const SESSION_VIEWER_EVENT_DELIVERY_MAX_DELTA_BYTES = 4 * 1024;
const SESSION_VIEWER_EVENT_DELIVERY_MAX_EVENTS = 64;
const SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES = 1_536 * 1024;
const sessionViewerEventEncoder = new TextEncoder();

interface BufferedSessionViewerEvents {
  deltaBytes: number;
  events: SessionDeliveryEvent[];
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
  readonly #withRuntimeLogContext: <T>(fn: () => T) => T;

  constructor(options: SessionViewerEventDeliveryBufferOptions) {
    this.#ctx = options.ctx;
    this.#env = options.env;
    this.#getDriverInstanceId = options.getDriverInstanceId;
    this.#withRuntimeLogContext = options.withRuntimeLogContext;
  }

  enqueue(sessionId: SessionId | null, events: SessionDeliveryEvent[]): void {
    const compactedEvents = compactAgUiSessionEvents(events);

    if (compactedEvents.length === 0) {
      return;
    }

    for (const event of compactedEvents) {
      this.#appendEvent(sessionId, event);
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
      this.#startFlush();
      return;
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
        const batch = this.#pendingBatches.shift();

        if (!batch) {
          return;
        }

        try {
          await publishSessionViewerEvents(this.#env, batch.sessionId, batch.events);
        } catch (error) {
          this.#pendingBatches.unshift(batch);
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

      if (this.#hasBufferedEvents() && this.#timer === null) {
        this.#scheduleFlush();
      }
    }
  }

  resetAfterFlush(): void {
    this.#buffer = null;
    this.#pendingFirstDelta = false;
    this.#pendingBatches.length = 0;

    this.#clearTimer();
  }

  #appendEvent(sessionId: SessionId | null, event: SessionDeliveryEvent): void {
    let buffered = this.#buffer;
    let events = buffered ? appendCompactedAgUiSessionEvents(buffered.events, [event]) : [event];
    let serializedBytes = measureSerializedBytes(events);

    if (buffered && serializedBytes > SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES) {
      this.#startFlush();
      buffered = null;
      events = [event];
      serializedBytes = measureSerializedBytes(events);
    }

    this.#buffer = {
      deltaBytes: (buffered?.deltaBytes ?? 0) + getAgUiSessionEventDeltaLength(event),
      events,
      sessionId: buffered?.sessionId ?? sessionId,
    };

    if (
      events.length >= SESSION_VIEWER_EVENT_DELIVERY_MAX_EVENTS ||
      this.#buffer.deltaBytes >= SESSION_VIEWER_EVENT_DELIVERY_MAX_DELTA_BYTES ||
      serializedBytes >= SESSION_VIEWER_EVENT_DELIVERY_MAX_SERIALIZED_BYTES
    ) {
      this.#startFlush();
    }
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
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

    for (const batch of queued) {
      if (batch.sessionId !== sessionId) {
        this.#queueCompactedEvents(sessionId, events);
        events = [];
        sessionId = batch.sessionId;
      }

      events = appendCompactedAgUiSessionEvents(events, batch.events);
    }

    this.#queueCompactedEvents(sessionId, events);
  }

  #queueCompactedEvents(sessionId: SessionId | null, events: SessionDeliveryEvent[]): void {
    for (const event of events) {
      const previous = this.#pendingBatches.at(-1);
      const nextEvents = previous
        ? appendCompactedAgUiSessionEvents(previous.events, [event])
        : [event];
      const nextDeltaBytes = (previous?.deltaBytes ?? 0) + getAgUiSessionEventDeltaLength(event);

      if (
        previous &&
        previous.sessionId === sessionId &&
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
        sessionId,
      });
    }
  }

  #hasBufferedEvents(): boolean {
    return this.#buffer !== null || this.#pendingBatches.length > 0;
  }

  #queueBuffer(): void {
    if (!this.#buffer) {
      return;
    }

    this.#pendingBatches.push(this.#buffer);
    this.#buffer = null;
  }

  #scheduleFlush(): void {
    if (this.#timer !== null) {
      return;
    }

    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#startFlush();
    }, SESSION_VIEWER_EVENT_DELIVERY_FLUSH_MS);
  }

  #startFlush(): void {
    this.#clearTimer();
    this.#queueBuffer();

    if (this.#delivery) {
      this.#compactPendingBatches();
      return;
    }

    if (this.#pendingBatches.length === 0) {
      return;
    }

    const task = this.#flushAndReportDeliveryErrors();

    this.#ctx.waitUntil(task);
  }

  async #flushAndReportDeliveryErrors(): Promise<void> {
    try {
      await this.flush();
    } catch (error) {
      this.#reportDeliveryError(error);

      if (this.#hasBufferedEvents() && this.#timer === null) {
        this.#scheduleFlush();
      }
    }
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
