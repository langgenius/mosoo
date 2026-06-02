import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import {
  assertRuntimeSignalCoverage,
  createRuntimeSignalCollector,
  summarizeRuntimeSignalCoverage,
} from "./runtime-signal-collector";
import type { RuntimeHarnessSignal } from "./runtime-signal-collector";

const observedAt = "2026-05-18T08:00:00.000Z";

function signal(category: RuntimeHarnessSignal["category"], name: string): RuntimeHarnessSignal {
  return {
    category,
    name,
    observedAt,
    source: "runtime-signal-collector.test",
  };
}

class FakePage extends EventEmitter {
  url(): string {
    return "http://localhost:5173/agent/agent-1?tab=preview";
  }
}

class FakeWebSocket extends EventEmitter {
  private readonly socketUrl: string;

  constructor(socketUrl: string) {
    super();
    this.socketUrl = socketUrl;
  }

  url(): string {
    return this.socketUrl;
  }
}

describe("runtime signal coverage contract", () => {
  test("fails with an agent-oriented message when a required category is missing", () => {
    const signals = [signal("application_lifecycle", "browser.load")];

    expect(() => assertRuntimeSignalCoverage(signals)).toThrow(
      /WHAT: Runtime signal collection is missing required coverage:/,
    );
    expect(() => assertRuntimeSignalCoverage(signals)).toThrow(/feature_path_execution/);
  });

  test("passes when the harness covers lifecycle, feature path, data flow, resources, and errors", () => {
    const signals = [
      signal("application_lifecycle", "browser.load"),
      signal("feature_path_execution", "session-log.entry"),
      signal("data_flow", "graphql.AgentSessionDiagnostics"),
      signal("resource_utilization", "browser.heap.sample"),
      signal("errors_exceptions", "browser.error.collector_installed"),
    ];

    const summary = summarizeRuntimeSignalCoverage(signals);

    expect(summary.missingCategories).toEqual([]);
    expect(() => assertRuntimeSignalCoverage(signals)).not.toThrow();
  });

  test("records websocket activity without depending on endpoint or frame internals", () => {
    const collector = createRuntimeSignalCollector({
      source: "runtime-signal-collector.test",
    });
    const page = new FakePage();

    collector.attachToPage(page);

    const socket = new FakeWebSocket("ws://localhost:5173/runtime-stream");
    page.emit("websocket", socket);
    socket.emit("framereceived", {
      payload: "opaque-frame-payload",
    });
    socket.emit("socketerror", "stream failed");
    socket.emit("close");

    expect(collector.getSignals().some((item) => item.category === "data_flow")).toBe(true);
    expect(collector.getSignals()).toContainEqual(
      expect.objectContaining({
        category: "errors_exceptions",
      }),
    );
    expect(collector.getSignals()).toContainEqual(
      expect.objectContaining({
        category: "application_lifecycle",
      }),
    );
  });
});
