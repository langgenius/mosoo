import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { maybeClick } from "./setup-agent";

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

async function completePostLoginOnboarding(page: Page): Promise<void> {
  const agentsLink = page.getByRole("link", { name: "Agents" });
  const agentsLinkAlreadyVisible = await agentsLink
    .isVisible({
      timeout: 3_000,
    })
    .catch(() => false);

  if (agentsLinkAlreadyVisible) {
    return;
  }

  const domainOrganizationSetup = page.getByRole("button", {
    name: /Create .+ organization/i,
  });
  const createOwnOrganization = page.getByRole("button", {
    name: /Create my own organization/i,
  });
  const personalSetup = page.getByRole("button", {
    name: /Just trying it personally/i,
  });

  (await maybeClick(domainOrganizationSetup, 15_000)) ||
    (await maybeClick(createOwnOrganization, 2_000)) ||
    (await maybeClick(personalSetup, 2_000));

  await expect(agentsLink).toBeVisible({
    timeout: 60_000,
  });
}

export async function loginWithMosooAiBackdoor(page: Page, smokeEmail: string): Promise<void> {
  await waitForApiHealth(page);
  await openEmailLoginForm(page);
  await page.getByPlaceholder("you@company.com").fill(smokeEmail);
  await page.getByRole("button", { name: "Send code" }).click();

  await completePostLoginOnboarding(page);
}
