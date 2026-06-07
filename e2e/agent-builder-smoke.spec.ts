import { expect, test } from "@playwright/test";

import {
  createPreviewRunId,
  createPreviewRuntimeAgent,
  getPreviewSmokeEmail,
  loginWithMosooAiBackdoor,
} from "./preview-live-harness";

const runId = createPreviewRunId();
const smokeEmail = getPreviewSmokeEmail(runId);
const smokeAgentName = `Agent Builder smoke ${runId}`;

test("Agent Builder dev panel loads with assistant-ui runtime provider", async ({ page }) => {
  await loginWithMosooAiBackdoor(page, smokeEmail);
  const agentId = await createPreviewRuntimeAgent(page, {
    name: smokeAgentName,
  });

  await page.goto(`/agent/${agentId}?tab=dev`);

  await expect(page.getByText("No Builder messages yet")).toBeVisible();
  await expect(page.getByLabel("Message Agent Builder")).toBeVisible();
  await expect(page.getByText("Agent type")).toBeVisible();
  await expect(page.getByRole("button", { name: /Test in Chat/iu })).toBeVisible();
});
