import type { Logger } from "@mosoo/observability";

import type { DriverInstanceSocket } from "../infrastructure/runtime/driver-instance-socket";

interface DriverHeartbeatLoopOptions {
  driverInstanceId: string;
  isShuttingDown(): boolean;
}

export class DriverHeartbeatLoop {
  readonly #driverInstanceId: string;
  readonly #isShuttingDown: () => boolean;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DriverHeartbeatLoopOptions) {
    this.#driverInstanceId = options.driverInstanceId;
    this.#isShuttingDown = () => options.isShuttingDown();
  }

  start(socket: DriverInstanceSocket, logger: Logger, heartbeatIntervalMs: number): void {
    this.stop(logger, "restart");

    logger.debug("driver.runtime.heartbeat.started", {
      driverInstanceId: this.#driverInstanceId,
      heartbeatIntervalMs,
    });

    this.#timer = setInterval(() => {
      const at = new Date().toISOString();
      void this.#sendHeartbeat(socket, logger, at);
    }, heartbeatIntervalMs);
  }

  async #sendHeartbeat(socket: DriverInstanceSocket, logger: Logger, at: string): Promise<void> {
    try {
      await socket.heartbeat({
        at,
        reason: "interval",
      });
    } catch (error) {
      if (this.#isShuttingDown()) {
        return;
      }

      logger.error("driver.runtime.heartbeat-failed", error, {
        at,
        driverInstanceId: this.#driverInstanceId,
      });
    }
  }

  stop(logger: Logger | null, reason: string): void {
    if (!this.#timer) {
      return;
    }

    clearInterval(this.#timer);
    this.#timer = null;
    logger?.debug("driver.runtime.heartbeat.stopped", {
      driverInstanceId: this.#driverInstanceId,
      reason,
    });
  }
}
