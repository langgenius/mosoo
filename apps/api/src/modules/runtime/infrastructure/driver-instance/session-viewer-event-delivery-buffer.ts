import {
  appendCompactedAgUiSessionEvents,
  compactAgUiSessionEvents,
  getAgUiSessionEventDeltaLength,
  isAgUiSessionRunTerminalEvent,
} from "@mosoo/ag-ui-session";
import { discardPromiseResult, ignorePromiseRejection } from "@mosoo/effects";
import type { DriverInstanceId, SessionId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { SessionDeliveryEvent } from "../../../sessions/application/session-live-state.service";
import { publishSessionViewerEvents } from "../../../sessions/application/session-viewer-events.service";

const SESSION_VIEWER_EVENT_DELIVERY_FLUSH_MS = 150;
const SESSION_VIEWER_EVENT_DELIVERY_MAX_DELTA_BYTES = 4 * 1024;
const SESSION_VIEWER_EVENT_DELIVERY_MAX_EVENTS = 64;

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

function estimateDeltaBytes(events: SessionDeliveryEvent[]): number {
  return events.reduce((bytes, event) => bytes + getAgUiSessionEventDeltaLength(event), 0);
}

export class SessionViewerEventDeliveryBuffer {
  #buffer: BufferedSessionViewerEvents | null = null;
  readonly #ctx: DurableObjectState;
  readonly #env: ApiBindings;
  #gate: Promise<void> = Promise.resolve();
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

    const buffered = this.#buffer;
    const incomingDeltaBytes = estimateDeltaBytes(compactedEvents);
    const nextEvents = buffered
      ? appendCompactedAgUiSessionEvents(buffered.events, compactedEvents)
      : compactedEvents;
    const nextDeltaBytes = (buffered?.deltaBytes ?? 0) + incomingDeltaBytes;

    this.#buffer = {
      deltaBytes: nextDeltaBytes,
      events: nextEvents,
      sessionId: buffered?.sessionId ?? sessionId,
    };

    if (
      nextEvents.length >= SESSION_VIEWER_EVENT_DELIVERY_MAX_EVENTS ||
      nextDeltaBytes >= SESSION_VIEWER_EVENT_DELIVERY_MAX_DELTA_BYTES ||
      hasTerminalEvent(compactedEvents)
    ) {
      this.#startFlush();
      return;
    }

    this.#scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    const buffered = this.#buffer;

    if (!buffered) {
      await this.#gate;
      return;
    }

    this.#buffer = null;

    const task = this.#deliverAfterGate(buffered);

    this.#gate = SessionViewerEventDeliveryBuffer.#discardDeliveryResult(task);

    try {
      await task;
    } catch (error) {
      const currentBuffer = this.#getBuffer();
      this.#buffer = {
        deltaBytes: buffered.deltaBytes + (currentBuffer?.deltaBytes ?? 0),
        events: currentBuffer
          ? appendCompactedAgUiSessionEvents(buffered.events, currentBuffer.events)
          : buffered.events,
        sessionId: buffered.sessionId ?? currentBuffer?.sessionId ?? null,
      };
      throw error;
    }
  }

  async #deliverAfterGate(buffered: BufferedSessionViewerEvents): Promise<void> {
    try {
      await this.#gate;
    } catch (error) {
      ignorePromiseRejection(error);
    }

    await publishSessionViewerEvents(this.#env, buffered.sessionId, buffered.events);
  }

  static async #discardDeliveryResult(task: Promise<void>): Promise<void> {
    try {
      await task;
    } catch (error) {
      ignorePromiseRejection(error);
    }

    discardPromiseResult();
  }

  async flushSafely(): Promise<void> {
    try {
      await this.flush();
    } catch (error) {
      this.#reportDeliveryError(error);

      if (this.#buffer && this.#timer === null) {
        this.#scheduleFlush();
      }
    }
  }

  resetAfterFlush(): void {
    this.#buffer = null;
    this.#gate = Promise.resolve();

    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #getBuffer(): BufferedSessionViewerEvents | null {
    return this.#buffer;
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
    const task = this.#flushAndReportDeliveryErrors();

    this.#ctx.waitUntil(task);
  }

  async #flushAndReportDeliveryErrors(): Promise<void> {
    try {
      await this.flush();
    } catch (error) {
      this.#reportDeliveryError(error);

      if (this.#buffer && this.#timer === null) {
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
