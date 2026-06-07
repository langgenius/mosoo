import { describe, expect, test } from "bun:test";

import { canSubmitAgentBuilderTurn } from "../src/routes/agent/components/agent-builder/agent-builder-submit-gate";

describe("Agent Builder submit gate", () => {
  test("allows Builder turns only when all async gates are idle", () => {
    expect(
      canSubmitAgentBuilderTurn({
        actionPending: false,
        autoApplyPending: false,
        historyError: null,
        systemAgentBusy: false,
        systemAgentReady: true,
      }),
    ).toBe(true);
  });

  test("blocks Builder turns while a control-plane action is pending", () => {
    expect(
      canSubmitAgentBuilderTurn({
        actionPending: true,
        autoApplyPending: false,
        historyError: null,
        systemAgentBusy: false,
        systemAgentReady: true,
      }),
    ).toBe(false);
  });
});
