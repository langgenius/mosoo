import { describe, expect, test } from "bun:test";

import {
  ALL_VENDORS,
  PRESET_MODEL_CATALOG,
  RUNTIME_CATALOG,
  getDefaultModelIdForVendor,
  getPresetModel,
  listPresetModelsForVendor,
  resolveRuntimeModelProtocol,
} from "@mosoo/runtime-catalog";
import { getRuntimeIconKey } from "@mosoo/runtime-catalog/icons";

describe("runtime catalog data", () => {
  test("uses unique vendor, preset model and runtime ids", () => {
    const keys = [
      ALL_VENDORS.map((vendor) => vendor.vendorId),
      PRESET_MODEL_CATALOG.map((model) => `${model.vendorId}/${model.modelId}`),
      RUNTIME_CATALOG.map((runtime) => runtime.runtimeId),
    ];

    for (const ids of keys) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("admits every runtime default and points vendor defaults at their own presets", () => {
    for (const runtime of RUNTIME_CATALOG) {
      expect(
        resolveRuntimeModelProtocol({
          modelId: runtime.defaultModel,
          runtimeId: runtime.runtimeId,
          vendorId: runtime.defaultProvider,
        }),
      ).toMatchObject({ ok: true });
      expect(getRuntimeIconKey(runtime.runtimeId)).toBe(runtime.display.iconKey);
    }

    for (const vendor of ALL_VENDORS) {
      const modelId = getDefaultModelIdForVendor(vendor.vendorId);

      if (modelId !== null) {
        const preset = getPresetModel({ modelId, vendorId: vendor.vendorId });

        expect(preset).not.toBeNull();
        expect(preset?.displayName).not.toEndWith("(Limited preview)");
      }
    }
  });

  test("keeps every runtime vendor's presets within the runtime's protocols", () => {
    for (const runtime of RUNTIME_CATALOG) {
      for (const vendor of runtime.vendors) {
        for (const model of listPresetModelsForVendor(vendor.vendorId)) {
          expect(runtime.supportedModelProtocols).toContain(model.protocol);
          expect(runtime.supportedModelIds).toContain(model.modelId);
        }
      }
    }
  });
});
