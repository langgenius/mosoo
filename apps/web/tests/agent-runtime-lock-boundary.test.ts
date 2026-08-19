import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("optional Agent configuration boundary", () => {
  test("keeps runtime configuration without exposing an Agent Type branch", () => {
    const form = readSource("../src/routes/agent/components/editor/form-sections.tsx");
    const preview = readSource("../src/routes/agent/components/preview-mode.tsx");

    expect(form).toContain('t("agent.runtimeLocked")');
    expect(form).not.toContain("KindSelector");
    expect(form).not.toContain("setKind");
    expect(preview).not.toContain("AgentKindSection");
    expect(
      existsSync(new URL("../src/routes/agent/components/kind-selector.tsx", import.meta.url)),
    ).toBe(false);
  });
});
