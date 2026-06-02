import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { formatHarnessError } from "./harness-error";

const openAiApiKey = process.env["MOSOO_E2E_OPENAI_API_KEY"]?.trim() ?? "";

export type PreviewProviderId = "anthropic" | "openai";

export interface PreviewRuntimeCredential {
  apiKey: string;
  providerId: PreviewProviderId;
  runtimeButtonName: string;
}

export function createPreviewRunId(): string {
  return Date.now().toString(36);
}

export function getPreviewSmokeEmail(runId: string): string {
  return process.env["MOSOO_E2E_EMAIL"]?.trim() || `preview-smoke-${runId}@mosoo.ai`;
}

export function requireOpenAiApiKey(): string {
  if (!openAiApiKey) {
    throw new Error(
      formatHarnessError({
        fix: "Run `MOSOO_E2E_OPENAI_API_KEY=... vp run e2e:preview-smoke`, or record the missing credential in the PR / handoff evidence.",
        what: "Preview live runtime smoke cannot start because `MOSOO_E2E_OPENAI_API_KEY` is missing.",
        why: "L2 live runtime smoke proves provider readiness, Preview streaming, tool-call rendering, and sandbox output with real credentials.",
      }),
    );
  }

  return openAiApiKey;
}

export function requirePreviewRuntimeCredential(): PreviewRuntimeCredential {
  const providerId: PreviewProviderId =
    process.env["MOSOO_E2E_PROVIDER"]?.trim() === "anthropic" ? "anthropic" : "openai";
  const providerKey =
    process.env["MOSOO_E2E_PROVIDER_API_KEY"]?.trim() ||
    (providerId === "anthropic"
      ? process.env["MOSOO_E2E_ANTHROPIC_API_KEY"]?.trim()
      : process.env["MOSOO_E2E_OPENAI_API_KEY"]?.trim()) ||
    "";

  if (providerKey.length === 0) {
    throw new Error(
      formatHarnessError({
        fix: "Set `MOSOO_E2E_PROVIDER=anthropic MOSOO_E2E_PROVIDER_API_KEY=...`, or `MOSOO_E2E_PROVIDER=openai MOSOO_E2E_PROVIDER_API_KEY=...`.",
        what: "Preview latency smoke cannot start because the provider credential is missing.",
        why: "Live dispatch latency must be measured against the runtime provider that owns the selected agent.",
      }),
    );
  }

  return {
    apiKey: providerKey,
    providerId,
    runtimeButtonName: providerId === "anthropic" ? "Claude" : "OpenAI",
  };
}

export async function maybeClick(locator: Locator, timeout = 2_000): Promise<boolean> {
  try {
    await locator.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

function getProviderLabelPattern(providerId: PreviewProviderId): RegExp {
  return providerId === "anthropic" ? /\bAnthropic\b/iu : /\bOpenAI\b/iu;
}

async function openEmailLoginForm(page: Page): Promise<void> {
  await page.goto("/login");

  const emailInput = page.getByPlaceholder("you@company.com");
  const emailInputAlreadyVisible = await emailInput
    .isVisible({
      timeout: 2_000,
    })
    .catch(() => false);

  if (emailInputAlreadyVisible) {
    return;
  }

  const legacyContinueButton = page.getByRole("button", {
    name: "Continue with email or Google",
  });
  const clickedLegacyContinue = await maybeClick(legacyContinueButton);

  if (!clickedLegacyContinue) {
    await page.getByRole("button", { name: "Log in" }).first().click();
  }

  await expect(emailInput).toBeVisible({
    timeout: 15_000,
  });
}

async function waitForApiHealth(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const response = await page.request.get("/api/health", {
            timeout: 5_000,
          });

          if (!response.ok()) {
            return `status:${response.status()}`;
          }

          const payload: unknown = await response.json();

          if (payload !== null && typeof payload === "object" && "ok" in payload) {
            return payload.ok === true ? "ready" : "not-ready";
          }

          return "missing-ok";
        } catch (error) {
          return error instanceof Error ? error.message : "request-failed";
        }
      },
      {
        intervals: [500, 1_000, 2_000],
        timeout: 90_000,
      },
    )
    .toBe("ready");
}

export async function loginWithMosooAiBackdoor(page: Page, smokeEmail: string): Promise<void> {
  await waitForApiHealth(page);
  await openEmailLoginForm(page);
  await page.getByPlaceholder("you@company.com").fill(smokeEmail);
  await page.getByRole("button", { name: "Send code" }).click();

  const personalSetup = page.getByRole("button", {
    name: /Just trying it personally/i,
  });
  await maybeClick(personalSetup, 15_000);

  await expect(page.getByRole("link", { name: "Agents" })).toBeVisible({
    timeout: 60_000,
  });
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
  await expect(page.getByRole("dialog", { name: "Create Agent" })).toBeVisible();
  await page.getByLabel("Name").fill(input.name);
  await page
    .getByRole("button", { name: new RegExp(input.runtimeButtonName ?? "OpenAI", "iu") })
    .click();
  await page.getByRole("button", { name: "Create agent" }).click();
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

export async function configureOpenAiCompanyKey(
  page: Page,
  input: {
    runId: string;
  },
): Promise<void> {
  await configureProviderCompanyKey(page, {
    apiKey: requireOpenAiApiKey(),
    providerId: "openai",
    runId: input.runId,
  });
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
