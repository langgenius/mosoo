import { describe, expect, test } from "bun:test";

import { PLANNED_RUNTIME_DISPLAY_CATALOG, RUNTIME_CATALOG } from "@mosoo/runtime-catalog";
import { getRuntimeIconKey } from "@mosoo/runtime-catalog/icons";

// The /icons entry point resolves icon keys from a generated map instead of
// the full catalog so the web app can render RuntimeIcon without shipping
// @mosoo/contracts on every page. These tests pin the map to the catalog: if
// they diverge, the generated file is stale or the generator drifted.
describe("getRuntimeIconKey (lean /icons entry point)", () => {
  test("matches every runtime catalog entry", () => {
    for (const entry of RUNTIME_CATALOG) {
      expect(getRuntimeIconKey(entry.runtimeId)).toBe(entry.display.iconKey);
    }
  });

  test("matches planned runtimes not shadowed by the runtime catalog", () => {
    for (const planned of PLANNED_RUNTIME_DISPLAY_CATALOG) {
      const catalogEntry = RUNTIME_CATALOG.find((entry) => entry.runtimeId === planned.runtimeId);
      const expected = catalogEntry?.display.iconKey ?? planned.iconKey;

      expect(getRuntimeIconKey(planned.runtimeId)).toBe(expected);
    }
  });

  test("returns null for unknown runtimes", () => {
    expect(getRuntimeIconKey("no-such-runtime")).toBeNull();
  });
});
