import { describe, expect, test } from "bun:test";

import {
  ASSISTANT_LIMITED_ENVIRONMENT_REASON,
  getEnvironmentSelectionBlockReason,
} from "../src/routes/agent/components/editor/environment-picker-policy";

describe("Environment picker policy", () => {
  test("disables Limited Environments for Assistant Agents with a visible reason", () => {
    expect(getEnvironmentSelectionBlockReason({ kind: "pet", networkPolicy: "limited" })).toBe(
      ASSISTANT_LIMITED_ENVIRONMENT_REASON,
    );
  });

  test("keeps Full Assistant and Task Agent Environments selectable", () => {
    expect(getEnvironmentSelectionBlockReason({ kind: "pet", networkPolicy: "full" })).toBeNull();
    expect(
      getEnvironmentSelectionBlockReason({ kind: "cattle", networkPolicy: "limited" }),
    ).toBeNull();
  });
});
