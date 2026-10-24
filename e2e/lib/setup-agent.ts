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

  const waitForAgentResponse = () =>
    page
      .waitForRequest((request) => {
        if (!request.url().endsWith("/api/graphql")) return false;
        const body = request.postDataJSON() as {
          query?: string;
          variables?: { agentId?: string };
        };
        return (
          /\bquery\s+Agent\s*\(/u.test(body.query ?? "") && body.variables?.agentId === agentId
        );
      })
      .then(async (request) => {
        const response = await request.response();
        if (response === null) throw new Error("Preview Agent request did not receive a response.");
        return response;
      });
  const [loaded] = await Promise.all([
    waitForAgentResponse(),
    page.goto(`/agent/${agentId}?tab=preview`),
  ]);
  expect(loaded.ok()).toBe(true);
  const initial = (await loaded.json()) as {
    data?: { agent?: { id: string; model: string | null; provider: string | null } };
    errors?: unknown[];
  };
  expect(initial.errors).toBeUndefined();
  expect(initial.data?.agent).toMatchObject({ id: agentId });
  const modelField = page.getByText("Model", { exact: true }).locator("..");
  await modelField.getByRole("button").click();
  const option = page.getByRole("menuitem").filter({
    hasText: `${preset.vendorLabel} · ${preset.modelId}`,
  });
  await expect(option).toBeEnabled();
  if (
    initial.data?.agent?.model === input.modelId &&
    initial.data.agent.provider === input.providerId
  ) {
    await page.keyboard.press("Escape");
  } else {
    const [savedResponse] = await Promise.all([
      page.waitForResponse((response) => {
        if (!response.url().endsWith("/api/graphql")) return false;
        const request = response.request().postDataJSON() as {
          query?: string;
          variables?: { input?: { agentId?: string; model?: string; provider?: string } };
        };
        return (
          request.query?.includes("UpdateAgentConfig") === true &&
          request.variables?.input?.agentId === agentId &&
          request.variables.input.model === input.modelId &&
          request.variables.input.provider === input.providerId
        );
      }),
      option.click(),
    ]);
    expect(savedResponse.ok()).toBe(true);
    expect(((await savedResponse.json()) as { errors?: unknown[] }).errors).toBeUndefined();
  }
  // Watch requests from the new document so the mutation's refetch cannot
  // satisfy the persistence check before navigation commits.
  const [reloaded] = await Promise.all([
    page
      .waitForEvent("framenavigated", (frame) => frame === page.mainFrame())
      .then(waitForAgentResponse),
    page.reload(),
  ]);
  expect(reloaded.ok()).toBe(true);
  const persisted = (await reloaded.json()) as typeof initial;
  expect(persisted.errors).toBeUndefined();
  expect(
    persisted.data?.agent,
    "Reloaded Preview Agent must retain id, provider, and model",
  ).toMatchObject({
    id: agentId,
    model: input.modelId,
    provider: input.providerId,
  });
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
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(`Preview smoke ${input.runId}`);
  await dialog.getByLabel("API key", { exact: true }).fill(input.apiKey);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const savedCredential = providerCard.locator('[data-slot="connection-row"]').filter({
    has: page.getByText(`Preview smoke ${input.runId}`, { exact: true }),
  });
  await expect(savedCredential).toBeVisible();
  const setDefaultButton = savedCredential.getByRole("button", {
    name: "Set default",
    exact: true,
  });
  if (await setDefaultButton.isVisible()) {
    await setDefaultButton.click();
  }
  await expect(savedCredential.getByText("Default", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}
