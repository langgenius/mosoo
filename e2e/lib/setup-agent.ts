import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import type { PreviewProviderId } from "./env-preflight";

export function createPreviewRunId(): string {
  return Date.now().toString(36);
}

export function getPreviewSmokeEmail(runId: string): string {
  return process.env["MOSOO_E2E_EMAIL"]?.trim() || `preview-smoke-${runId}@mosoo.ai`;
}

function getProviderLabelPattern(providerId: PreviewProviderId): RegExp {
  return providerId === "anthropic" ? /\bAnthropic\b/iu : /\bOpenAI\b/iu;
}

export async function createPreviewRuntimeAgent(
  page: Page,
  input: {
    name: string;
    runtimeButtonName?: string;
  },
): Promise<string> {
  await page.goto("/agent");
  await page.getByRole("button", { name: "Create agent" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New agent" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(input.name);
  await dialog
    .getByRole("button", { name: new RegExp(input.runtimeButtonName ?? "OpenAI", "iu") })
    .click();
  await dialog.getByRole("button", { exact: true, name: "Create" }).click();
  await page.waitForURL(/\/agent\/[^/?#]+/u, { timeout: 30_000 });

  const match = /\/agent\/([^/?#]+)/u.exec(new URL(page.url()).pathname);

  if (!match?.[1]) {
    throw new Error(`Could not resolve created agent id from URL: ${page.url()}`);
  }

  return match[1];
}

export async function verifyPreviewReadinessBlocker(page: Page, agentId: string): Promise<void> {
  await page.goto(`/agent/${agentId}?tab=preview`);
  await expect(page.getByTestId("agent-preview-panel")).toBeVisible();
  await expect(page.getByTestId("agent-session-pill")).toBeVisible();
  await expect(page.getByTestId("agent-readiness-blockers")).toBeVisible();
  await page.getByTestId("agent-session-composer-input").fill("Readiness blocker check");
  await expect(page.getByTestId("agent-session-send")).toBeDisabled();
}

export async function configureProviderCompanyKey(
  page: Page,
  input: {
    apiKey: string;
    providerId: PreviewProviderId;
    runId: string;
  },
): Promise<void> {
  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();

  const providerCard = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: getProviderLabelPattern(input.providerId) }) })
    .filter({ has: page.getByRole("button", { name: "Add Key" }) })
    .first();
  await providerCard.getByRole("button", { name: "Add Key" }).click();
  await providerCard.getByPlaceholder("e.g. Production").fill(`Preview smoke ${input.runId}`);
  await providerCard.getByPlaceholder("sk-...").fill(input.apiKey);
  await providerCard.getByLabel("Use as default credential for this provider").check();
  await providerCard.getByRole("button", { name: "Save" }).click();
  await expect(providerCard.getByText("Default")).toBeVisible({
    timeout: 30_000,
  });
}
