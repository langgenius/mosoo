import { describe, expect, test } from "bun:test";

import { PUBLIC_RUNTIME_CATALOG, RUNTIME_CATALOG } from "@mosoo/runtime-catalog";
import {
  SUPPORTED_DRIVER_RUNTIMES,
  SUPPORTED_DRIVER_RUNTIME_TRANSPORTS,
} from "agent-driver/runtime";

describe("Preview runtime release gate", () => {
  test("maps public Preview live smoke providers to public driver runtimes", () => {
    expect(PUBLIC_RUNTIME_CATALOG.map((runtime) => runtime.runtimeId).toSorted()).toEqual([
      "acp-fallback",
      "claude-agent-sdk",
      "openai-runtime",
    ]);
    expect(PUBLIC_RUNTIME_CATALOG.map((runtime) => runtime.transport).toSorted()).toEqual([
      "acp-fallback",
      "claude-agent-sdk",
      "openai-app-server",
    ]);

    for (const runtime of PUBLIC_RUNTIME_CATALOG) {
      expect(SUPPORTED_DRIVER_RUNTIMES).toContain(runtime.runtimeId);
      expect(SUPPORTED_DRIVER_RUNTIME_TRANSPORTS).toContain(runtime.transport);
    }
  });

  test("exposes ACP fallback as the public OpenCode runtime", () => {
    const acpRuntime = RUNTIME_CATALOG.find((runtime) => runtime.runtimeId === "acp-fallback");

    expect(acpRuntime).toMatchObject({
      label: "OpenCode",
      runtimeId: "acp-fallback",
      transport: "acp-fallback",
      visibility: "public",
    });
    expect(SUPPORTED_DRIVER_RUNTIMES).toContain("acp-fallback");
    expect(SUPPORTED_DRIVER_RUNTIME_TRANSPORTS).toContain("acp-fallback");
  });
});
