import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installConsoleFixtures } from "../../lib/console-fixtures";

// Typography proof for the Console design contract (langgenius/mosoo#599,
// section 1a). Renders identical Providers, Runs, and Settings surfaces with
// the same fixture data and only the type-role families swapped, so the delta
// under review is typography alone. PNGs land in .tmp/e2e/typography-proof/<variant>/.
//
// Variants:
// - current:         Geist for headings, Geist Mono for precise information.
// - general-sans:    General Sans 500 headings (loaded from the Fontshare API,
//                    the only delivery the ITF Free Font License allows for an
//                    open-source repository) plus IBM Plex Mono.
// - instrument-sans: Instrument Sans 500 headings (SIL OFL, self-hosted) plus
//                    IBM Plex Mono. This is the shipped default.

const OUTPUT_ROOT = fileURLToPath(new URL("../../../.tmp/e2e/typography-proof/", import.meta.url));

type Variant = "current" | "general-sans" | "instrument-sans";

const VARIANTS: readonly Variant[] = ["current", "general-sans", "instrument-sans"];

// General Sans is evaluated only. The ITF Free Font License permits self-hosting
// for the licensee's own use but forbids redistributing the binaries, so the
// proof fetches the official Fontshare files into the gitignored .tmp folder
// and serves them to the page from there; nothing is committed.
const PROOF_FONT_DIR = `${OUTPUT_ROOT}fonts/`;
const GENERAL_SANS_FILES = {
  "GeneralSans-Medium.woff2":
    "https://cdn.fontshare.com/wf/3RZHWSNONLLWJK3RLPEKUZOMM56GO4LJ/BPDRY7AHVI3MCDXXVXTQQ76H3UXA63S3/SB2OEB6IKZPRR6JT4GFJ2TFT6HBB6AZN.woff2",
  "GeneralSans-Semibold.woff2":
    "https://cdn.fontshare.com/wf/K46YRH762FH3QJ25IQM3VAXAKCHEXXW4/ISLWQPUZHZF33LRIOTBMFOJL57GBGQ4B/3ZLMEXZEQPLTEPMHTQDAUXP5ZZXCZAEN.woff2",
} as const;

async function ensureGeneralSansFiles(): Promise<void> {
  mkdirSync(PROOF_FONT_DIR, { recursive: true });
  for (const [file, url] of Object.entries(GENERAL_SANS_FILES)) {
    const target = `${PROOF_FONT_DIR}${file}`;
    if (existsSync(target)) {
      continue;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not fetch ${file} from Fontshare (${response.status}).`);
    }
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
}

async function serveGeneralSans(page: Page): Promise<void> {
  await page.route("**/__proof-fonts/*.woff2", async (route) => {
    const file = route.request().url().split("/").at(-1) ?? "";
    await route.fulfill({
      body: readFileSync(`${PROOF_FONT_DIR}${file}`),
      contentType: "font/woff2",
      status: 200,
    });
  });
}

const GENERAL_SANS_FACES = `
@font-face {
  font-family: "General Sans";
  font-style: normal;
  font-weight: 500;
  font-display: block;
  src: url("/__proof-fonts/GeneralSans-Medium.woff2") format("woff2");
}
@font-face {
  font-family: "General Sans";
  font-style: normal;
  font-weight: 600;
  font-display: block;
  src: url("/__proof-fonts/GeneralSans-Semibold.woff2") format("woff2");
}`;

const VARIANT_CSS: Record<Variant, string> = {
  current: `:root { --font-heading: "Geist", "Inter", ui-sans-serif, system-ui, sans-serif; --font-mono: "Geist Mono", ui-monospace, Menlo, monospace; }`,
  "general-sans": `${GENERAL_SANS_FACES}
:root { --font-heading: "General Sans", "Geist", "Inter", ui-sans-serif, system-ui, sans-serif; }`,
  "instrument-sans": "",
};

const HEADING_FAMILY: Record<Variant, string> = {
  current: "Geist",
  "general-sans": "General Sans",
  "instrument-sans": "Instrument Sans",
};

async function applyVariant(page: Page, variant: Variant): Promise<void> {
  const css = VARIANT_CSS[variant];
  if (variant === "general-sans") {
    await serveGeneralSans(page);
  }
  if (css.length > 0) {
    await page.addStyleTag({ content: css });
  }
  await page.evaluate(async (family) => {
    await document.fonts.load(`500 24px "${family}"`);
    await document.fonts.load(`400 13px "IBM Plex Mono"`);
    await document.fonts.ready;
  }, HEADING_FAMILY[variant]);
  // Give the swapped faces one frame to lay out before capture.
  await page.waitForTimeout(300);
}

async function expectHeadingFamily(page: Page, variant: Variant): Promise<void> {
  const family = await page
    .getByRole("heading", { level: 1 })
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family).toContain(HEADING_FAMILY[variant]);
  const loaded = await page.evaluate(
    (name) => document.fonts.check(`500 24px "${name}"`),
    HEADING_FAMILY[variant],
  );
  expect(loaded).toBe(true);
}

for (const variant of VARIANTS) {
  test.describe(`typography proof: ${variant}`, () => {
    const dir = `${OUTPUT_ROOT}${variant}/`;

    test.beforeAll(async () => {
      mkdirSync(dir, { recursive: true });
      if (variant === "general-sans") {
        await ensureGeneralSansFiles();
      }
    });

    test("Providers proof at 1440 x 900", async ({ page }) => {
      await page.setViewportSize({ height: 900, width: 1440 });
      await installConsoleFixtures(page);
      await page.goto("/providers");
      await expect(page.getByText("Production").first()).toBeVisible();
      await applyVariant(page, variant);
      await expectHeadingFamily(page, variant);
      await page.screenshot({ path: `${dir}providers-1440x900.png` });
    });

    test("Runs stress at 1440 x 900", async ({ page }) => {
      await page.setViewportSize({ height: 900, width: 1440 });
      await installConsoleFixtures(page);
      await page.goto("/threads");
      await expect(page.getByText("Summarise flaky test failures in apps/api")).toBeVisible();
      await applyVariant(page, variant);
      await page.screenshot({
        path: `${dir}runs-1440x900.png`,
        clip: { height: 520, width: 1440, x: 0, y: 0 },
      });
    });

    test("Settings stress: project form and environment dialog", async ({ page }) => {
      await page.setViewportSize({ height: 900, width: 1440 });
      await installConsoleFixtures(page);
      await page.goto("/project-settings/general");
      await expect(page.getByLabel("Project name")).toHaveValue("Console redesign");
      await applyVariant(page, variant);
      await page.screenshot({
        path: `${dir}settings-general.png`,
        clip: { height: 420, width: 1440, x: 0, y: 0 },
      });

      await page.goto("/environment");
      await expect(page.getByText("Review runner (restricted egress)")).toBeVisible();
      await applyVariant(page, variant);
      await page.getByRole("button", { name: "Create environment" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.screenshot({ path: `${dir}environment-dialog.png` });
    });

    test("zh-CN fallback on Providers", async ({ page }) => {
      await page.setViewportSize({ height: 900, width: 1440 });
      await installConsoleFixtures(page, { locale: "zh-CN" });
      await page.goto("/providers");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await applyVariant(page, variant);
      await page.screenshot({
        path: `${dir}providers-zh-cn.png`,
        clip: { height: 520, width: 1440, x: 0, y: 0 },
      });
    });
  });

  test.describe(`typography proof specimen: ${variant}`, () => {
    test.use({ deviceScaleFactor: 2 });

    test("page title and mono specimen at 2x", async ({ page }) => {
      await page.setViewportSize({ height: 900, width: 1440 });
      await installConsoleFixtures(page);
      await page.goto("/providers");
      await expect(page.getByText("Production").first()).toBeVisible();
      await applyVariant(page, variant);
      await page.screenshot({
        clip: { height: 120, width: 720, x: 240, y: 0 },
        path: `${OUTPUT_ROOT}${variant}/specimen-title-2x.png`,
      });
      const row = page.locator('main [data-slot="connection-row"]').first();
      await row.screenshot({ path: `${OUTPUT_ROOT}${variant}/specimen-row-2x.png` });
    });
  });
}
