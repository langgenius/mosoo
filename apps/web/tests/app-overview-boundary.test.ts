import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("App overview boundary", () => {
  test("keeps the console root centered on the active App", () => {
    const routeSource = readSource("../src/routes/app-overview/app-overview.route.tsx");
    const modelSource = readSource("../src/routes/app-overview/app-overview-model.ts");
    const combinedSource = `${routeSource}\n${modelSource}`;

    expect(routeSource).toContain("Quickstart");
    expect(routeSource).toContain("quickstart steps complete");
    expect(routeSource).toContain("No threads have run in this App yet.");
    expect(routeSource).toContain("Last 30 days in this App");
    expect(routeSource).toContain('to="/channels"');
    expect(routeSource).toContain("Channels");
    expect(routeSource).toContain("Provider keys");
    expect(routeSource).toContain("New agent");
    expect(modelSource).toContain('label: "Add provider key"');
    expect(modelSource).toContain('label: "Create agent"');
    expect(modelSource).toContain('label: "Run a thread"');
    expect(modelSource).toContain('label: "Publish an agent"');
    expect(modelSource).toContain("Store a model key for this App.");
    expect(modelSource).toContain("Expose an App-local Agent through its Agent API endpoint.");

    expect(combinedSource).not.toContain("app-scoped");
    expect(combinedSource).not.toContain("Expose the App through its runtime endpoint");
    expect(combinedSource).not.toContain('label: "Publish runtime"');
    expect(combinedSource).not.toContain("App setup");
    expect(combinedSource).not.toContain("Loading app");
    expect(combinedSource).not.toContain("No app available");
    expect(combinedSource).not.toContain("Organization");
    expect(combinedSource).not.toContain("Members");
    expect(combinedSource).not.toContain("Invite");
    expect(combinedSource).not.toContain('to="/members"');
    expect(combinedSource).not.toContain('to="/join');
  });
});
