import { describe, expect, test } from "bun:test";

import { SESSION_SYSTEM_LOG_EVENT_FAMILIES } from "@mosoo/contracts/session";

import {
  SYSTEM_LOG_RUNTIME_EVENT_FAMILY_OPTIONS,
  formatFamilyFilterLabel,
} from "../src/routes/agent/components/system-log-model";

describe("system log model", () => {
  test("formats system log family filter choices for the UI", () => {
    const optionValues = SYSTEM_LOG_RUNTIME_EVENT_FAMILY_OPTIONS.map((option) => option.value);
    const firstFamily = optionValues[0];

    if (firstFamily === undefined) {
      throw new Error("Expected at least one system log family filter option.");
    }

    expect(new Set(optionValues).size).toBe(optionValues.length);
    expect(optionValues).toEqual([...SESSION_SYSTEM_LOG_EVENT_FAMILIES]);
    expect(
      SYSTEM_LOG_RUNTIME_EVENT_FAMILY_OPTIONS.every(
        (option) => option.label.length > 0 && option.value.length > 0,
      ),
    ).toBe(true);
    expect(formatFamilyFilterLabel(new Set([firstFamily]))).toBe(firstFamily);
  });
});
