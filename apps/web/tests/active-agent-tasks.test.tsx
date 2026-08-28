import { describe, expect, test } from "bun:test";

import type { AgentTask } from "@mosoo/contracts/session";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "../src/shared/i18n";
import { ActiveAgentTasks } from "../src/shared/ui/session-events";

function render(tasks: AgentTask[]): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ActiveAgentTasks tasks={tasks} />
    </I18nProvider>,
  );
}

describe("active agent tasks", () => {
  test("renders the authoritative current task list by task id", () => {
    const html = render([
      { taskId: "task-search", taskType: "local", title: "Search repository" },
      { taskId: "task-review", title: "Review changes" },
    ]);

    expect(html).toContain("Active background tasks");
    expect(html).toContain("2 active");
    expect(html).toContain("Search repository");
    expect(html).toContain("task-search");
    expect(html).toContain("Review changes");
    expect(html).toContain("task-review");
    expect(html).toContain("<output");
  });

  test("renders nothing for the authoritative empty snapshot", () => {
    expect(render([])).toBe("");
  });

  test("uses the task id when optional metadata is absent", () => {
    const html = render([{ taskId: "task-id-only" }]);

    expect(html).toContain(">task-id-only</span>");
    expect(html.match(/task-id-only/g)).toHaveLength(1);
  });
});
