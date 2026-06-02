import { DriverTurnCancelledError } from "./driver-runtime-state";

export class DriverActiveInputCancellation {
  #reason: string | null = null;

  cancel(reason: string): void {
    this.#reason = reason;
  }

  throwIfCancelled(): void {
    if (this.#reason !== null) {
      throw new DriverTurnCancelledError(this.#reason);
    }
  }
}
