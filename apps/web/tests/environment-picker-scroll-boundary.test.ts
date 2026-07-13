import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const environmentPickerSource = readFileSync(
  new URL("../src/routes/agent/components/editor/environment-picker.tsx", import.meta.url),
  "utf8",
);

describe("Environment picker scroll boundary", () => {
  test("keeps the Agent editor scrollable while the picker is open", () => {
    expect(environmentPickerSource).toContain("<Popover.Root modal={false}");
    expect(environmentPickerSource).toContain("<Popover.Portal>");
    expect(environmentPickerSource).not.toContain('className="fixed inset-0 z-40"');
  });
});
