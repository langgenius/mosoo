import { describe, expect, test } from "bun:test";

import { hasRunUiThread } from "../src/routes/app-overview/use-onboarding-progress";

describe("App Overview onboarding progress", () => {
  test("keeps Preview sessions and unrun UI Threads incomplete", () => {
    expect(
      hasRunUiThread([
        { session: { lastRun: {}, type: "preview" } },
        { session: { lastRun: null, type: "ui" } },
      ]),
    ).toBe(false);
  });

  test("completes after a UI Thread has a Run", () => {
    expect(hasRunUiThread([{ session: { lastRun: {}, type: "ui" } }])).toBe(true);
  });
});
