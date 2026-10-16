import { getPresetModel } from "@mosoo/runtime-catalog";
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
  return providerId === "anthropic"
    ? /\bAnthropic\b/iu
    : providerId === "gemini"
      ? /\bGemini\b/iu
      : /\bOpenAI\b/iu;
}

export async function configurePreviewRuntimeModel(
  page: Page,
  agentId: string,
  input: { modelId: string; providerId: PreviewProviderId },
): Promise<void> {
  const preset = getPresetModel({ modelId: input.modelId, vendorId: input.providerId });
  if (preset === null) throw new Error("Preview E2E requires an admitted preset model.");

  await page.goto(`/agent/${agentId}?tab=preview`);
  const modelField = page.getByText("Model", { exact: true }).locator("..");
  await modelField.getByRole("button").click();
  const option = page.getByRole("menuitem").filter({
    hasText: `${preset.vendorLabel} · ${preset.modelId}`,
  });
  await expect(option).toBeEnabled();
  const saved = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/graphql")) return false;
    const request = response.request().postDataJSON() as {
      query?: string;
      variables?: { input?: { model?: string } };
    };
    return (
      request.query?.includes("UpdateAgentConfig") === true &&
      request.variables?.input?.model === input.modelId
    );
  });
  await option.click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(((await response.json()) as { errors?: unknown[] }).errors).toBeUndefined();
  await page.reload();
  await expect(modelField.getByRole("button")).toContainText(preset.displayName);
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
