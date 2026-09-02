import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Agent list scroll boundaries", () => {
  test("agent list page fills the shell content box so the list can scroll", () => {
    const appShellSource = readSource("../src/app/app-shell.tsx");
    const agentListSource = readSource("../src/routes/agent/agent-list.route.tsx");
    const listPageSource = readSource("../src/shared/ui/list-page.tsx");

    // The Project shell mounts every route inside a block-level, height-bounded box.
    // A page root only inherits that bound through an explicit height; `flex-1`
    // alone lets it grow with its rows, so `overflow-hidden` clipped the tail of
    // the Agents table instead of `ListPageContent` scrolling it.
    expect(appShellSource).toContain(
      '<div className="min-h-0 flex-1 overflow-hidden">{children}</div>',
    );
    expect(agentListSource).toContain('<div className="flex h-full flex-col overflow-hidden">');
    expect(agentListSource).not.toContain('<div className="flex flex-1 flex-col overflow-hidden">');
    expect(listPageSource).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
  });
});
