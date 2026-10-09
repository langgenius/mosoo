import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

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
  await page.goto("/login");

  const emailInput = page.getByPlaceholder("you@company.com");

  await expect(emailInput).toBeVisible();
  await emailInput.fill(smokeEmail);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("link", { name: "Agents" })).toBeVisible({
    timeout: 60_000,
  });
}
