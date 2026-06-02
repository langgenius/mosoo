import { describe, expect, test } from "bun:test";

import type { ThreadProcessEvent } from "../src/routes/threads/model/process";
import { getProcessEventVariant } from "../src/routes/threads/model/process";

function toolEvent(content: string): ThreadProcessEvent {
  return {
    content,
    durationMs: 1,
    id: "event-1",
    occurredAt: "2026-05-19T00:00:00.000Z",
    status: "available",
    tokens: null,
    type: "tool.use.started",
  };
}

describe("thread process event model", () => {
  test("maps camel-case web tool names to their specific variants", () => {
    expect(getProcessEventVariant(toolEvent("WebFetch details: {}"))).toBe("Web Fetch");
    expect(getProcessEventVariant(toolEvent("WebSearch details: {}"))).toBe("Web Search");
  });
});
