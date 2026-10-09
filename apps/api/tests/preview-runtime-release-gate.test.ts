import { describe, expect, test } from "bun:test";

import {
  SUPPORTED_DRIVER_RUNTIMES,
  SUPPORTED_DRIVER_RUNTIME_TRANSPORTS,
} from "@mosoo/agent-driver/runtime";
import { RUNTIME_CATALOG } from "@mosoo/runtime-catalog";

describe("Preview runtime release gate", () => {
  test("offers only runtimes and transports the pinned Driver supports", () => {
    for (const runtime of RUNTIME_CATALOG) {
      expect(SUPPORTED_DRIVER_RUNTIMES).toContain(runtime.runtimeId);
      expect(SUPPORTED_DRIVER_RUNTIME_TRANSPORTS).toContain(runtime.transport);
    }
  });
});
