import { describe, expect, test } from "bun:test";

import type { ThreadProcessEvent } from "../src/routes/threads/model/process";
import {
  getProcessEventVariant,
  selectCurrentAgentTasks,
} from "../src/routes/threads/model/process";

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

  test("clears cached tasks when the session list becomes terminal first", () => {
    expect(
      selectCurrentAgentTasks({
        currentRunId: "run-1",
        snapshot: { runId: "run-1", tasks: ["old-task"] },
        threadWorking: false,
      }),
    ).toEqual([]);
  });

  test("does not show the previous run snapshot when a new run appears first", () => {
    expect(
      selectCurrentAgentTasks({
        currentRunId: "run-2",
        snapshot: { runId: "run-1", tasks: ["old-task"] },
        threadWorking: true,
      }),
    ).toEqual([]);
  });

  test("keeps the matching active run snapshot", () => {
    const tasks = ["current-task"];

    expect(
      selectCurrentAgentTasks({
        currentRunId: "run-2",
        snapshot: { runId: "run-2", tasks },
        threadWorking: true,
      }),
    ).toBe(tasks);
  });
});
