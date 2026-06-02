import type { SessionLiveState } from "../../../sessions/application/session-live-state.service";

export class RuntimeSessionViewCache {
  #state: SessionLiveState | null = null;

  get currentState(): SessionLiveState | null {
    return this.#state;
  }

  reset(): void {
    this.#state = null;
  }

  update(state: SessionLiveState | null): void {
    if (!state) {
      this.reset();
      return;
    }

    this.#state = state;
  }
}
