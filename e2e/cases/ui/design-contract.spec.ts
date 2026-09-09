import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { installConsoleFixtures } from "../../lib/console-fixtures";

// Console design-contract acceptance (langgenius/mosoo#599, #601, #605): the
// shell plus the settings/list surfaces that the contract's component recipes
// govern. Every API projection is a fixture, so the case needs no provider keys
// and doubles as the screenshot capture for design review. PNGs land in
// .tmp/e2e/design-contract/<label>/ where the label defaults to "after";
// `MOSOO_E2E_DESIGN_LABEL=before` captures the same views from a pre-change
// checkout for the side-by-side evidence in docs/design/console-design-contract.md.

const LABEL = process.env["MOSOO_E2E_DESIGN_LABEL"]?.trim() || "after";
const SCREENSHOT_DIR = fileURLToPath(
  new URL(`../../../.tmp/e2e/design-contract/${LABEL}/`, import.meta.url),
);

const DESKTOP = { height: 900, width: 1440 } as const;
const NARROW = { height: 844, width: 390 } as const;

// Contract measurements (docs/design/console-design-contract.md, section 4).
const CONTRACT = {
  badgeHeight: 20,
  badgeRadius: 6,
  buttonHeight: 32,
  buttonRadius: 10,
  connectionRowMinHeight: 44,
  dataRowMinHeight: 40,
  switchThumb: 10,
  switchTrack: { height: 14, width: 24 },
} as const;

async function screenshot(
  page: Page,
  name: string,
  target?: Locator,
  clip?: { height: number; width: number },
): Promise<void> {
  if (target) {
    await target.screenshot({ path: `${SCREENSHOT_DIR}${name}.png` });
    return;
  }

  await page.screenshot({
    path: `${SCREENSHOT_DIR}${name}.png`,
    ...(clip ? { clip: { x: 0, y: 0, ...clip } } : {}),
  });
}

async function boxOf(locator: Locator): Promise<{ height: number; width: number }> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { height: Math.round(box?.height ?? 0), width: Math.round(box?.width ?? 0) };
}

async function styleOf(locator: Locator, property: string): Promise<string> {
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name).trim(),
    property,
  );
}

async function radiusOf(locator: Locator): Promise<number> {
  return Number.parseFloat(await styleOf(locator, "border-top-left-radius"));
}

// WCAG relative luminance contrast between an element's text and the nearest
// opaque background behind it, computed in the page so it sees the resolved
// colours (tokens, theme, and any tint layers) rather than the authored ones.
async function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    function parse(color: string): [number, number, number, number] {
      const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/u.exec(color);
      if (!match) {
        return [255, 255, 255, 0];
      }
      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] === undefined ? 1 : Number(match[4]),
      ];
    }
    function blend(
      top: [number, number, number, number],
      bottom: [number, number, number],
    ): [number, number, number] {
      const alpha = top[3];
      return [
        top[0] * alpha + bottom[0] * (1 - alpha),
        top[1] * alpha + bottom[1] * (1 - alpha),
        top[2] * alpha + bottom[2] * (1 - alpha),
      ];
    }
    function luminance([r, g, b]: [number, number, number]): number {
      const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    const layers: [number, number, number, number][] = [];
    let node: Element | null = element;
    while (node) {
      const background = parse(getComputedStyle(node).backgroundColor);
      if (background[3] > 0) {
        layers.push(background);
        if (background[3] >= 1) {
          break;
        }
      }
      node = node.parentElement;
    }
    let resolved: [number, number, number] = [255, 255, 255];
    for (const layer of layers.toReversed()) {
      resolved = blend(layer, resolved);
    }
    const text = blend(parse(getComputedStyle(element).color), resolved);
    const lighter = Math.max(luminance(text), luminance(resolved));
    const darker = Math.min(luminance(text), luminance(resolved));
    return (lighter + 0.05) / (darker + 0.05);
  });
}

// Wait for the targeted transitions (120-180ms) on an element to finish before
// reading a state colour or capturing it, so assertions see the settled state.
async function settle(locator: Locator): Promise<void> {
  await locator.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map(async (animation) => animation.finished));
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function focusByKeyboard(page: Page, target: Locator): Promise<void> {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  for (let step = 0; step < 60; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test("Providers: sections, credential rows, badges, and the credential dialog states", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await installConsoleFixtures(page);
  await page.goto("/providers");

  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();
  await expect(page.getByText("Production").first()).toBeVisible();
  await screenshot(page, "providers-1440x900");

  // Hover on a credential row, then keyboard focus on a row action: the two
  // states must read differently from each other and from rest.
  const firstCredentialRow = page.locator('main [data-slot="connection-row"]').first();
  const addKey = page.getByRole("button", { name: "Add key" }).first();
  await addKey.hover();
  await settle(addKey);
  await screenshot(page, "providers-hover", page.locator("main").first());
  await focusByKeyboard(page, addKey);
  await settle(addKey);
  expect(await styleOf(addKey, "box-shadow")).not.toBe("none");
  await screenshot(page, "providers-keyboard-focus", page.locator("main").first());

  // Dialog: rest, then invalid (submit with empty fields), then a disabled control.
  await addKey.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /Add .* key/u })).toBeVisible();
  await screenshot(page, "providers-dialog", dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByText(/required/u)).toBeVisible();
  await screenshot(page, "providers-dialog-invalid", dialog);
  await expect(dialog.getByRole("alert")).toBeVisible();
  const invalidInput = dialog.locator('[aria-invalid="true"]').first();
  await expect(invalidInput).toBeVisible();
  // The focus ring stays the same ring on an invalid field.
  await invalidInput.focus();
  expect(await styleOf(invalidInput, "box-shadow")).not.toBe("none");
  await screenshot(page, "providers-dialog-invalid-focus", dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Contract measurements on the shipped surface.
  expect(await boxOf(addKey)).toMatchObject({ height: CONTRACT.buttonHeight });
  expect(await radiusOf(addKey)).toBe(CONTRACT.buttonRadius);
  expect(await styleOf(addKey, "transition-property")).not.toContain("all");
  const defaultBadge = page.getByText("Default", { exact: true }).first();
  expect(await boxOf(defaultBadge)).toMatchObject({ height: CONTRACT.badgeHeight });
  expect(await radiusOf(defaultBadge)).toBe(CONTRACT.badgeRadius);
  expect(await contrastOf(defaultBadge)).toBeGreaterThanOrEqual(4.5);
  expect((await boxOf(firstCredentialRow)).height).toBeGreaterThanOrEqual(
    CONTRACT.connectionRowMinHeight,
  );
  // Nested radii step down from the card to the row to the control.
  const card = firstCredentialRow.locator("xpath=ancestor::section[1]");
  expect(await radiusOf(card)).toBeGreaterThan(await radiusOf(firstCredentialRow));
  const rowAction = firstCredentialRow.getByRole("button").first();
  expect(await radiusOf(firstCredentialRow)).toBeGreaterThanOrEqual(await radiusOf(rowAction));
});

test("Providers: narrow viewport keeps the header, actions, and rows readable", async ({
  page,
}) => {
  await page.setViewportSize(NARROW);
  await installConsoleFixtures(page);
  await page.goto("/providers");

  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "providers-390x844");
});

test("Environments: 40px data rows keep multiline content on the rhythm", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await installConsoleFixtures(page);
  await page.goto("/environment");

  await expect(page.getByRole("heading", { level: 1, name: "Environments" })).toBeVisible();
  await expect(page.getByText("Review runner (restricted egress)")).toBeVisible();
  await screenshot(page, "environments-1440x900");
  const rows = page.locator('[data-slot="data-row"]');
  await expect(rows).toHaveCount(3);

  for (const row of await rows.all()) {
    expect((await boxOf(row)).height).toBeGreaterThanOrEqual(CONTRACT.dataRowMinHeight);
  }
  // The row without a description is the single-line baseline.
  const singleLine = rows.filter({ hasText: "Docs builder" });
  expect((await boxOf(singleLine)).height).toBeGreaterThanOrEqual(CONTRACT.dataRowMinHeight);
  expect((await boxOf(singleLine)).height).toBeLessThanOrEqual(CONTRACT.dataRowMinHeight + 12);

  // Selected + disabled states on the same surface: the Create environment
  // dialog exposes the switch recipe and a dropdown select.
  await page.getByRole("button", { name: "Create environment" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The switches belong to the limited-network branch of the form.
  await dialog.getByRole("button", { exact: true, name: "Full" }).click();
  await page.getByRole("menuitem", { exact: true, name: "Limited" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const switches = dialog.getByRole("switch");
  await expect(switches.first()).toBeVisible();
  expect(await boxOf(switches.first())).toMatchObject(CONTRACT.switchTrack);
  const thumb = switches.first().locator('[data-slot="switch-thumb"]');
  expect(await boxOf(thumb)).toMatchObject({
    height: CONTRACT.switchThumb,
    width: CONTRACT.switchThumb,
  });
  await screenshot(page, "environments-create-dialog", dialog);
  await page.keyboard.press("Escape");
});

test("MCP servers: 44px connection rows with success, action, and disabled states", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await installConsoleFixtures(page);
  await page.goto("/integrations/mcp");

  await expect(page.getByRole("heading", { level: 1, name: "MCP servers" })).toBeVisible();
  await expect(page.getByText("Internal metrics")).toBeVisible();
  await screenshot(page, "mcp-1440x900");
  const rows = page.locator('[data-slot="connection-row"]');
  await expect(rows).toHaveCount(3);

  for (const row of await rows.all()) {
    expect((await boxOf(row)).height).toBeGreaterThanOrEqual(CONTRACT.connectionRowMinHeight);
  }
  const connected = rows.first().locator('[data-slot="badge"]', { hasText: /Authorized/u });
  await expect(connected).toBeVisible();
  expect(await boxOf(connected)).toMatchObject({ height: CONTRACT.badgeHeight });
  expect(await contrastOf(connected)).toBeGreaterThanOrEqual(4.5);
  // Success carries an icon as well as a colour.
  await expect(connected.locator("svg")).toHaveCount(1);

  // Disabled row: legible text, not a faded row.
  const disabledRow = rows.filter({ hasText: "Internal metrics" });
  expect(await styleOf(disabledRow, "opacity")).toBe("1");
  await expect(disabledRow.getByText("Disabled", { exact: true })).toBeVisible();

  await rows.nth(1).hover();
  await settle(rows.nth(1));
  await screenshot(page, "mcp-hover", page.locator("main").first());
});

test("Project settings: form fields, disabled and enabled primary action", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await installConsoleFixtures(page);
  await page.goto("/project-settings/general");

  const nameInput = page.getByLabel("Project name");
  await expect(nameInput).toHaveValue("Console redesign");
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  await screenshot(page, "settings-general-disabled");

  const disabledOpacity = await styleOf(save, "opacity");
  const disabledColor = await styleOf(save, "color");
  await nameInput.fill("Console redesign v2");
  await expect(save).toBeEnabled();
  await settle(save);
  await screenshot(page, "settings-general-enabled");
  await nameInput.focus();
  await settle(nameInput);
  await screenshot(page, "settings-general-input-focus");

  await page.goto("/project-settings/api-keys");
  await expect(page.locator('[data-slot="data-row"]', { hasText: "CI deploy" })).toBeVisible();
  await screenshot(page, "settings-api-keys-1440x900");

  // Disabled must not be an opacity fade; it changes the surface and text.
  await page.goto("/project-settings/general");
  await expect(save).toBeDisabled();
  expect(disabledOpacity).toBe("1");
  await nameInput.fill("Console redesign v2");
  await expect(save).toBeEnabled();
  await settle(save);
  expect(await styleOf(save, "color")).not.toBe(disabledColor);
  expect(await boxOf(save)).toMatchObject({ height: CONTRACT.buttonHeight });
  expect(await boxOf(nameInput)).toMatchObject({ height: CONTRACT.buttonHeight });
  expect(await radiusOf(nameInput)).toBe(CONTRACT.buttonRadius);
  await nameInput.focus();
  expect(await styleOf(nameInput, "box-shadow")).not.toBe("none");
});

test("Account settings: read-only field and secondary actions at narrow width", async ({
  page,
}) => {
  await page.setViewportSize(NARROW);
  await installConsoleFixtures(page);
  await page.goto("/settings/profile");

  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  await expectNoHorizontalOverflow(page);
  await screenshot(page, "settings-profile-390x844");
});

test("Agents: list rows show the name, tools, and a plain status, no id chips", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await installConsoleFixtures(page);
  await page.goto("/agent");
  await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
  await expect(page.getByText("Review bot")).toBeVisible();
  await screenshot(page, "agents-1440x900");

  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^ID:/u)).toHaveCount(0);
  await expect(page.getByText(/agent\.published/u)).toHaveCount(0);
});

test("Runs: dense rows stay on the 40px rhythm with working, done, and failed states", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await installConsoleFixtures(page);
  await page.goto("/threads");

  await expect(page.getByText("Review PR #612: scope API keys to projects")).toBeVisible();
  await expect(page.getByText("Summarise flaky test failures in apps/api")).toBeVisible();
  await screenshot(page, "runs-1440x900");

  const rows = page.locator('[data-slot="data-row"]');
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  for (const row of await rows.all()) {
    expect((await boxOf(row)).height).toBeGreaterThanOrEqual(CONTRACT.dataRowMinHeight);
  }
});

test("Dark theme tokens map every role on the same surface", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await installConsoleFixtures(page);
  await page.goto("/providers");
  await expect(page.getByText("Production").first()).toBeVisible();
  // The console ships no theme toggle yet; the `.dark` token block is applied
  // directly so the mapping can be reviewed on a real surface. Init scripts run
  // before the root element exists, so the class goes on after navigation.
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await settle(page.locator("body"));
  await page.waitForTimeout(250);
  await screenshot(page, "providers-dark-1440x900");

  const addKey = page.getByRole("button", { name: "Add key" }).first();
  expect(await contrastOf(addKey)).toBeGreaterThanOrEqual(4.5);
  const defaultBadge = page.getByText("Default", { exact: true }).first();
  expect(await contrastOf(defaultBadge)).toBeGreaterThanOrEqual(4.5);
  const description = page.locator("main p").first();
  expect(await contrastOf(description)).toBeGreaterThanOrEqual(4.5);
});

test("Typography roles resolve to the contract families", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await installConsoleFixtures(page);
  await page.goto("/providers");

  const title = page.getByRole("heading", { name: "Providers" });
  await expect(title).toBeVisible();
  const families = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      heading: root.getPropertyValue("--font-heading").trim(),
      mono: root.getPropertyValue("--font-mono").trim(),
      sans: root.getPropertyValue("--font-sans").trim(),
    };
  });
  // Computed font-family normalises quoting, so compare the leading family.
  const leadingFamily = (stack: string): string =>
    stack.split(",")[0]?.replaceAll('"', "").trim() ?? "";
  expect(leadingFamily(families.heading)).toBe("Instrument Sans");
  expect(leadingFamily(await styleOf(title, "font-family"))).toBe(leadingFamily(families.heading));
  expect(await styleOf(title, "font-weight")).toBe("500");
  const id = page.locator('[data-slot="mono"]').first();
  await expect(id).toBeVisible();
  expect(leadingFamily(await styleOf(id, "font-family"))).toBe(leadingFamily(families.mono));
  expect(leadingFamily(families.mono)).toBe("IBM Plex Mono");
  expect(leadingFamily(families.sans)).toBe("Geist");
});
