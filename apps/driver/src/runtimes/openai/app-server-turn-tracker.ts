import { createPromiseDeferred } from "@mosoo/effects";
import type { SessionRunId } from "@mosoo/id";

import type { DriverTurnCancelledError } from "../../core/driver-runtime-state";

interface ActiveOpenAiTurn {
  reject(error: Error): void;
  resolve(): void;
  runId: SessionRunId;
}

type TerminalOpenAiTurn =
  | { kind: "completed" }
  | { error: DriverTurnCancelledError | Error; kind: "failed" };

export class OpenAiTurnTracker {
  readonly #activeTurns = new Map<string, ActiveOpenAiTurn>();
  readonly #cancelledTurns = new Map<string, string>();
  readonly #terminalTurns = new Map<string, TerminalOpenAiTurn>();
  readonly #startedTurnIds = new Set<string>();

  activeRunId(turnId: string): SessionRunId | null {
    return this.#activeTurns.get(turnId)?.runId ?? null;
  }

  activeTurnIds(): string[] {
    return [...this.#activeTurns.keys()];
  }

  clearActiveTurns(): void {
    this.#activeTurns.clear();
  }

  hasTerminal(turnId: string): boolean {
    return this.#terminalTurns.has(turnId);
  }

  markCancelled(turnId: string, reason: string): void {
    this.#cancelledTurns.set(turnId, reason);
  }

  markTurnStarted(turnId: string): boolean {
    if (this.#startedTurnIds.has(turnId)) {
      return false;
    }

    this.#startedTurnIds.add(turnId);
    return true;
  }

  rejectTurn(turnId: string, error: Error): void {
    const activeTurn = this.#activeTurns.get(turnId);
    activeTurn?.reject(error);
    this.#activeTurns.delete(turnId);
  }

  rejectActiveTurns(error: Error): void {
    for (const turnId of this.activeTurnIds()) {
      this.rejectTurn(turnId, error);
    }
  }

  settle(turnId: string, terminalTurn: TerminalOpenAiTurn): void {
    this.#terminalTurns.set(turnId, terminalTurn);
    const activeTurn = this.#activeTurns.get(turnId);

    if (activeTurn === undefined) {
      return;
    }

    if (terminalTurn.kind === "completed") {
      activeTurn.resolve();
    } else {
      activeTurn.reject(terminalTurn.error);
    }

    this.#activeTurns.delete(turnId);
  }

  takeCancellationReason(turnId: string): string | null {
    const reason = this.#cancelledTurns.get(turnId) ?? null;
    this.#cancelledTurns.delete(turnId);
    return reason;
  }

  async track(turnId: string, runId: SessionRunId): Promise<void> {
    const terminalTurn = this.#terminalTurns.get(turnId);

    if (terminalTurn?.kind === "completed") {
      return;
    }

    if (terminalTurn?.kind === "failed") {
      throw terminalTurn.error;
    }

    const turn = createPromiseDeferred<void>();
    this.#activeTurns.set(turnId, {
      reject: turn.reject,
      resolve: () => {
        turn.resolve();
      },
      runId,
    });
    return turn.promise;
  }
}
