import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

describe("Agent terminal entry boundary", () => {
  test("does not expose the retired owner Terminal", () => {
    const source = readFileSync(
      new URL("../src/routes/agent/agent-detail.route.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain('t("agent.openTerminal")');
    expect(source).not.toContain('onSelectMode("terminal")');
    expect(
      existsSync(new URL("../src/routes/agent/components/terminal-mode.tsx", import.meta.url)),
    ).toBe(false);
  });
});
