import { createPromiseDeferred } from "@mosoo/effects";

export class DriverEventTerminalGate {
  #gate: Promise<unknown> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#gate;
    const nextGate = createPromiseDeferred<null>();
    this.#gate = nextGate.promise;
    await previous;

    try {
      return await operation();
    } finally {
      nextGate.resolve(null);
    }
  }
}
