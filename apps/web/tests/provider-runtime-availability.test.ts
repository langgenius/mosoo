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

  test("marks OpenCode ready from any supported provider, not only the first vendor", () => {
    const availabilityRows = listRuntimeAvailabilityRows([credential("gemini")]);
    const openCodeRow = availabilityRows.find((runtime) => runtime.runtimeId === "acp-fallback");

    expect(openCodeRow).toMatchObject({
      status: "Ready · Gemini configured",
      tone: "ready",
    });
  });

  test("marks Zhipu credentials as OpenCode-ready through the catalog adapter mapping", () => {
    const availabilityRows = listRuntimeAvailabilityRows([credential("zhipu")]);
    const openCodeRow = availabilityRows.find((runtime) => runtime.runtimeId === "acp-fallback");

    expect(openCodeRow).toMatchObject({
      status: "Ready · Zhipu configured",
      tone: "ready",
    });
  });

  test("marks custom OpenAI-compatible credentials as runtime readiness for custom-capable runtimes", () => {
    const availabilityRows = listRuntimeAvailabilityRows([credential("openai-compatible")]);
    const openCodeRow = availabilityRows.find((runtime) => runtime.runtimeId === "acp-fallback");
    const openAiRow = availabilityRows.find((runtime) => runtime.runtimeId === "openai-runtime");
    const claudeRow = availabilityRows.find((runtime) => runtime.runtimeId === "claude-agent-sdk");

    expect(openCodeRow).toMatchObject({
      status: "Ready · Custom model configured",
      tone: "ready",
    });
    expect(openAiRow).toMatchObject({
      status: "Needs key · Add OpenAI",
      tone: "muted",
    });
    expect(claudeRow).toMatchObject({
      status: "Needs key · Add Anthropic",
      tone: "muted",
    });
  });
});
