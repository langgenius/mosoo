import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Agent runtime lock boundary", () => {
  test("keeps published Agent runtime/type locks as status semantics", () => {
    const sources = [
      "../src/routes/agent/agent-detail.route.tsx",
      "../src/routes/agent/components/editor/form-sections.tsx",
      "../src/routes/agent/components/editor/use-model.ts",
      "../src/routes/agent/components/kind-selector.tsx",
      "../src/routes/agent/lifecycle/live-config-action-dialog.tsx",
    ].map(readSource);
    const combinedSource = sources.join("\n");

    // Published-lock strings now live in translation keys; the remaining
    // hardcoded English belongs to copy that is still wired through policy
    // data or in-file error constants.
    expect(combinedSource).toContain('t("agent.runtimeLocked")');
    expect(combinedSource).toContain('t("agentEditor.forkAgentRequired")');
    expect(combinedSource).toContain('t("agent.forkToSwitchType")');
    expect(combinedSource).toContain('t("agent.typeLocked")');
    expect(combinedSource).toContain('title: "agentLifecycle.liveRestartTitle"');
    expect(combinedSource).toContain(
      "Consume mode keeps a config entry point back into the editor.",
    );

    expect(combinedSource.toLowerCase()).not.toContain("published agent");
    expect(combinedSource).not.toContain("Fork Agent to change type or runtime");
    expect(combinedSource).not.toContain("Locked on this published");
  });
});
