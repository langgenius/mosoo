import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  configureProviderCompanyKey,
  createPreviewRuntimeAgent,
  createPreviewRunId,
  getPreviewSmokeEmail,
  loginWithMosooAiBackdoor,
  maybeClick,
  requirePreviewRuntimeCredential,
  verifyPreviewReadinessBlocker,
} from "./preview-live-harness";
import { createRuntimeSignalCollector } from "./runtime-signal-collector";

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
  await expect(page.getByTestId("agent-session-pill")).toContainText(/Working|Needs approval/u, {
    timeout: 60_000,
  });

  const allowOnce = page.getByRole("button", { name: "Allow once" });
  await maybeClick(allowOnce, 10_000);

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
}, testInfo) => {
  const runtimeCredential = requirePreviewRuntimeCredential();

  const runtimeSignals = createRuntimeSignalCollector({
    source: "preview-smoke",
  });

  runtimeSignals.attachToPage(page);
  await runtimeSignals.sampleResources(page, "before-preview-smoke");
  runtimeSignals.checkpoint("preview.login.start", {
    email: smokeEmail,
  });
  await loginWithMosooAiBackdoor(page, smokeEmail);
  runtimeSignals.checkpoint("preview.agent.create.start", {
    agentName: smokeAgentName,
  });
  const agentId = await createPreviewRuntimeAgent(page, {
    name: smokeAgentName,
    runtimeButtonName: runtimeCredential.runtimeButtonName,
  });
  runtimeSignals.checkpoint("preview.readiness.blocker.start", {
    agentId,
  });
  await verifyPreviewReadinessBlocker(page, agentId);
  runtimeSignals.checkpoint("preview.provider.configure.start", {
    agentId,
    provider: runtimeCredential.providerId,
  });
  await configureProviderCompanyKey(page, {
    apiKey: runtimeCredential.apiKey,
    providerId: runtimeCredential.providerId,
    runId,
  });
  runtimeSignals.checkpoint("preview.real-stream.start", {
    agentId,
  });
  await sendPreviewMessageAndVerifyRealStream(page, agentId);
  runtimeSignals.checkpoint("preview.diagnostics.start", {
    agentId,
  });
  await verifyDiagnostics(page, agentId);
  await runtimeSignals.sampleResources(page, "after-preview-smoke");
  runtimeSignals.checkpoint("preview.exit", {
    agentId,
  });
  runtimeSignals.assertCoverage();
  await runtimeSignals.attachArtifact(testInfo);
});
