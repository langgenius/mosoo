import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Popup scroll boundaries", () => {
  test("keeps shared dropdown menus non-modal by default", () => {
    const dropdownMenuSource = readSource("../src/shared/ui/dropdown-menu.tsx");

    expect(dropdownMenuSource).toContain("modal = false");
    expect(dropdownMenuSource).toContain("<MenuPrimitive.Root modal={modal} {...props} />");
  });

  test("keeps the Environment picker non-modal without a full-screen overlay", () => {
    const environmentPickerSource = readSource(
      "../src/routes/agent/components/editor/environment-picker.tsx",
    );

    expect(environmentPickerSource).toContain("<Popover.Root modal={false}");
    expect(environmentPickerSource).toContain("<Popover.Portal>");
    expect(environmentPickerSource).not.toContain('className="fixed inset-0 z-40"');
  });
});
