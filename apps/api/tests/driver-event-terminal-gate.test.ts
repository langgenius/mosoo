import { describe, expect, test } from "bun:test";

import { DriverEventTerminalGate } from "../src/modules/runtime/infrastructure/driver-instance/driver-event-terminal-gate";

describe("driver event and terminal gate", () => {
  test("serializes terminal work after pending event operations", async () => {
    const gate = new DriverEventTerminalGate();
    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = gate.run(async () => {
      order.push("events.started");
      await firstBlocked;
      order.push("events.completed");
    });

    await Promise.resolve();
    const terminal = gate.run(async () => {
      order.push("terminal.started");
    });
    await Promise.resolve();

    expect(order).toEqual(["events.started"]);
    releaseFirst?.();
    await Promise.all([first, terminal]);
    expect(order).toEqual(["events.started", "events.completed", "terminal.started"]);
  });
});
