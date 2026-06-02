export type DriverRuntimeStatus = "ready" | "running" | "needs_approval" | "stopped" | "failed";

const ALLOWED_TRANSITIONS: Record<DriverRuntimeStatus, readonly DriverRuntimeStatus[]> = {
  failed: [],
  needs_approval: ["running", "failed", "stopped"],
  ready: ["running", "failed", "stopped"],
  running: ["needs_approval", "ready", "failed", "stopped"],
  stopped: [],
};

export class DriverRuntimeStateMachine {
  #status: DriverRuntimeStatus = "ready";

  status(): DriverRuntimeStatus {
    return this.#status;
  }

  enter(next: DriverRuntimeStatus): void {
    if (next === this.#status) {
      return;
    }

    if (!ALLOWED_TRANSITIONS[this.#status].includes(next)) {
      throw new Error(`Invalid driver runtime state transition: ${this.#status} -> ${next}.`);
    }

    this.#status = next;
  }
}

export {
  DriverTurnCancelledError,
  isDriverTurnCancelledError,
} from "./driver-turn-cancelled-error";
