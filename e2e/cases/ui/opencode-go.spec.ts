import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { installConsoleFixtures } from "../../lib/console-fixtures";

for (const width of [1440, 390]) {
  test(`Go credentials stay separate from Zen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installConsoleFixtures(page);
    await page.goto("/providers");

    const go = page.locator("section").filter({
      has: page.getByRole("heading", { name: "OpenCode Go", exact: true }),
    });
    await expect(go).toBeVisible();
    await expect(page.getByRole("heading", { name: "OpenCode Zen", exact: true })).toBeVisible();
    const output = ".tmp/e2e/opencode-go";
    mkdirSync(output, { recursive: true });
    await go.screenshot({ path: `${output}/provider-${width}.png` });
    await go.getByRole("button", { name: "Add key", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add OpenCode Go key" })).toBeVisible();
    await expect(dialog.getByLabel("API key", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Base URL", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await dialog.screenshot({ path: `${output}/dialog-${width}.png` });
  });
}
