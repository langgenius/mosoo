import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { loginWithMosooAiBackdoor } from "../../lib/dev-auth";
import { requirePreviewRuntimeCredential } from "../../lib/env-preflight";
import {
  configureProviderCompanyKey,
  createPreviewRuntimeAgent,
  createPreviewRunId,
  getPreviewSmokeEmail,
  verifyPreviewReadinessBlocker,
} from "../../lib/setup-agent";

const runId = createPreviewRunId();
const smokeEmail = getPreviewSmokeEmail(runId);
const smokeAgentName = `Preview smoke ${runId}`;

async function sendPreviewMessageAndVerifyRealStream(page: Page, agentId: string): Promise<void> {
  await page.goto(`/agent/${agentId}?tab=preview`);
  await expect(page.getByTestId("agent-preview-panel")).toBeVisible();
  await expect(page.getByTestId("agent-session-pill")).toContainText("Ready", {
    timeout: 30_000,
  });

  await page
    .getByTestId("agent-session-composer-input")
    .fill("Run `pwd` in the sandbox, then reply with the path you observed.");
  await page.getByTestId("agent-session-send").click();
  await expect(page.getByTestId("agent-session-pill")).toContainText("Working", {
    timeout: 60_000,
  });

  const toolCard = page.getByTestId("session-tool-call-card").first();

  await expect(toolCard).toBeVisible({
    timeout: 180_000,
  });
  const toolOutputPath = toolCard
    .locator("pre")
    .filter({ hasText: /\/[^\s]+/u })
    .first();
  await expect(toolOutputPath).toHaveText(/\/[^\s]+/u, {
    timeout: 180_000,
  });
  const toolCardIsOpen = await toolCard.evaluate(
    (element) => element instanceof HTMLDetailsElement && element.open,
  );
  if (!toolCardIsOpen) {
    await toolCard.locator("summary").click();
  }
  await expect(toolOutputPath).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByTestId("agent-session-pill")).toContainText("Ready", {
    timeout: 180_000,
  });
}

async function verifyDiagnostics(page: Page, agentId: string): Promise<void> {
  await page.goto(`/agent/${agentId}?tab=logs`);
  const diagnostics = page.getByTestId("agent-diagnostics-logs");

  await expect(diagnostics).toBeVisible();
}

test("Preview E2E smoke covers mosoo.ai login, blockers, stream, tool, pill, and diagnostics", async ({
  page,
}) => {
  const runtimeCredential = requirePreviewRuntimeCredential();

  await loginWithMosooAiBackdoor(page, smokeEmail);
  const agentId = await createPreviewRuntimeAgent(page, {
    name: smokeAgentName,
    runtimeButtonName: runtimeCredential.runtimeButtonName,
  });
  await verifyPreviewReadinessBlocker(page, agentId);
  await configureProviderCompanyKey(page, {
    apiKey: runtimeCredential.apiKey,
    providerId: runtimeCredential.providerId,
    runId,
  });
  await sendPreviewMessageAndVerifyRealStream(page, agentId);
  await verifyDiagnostics(page, agentId);
});
