import { describe, expect, test } from "bun:test";

import { PUBLIC_RUNTIME_CATALOG, listPlannedRuntimeDisplayEntries } from "@mosoo/runtime-catalog";

import type { VendorCredential } from "../src/domains/vendor-credential/api/vendor-credential-client";
import { listRuntimeAvailabilityRows } from "../src/routes/providers/runtime-availability-model";

function credential(vendorId: string, overrides: Partial<VendorCredential> = {}): VendorCredential {
  return {
    apiBase: null,
    id: "01J000000000000000000000AA",
    isDefault: true,
    maskedApiKey: "sk-***",
    modelProtocol: null,
    models: null,
    name: "Default",
    projectId: "01J00000000000000000000009",
    vendorId,
    ...overrides,
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
      status: "Configured · Gemini",
      tone: "ready",
    });
  });

  test("marks Zhipu credentials as OpenCode-ready through the catalog adapter mapping", () => {
    const availabilityRows = listRuntimeAvailabilityRows([credential("zhipu")]);
    const openCodeRow = availabilityRows.find((runtime) => runtime.runtimeId === "acp-fallback");

    expect(openCodeRow).toMatchObject({
      status: "Configured · Zhipu",
      tone: "ready",
    });
  });

  test("only configures runtimes compatible with the declared custom protocol", () => {
    const availabilityRows = listRuntimeAvailabilityRows([
      credential("openai-compatible", {
        modelProtocol: "openai-chat-completions",
        models: ["custom-model"],
        name: "Chat gateway",
      }),
    ]);
    const openCodeRow = availabilityRows.find((runtime) => runtime.runtimeId === "acp-fallback");
    const openAiRow = availabilityRows.find((runtime) => runtime.runtimeId === "openai-runtime");
    const claudeRow = availabilityRows.find((runtime) => runtime.runtimeId === "claude-agent-sdk");

    expect(openCodeRow).toMatchObject({
      status: "Configured · Chat gateway",
      tone: "ready",
    });
    expect(openAiRow).toMatchObject({
      status: "No compatible models · Check provider protocol and models",
      tone: "muted",
    });
    expect(claudeRow).toMatchObject({
      status: "Needs key · Add Anthropic",
      tone: "muted",
    });
  });

  test.each([
    "openai-chat-completions",
    "openai-responses",
    "anthropic-messages",
    "google-gemini",
  ] as const)("Pi and OpenCode accept declared %s custom models", (modelProtocol) => {
    const rows = listRuntimeAvailabilityRows([
      credential("openai-compatible", {
        modelProtocol,
        models: ["custom-model"],
      }),
    ]);
    for (const runtimeId of ["pi", "acp-fallback"]) {
      expect(rows.find((row) => row.runtimeId === runtimeId)?.tone).toBe("ready");
    }
    expect(rows.find((row) => row.runtimeId === "openai-runtime")?.tone).toBe(
      modelProtocol === "openai-responses" ? "ready" : "muted",
    );
    expect(rows.find((row) => row.runtimeId === "claude-agent-sdk")?.tone).toBe("muted");
  });

  test("shows legacy custom protocol as unspecified rather than ready", () => {
    const rows = listRuntimeAvailabilityRows([
      credential("openai-compatible", {
        models: ["legacy-model"],
        name: "Legacy gateway",
      }),
    ]);
    for (const runtimeId of ["pi", "acp-fallback", "openai-runtime"]) {
      expect(rows.find((row) => row.runtimeId === runtimeId)).toMatchObject({
        status: "Protocol unspecified · Legacy gateway",
        tone: "muted",
      });
    }
  });

  test("requires an actual declared custom model", () => {
    const rows = listRuntimeAvailabilityRows([
      credential("openai-compatible", {
        modelProtocol: "openai-responses",
      }),
    ]);
    for (const runtimeId of ["pi", "acp-fallback", "openai-runtime"]) {
      expect(rows.find((row) => row.runtimeId === runtimeId)?.tone).toBe("muted");
    }
  });

  test("Pi uses the protocol of a configured preset model", () => {
    const rows = listRuntimeAvailabilityRows([credential("gemini")]);
    expect(rows.find((row) => row.runtimeId === "pi")).toMatchObject({
      status: "Configured · Gemini",
      tone: "ready",
    });
  });

  test("does not advertise an unreachable duplicate custom model credential", () => {
    const rows = listRuntimeAvailabilityRows([
      credential("openai-compatible", {
        id: "01J000000000000000000000AB",
        modelProtocol: "openai-responses",
        models: ["shared-model"],
        name: "B responses",
      }),
      credential("openai-compatible", {
        modelProtocol: "openai-chat-completions",
        models: ["shared-model"],
        name: "A chat",
      }),
    ]);
    expect(rows.find((row) => row.runtimeId === "openai-runtime")?.tone).toBe("muted");
  });
});
