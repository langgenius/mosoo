import type { DriverEventInput, DriverRuntime } from "@mosoo/driver-protocol";

import { summarizeDriverEventBatch } from "../infrastructure/logging/driver-debug";
import type { AgentDriverContext } from "./agent-driver-backend";

async function settleSendGate(task: Promise<void>): Promise<void> {
  try {
    await task;
  } catch {
    // The caller of push observes and stores the real error.
  }
}

export class DriverEventPublisher {
  readonly #getSessionRef: () => string | null;
  readonly #runtime: DriverRuntime;
  #sendError: Error | null = null;
  #sendGate: Promise<void> = Promise.resolve();

  constructor(runtime: DriverRuntime, getSessionRef: () => string | null) {
    this.#getSessionRef = getSessionRef;
    this.#runtime = runtime;
  }

  async push(
    context: AgentDriverContext,
    reason: string,
    events: DriverEventInput[],
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    if (this.#sendError) {
      throw this.#sendError;
    }

    const task = this.#sendAfterPreviousPush(context, reason, events);
    this.#sendGate = settleSendGate(task);
    try {
      await task;
    } catch (error) {
      this.#sendError = error instanceof Error ? error : new Error("Driver event send failed.");
      throw error;
    }
  }

  async #sendAfterPreviousPush(
    context: AgentDriverContext,
    reason: string,
    events: DriverEventInput[],
  ): Promise<void> {
    try {
      await this.#sendGate;
    } catch {
      // Previous failure is recorded in #sendError; this keeps concurrent pushes from spawning unhandled rejections.
    }

    context.logger.debug("driver.runtime.events.sending", {
      reason,
      runtime: this.#runtime,
      sessionRef: this.#getSessionRef(),
      ...summarizeDriverEventBatch(events),
    });

    await context.socket.pushEvents({ events });

    context.logger.debug("driver.runtime.events.sent", {
      eventCount: events.length,
      reason,
      runtime: this.#runtime,
      sessionRef: this.#getSessionRef(),
    });
  }
}
