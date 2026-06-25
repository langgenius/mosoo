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
      "../src/routes/agent/components/kind-lock-banner.tsx",
      "../src/routes/agent/lifecycle/live-config-action-dialog.tsx",
    ].map(readSource);
    const combinedSource = sources.join("\n");

    expect(combinedSource).toContain("Runtime is locked after publishing.");
    expect(combinedSource).toContain("Fork the Agent to switch runtime");
    expect(combinedSource).toContain("Fork the Agent to change type or runtime after publishing.");
    expect(combinedSource).toContain("Locked after publishing. Fork to switch type.");
    expect(combinedSource).toContain("Agent type is locked after publishing.");
    expect(combinedSource).toContain("Runtime changes are not allowed in-place after publishing.");
    expect(combinedSource).toContain(
      "Consume mode keeps a config entry point back into the editor.",
    );

    expect(combinedSource.toLowerCase()).not.toContain("published agent");
    expect(combinedSource).not.toContain("Fork Agent to change type or runtime");
    expect(combinedSource).not.toContain("Locked on this published");
  });
});
