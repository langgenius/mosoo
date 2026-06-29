import { describe, expect, test } from "bun:test";

import { PUBLIC_RUNTIME_CATALOG, listPlannedRuntimeDisplayEntries } from "@mosoo/runtime-catalog";

import type { VendorCredential } from "../src/domains/vendor-credential/api/vendor-credential-client";
import { listRuntimeAvailabilityRows } from "../src/routes/providers/runtime-availability-model";

function credential(vendorId: string): VendorCredential {
  return {
    apiBase: null,
    id: "01J000000000000000000000AA",
    isDefault: true,
    maskedApiKey: "sk-***",
    models: null,
    name: "Default",
    appId: "01J00000000000000000000009",
    vendorId,
  };
}

describe("provider runtime availability", () => {
  test("does not render planned runtime display entries", () => {
    const availabilityRows = listRuntimeAvailabilityRows([
      credential("anthropic"),
      credential("openai"),
    ]);
    const availabilityRuntimeIds = availabilityRows.map((runtime) => runtime.runtimeId);
    const publicRuntimeIds = PUBLIC_RUNTIME_CATALOG.map((runtime) => runtime.runtimeId);

    expect(listPlannedRuntimeDisplayEntries("provider-settings")).toEqual([]);
    expect(availabilityRuntimeIds).toEqual(publicRuntimeIds);
  });
});
