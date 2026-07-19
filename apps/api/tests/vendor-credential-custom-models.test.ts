import { describe, expect, test } from "bun:test";

import type { PlatformId, AppId, VendorCredentialId } from "@mosoo/id";

import {
  findCustomCredentialRowForModel,
  listEffectiveCustomCredentialModelRows,
} from "../src/modules/vendor-credentials/application/vendor-credential-custom-models";
import type { VendorCredentialRow } from "../src/modules/vendor-credentials/application/vendor-credential.types";

function credentialRow(input: {
  id: string;
  modelsJson: string[] | null;
  name: string;
}): VendorCredentialRow {
  return {
    apiBase: null,
    apiKeySecretId: `${input.id}-secret` as PlatformId,
    id: input.id as VendorCredentialId,
    isDefault: false,
    modelsJson: input.modelsJson,
    name: input.name,
    appId: "app-1" as AppId,
    vendorId: "openai-compatible",
  };
}

describe("vendor credential custom models", () => {
  test("lists effective custom credential models using sorted credential precedence", () => {
    const secondary = credentialRow({
      id: "credential-b",
      modelsJson: ["shared-model", "secondary-only"],
      name: "B Custom",
    });
    const primary = credentialRow({
      id: "credential-a",
      modelsJson: ["shared-model", "primary-only"],
      name: "A Custom",
    });

    expect(listEffectiveCustomCredentialModelRows([secondary, primary])).toEqual([
      { modelId: "shared-model", row: primary },
      { modelId: "primary-only", row: primary },
      { modelId: "secondary-only", row: secondary },
    ]);
  });

  test("finds the first sorted credential for a model without requiring a full effective list", () => {
    const secondary = credentialRow({
      id: "credential-b",
      modelsJson: ["target-model"],
      name: "B Custom",
    });
    const primary = credentialRow({
      id: "credential-a",
      modelsJson: ["target-model"],
      name: "A Custom",
    });

    expect(findCustomCredentialRowForModel([secondary, primary], "target-model")).toBe(primary);
    expect(findCustomCredentialRowForModel([secondary, primary], "missing-model")).toBeNull();
  });
});
