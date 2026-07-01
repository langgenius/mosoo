import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Agent terminal entry boundary", () => {
  test("keeps Pet owner Terminal as a gated header tab", () => {
    const source = readSource("../src/routes/agent/agent-detail.route.tsx");
    const terminalButtonIndex = source.indexOf('aria-label="Open Terminal"');
    const gatedEntryIndex = source.lastIndexOf("canUseTerminal &&", terminalButtonIndex);

    expect(source).toContain('import { ArrowLeft, Settings } from "lucide-react";');
    expect(source).not.toContain("TerminalSquare");
    expect(terminalButtonIndex).toBeGreaterThan(-1);
    expect(gatedEntryIndex).toBeGreaterThan(-1);
    expect(source).toContain('onSelectMode("terminal")');
    expect(source).toContain(
      'requestedMode === "terminal" && !canUseTerminal ? defaultMode : requestedMode',
    );
  });
});
