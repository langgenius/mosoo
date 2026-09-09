import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installConsoleFixtures } from "../../lib/console-fixtures";

// Typography proof for the Console design contract (langgenius/mosoo#599,
// docs/design/typography-audit.md). Renders identical Providers, Runs, and
// Settings surfaces with the same fixture data and only the type-role
// families swapped, so the delta under review is typography alone, and
// records which font files each variant made the page fetch. PNGs and
// font-requests.json land in .tmp/e2e/typography-proof/<variant>/.
//
// Variants:
// - geist:           the shipped set. Geist for every sans role, page titles
//                    included; Geist Mono for precise information.
// - instrument-sans: the set that shipped before the consolidation
//                    (Instrument Sans 500 titles, IBM Plex Mono), evaluated
//                    only. Its SIL OFL files are fetched from the jsDelivr
//                    mirror of the Fontsource packages into the gitignored
//                    .tmp folder for the run and served to the page from
//                    there; nothing is committed and nothing ships.

const OUTPUT_ROOT = fileURLToPath(new URL("../../../.tmp/e2e/typography-proof/", import.meta.url));

type Variant = "geist" | "instrument-sans";

const VARIANTS: readonly Variant[] = ["geist", "instrument-sans"];

const PROOF_FONT_DIR = `${OUTPUT_ROOT}fonts/`;
const PROOF_FONT_FILES = {
  "ibm-plex-mono-latin-400-normal.woff2":
    "https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-500-normal.woff2":
    "https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
  "instrument-sans-latin-wght-normal.woff2":
    "https://cdn.jsdelivr.net/npm/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
} as const;

async function ensureProofFonts(): Promise<void> {
  mkdirSync(PROOF_FONT_DIR, { recursive: true });
  for (const [file, url] of Object.entries(PROOF_FONT_FILES)) {
    const target = `${PROOF_FONT_DIR}${file}`;
    if (existsSync(target)) {
      continue;
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Could not fetch ${file} from jsDelivr (${response.status}).`);
    }
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
}

async function serveProofFonts(page: Page): Promise<void> {
  await page.route("**/__proof-fonts/*.woff2", async (route) => {
    const file = route.request().url().split("/").at(-1) ?? "";
    await route.fulfill({
      body: readFileSync(`${PROOF_FONT_DIR}${file}`),
      contentType: "font/woff2",
      status: 200,
    });
  });
}

const PREVIOUS_FACES = `
@font-face {
  font-family: "Instrument Sans";
  font-style: normal;
  font-weight: 400 700;
  font-display: block;
  src: url("/__proof-fonts/instrument-sans-latin-wght-normal.woff2") format("woff2-variations");
}
@font-face {
  font-family: "IBM Plex Mono";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("/__proof-fonts/ibm-plex-mono-latin-400-normal.woff2") format("woff2");
}
@font-face {
  font-family: "IBM Plex Mono";
  font-style: normal;
  font-weight: 500;
  font-display: block;
  src: url("/__proof-fonts/ibm-plex-mono-latin-500-normal.woff2") format("woff2");
}`;

const VARIANT_CSS: Record<Variant, string> = {
  geist: "",
  "instrument-sans": `${PREVIOUS_FACES}
:root { --font-heading: "Instrument Sans", var(--font-sans); --font-mono: "IBM Plex Mono", "Geist Mono", ui-monospace, Menlo, monospace; }`,
};

const HEADING_FAMILY: Record<Variant, string> = {
  geist: "Geist",
  "instrument-sans": "Instrument Sans",
};

const MONO_FAMILY: Record<Variant, string> = {
  geist: "Geist Mono",
  "instrument-sans": "IBM Plex Mono",
};

/** Font files the shipped page may fetch; anything else is a regression. */
const SHIPPED_FONT_FILES = ["/fonts/Geist-Variable.woff2", "/fonts/GeistMono-Variable.woff2"];

interface FontRequest {
  bytes: number;
  url: string;
}

const fontRequests = new Map<Variant, Record<string, FontRequest[]>>();

function recordFontRequests(page: Page, variant: Variant, label: string): FontRequest[] {
  const requests: FontRequest[] = [];
  const perVariant = fontRequests.get(variant) ?? {};
  perVariant[label] = requests;
  fontRequests.set(variant, perVariant);
  page.on("response", (response) => {
    if (response.request().resourceType() !== "font") {
      return;
    }
    const url = new URL(response.url());
    void response
      .body()
      .then((body) => {
        requests.push({ bytes: body.length, url: url.pathname });
      })
      .catch(() => {
        requests.push({ bytes: -1, url: url.pathname });
      });
  });
  return requests;
}

async function applyVariant(page: Page, variant: Variant): Promise<void> {
  const css = VARIANT_CSS[variant];
  if (variant === "instrument-sans") {
    await serveProofFonts(page);
  }
  if (css.length > 0) {
    await page.addStyleTag({ content: css });
  }
  await page.evaluate(
    async ({ heading, mono }) => {
      await document.fonts.load(`500 24px "${heading}"`);
      await document.fonts.load(`400 13px "${mono}"`);
      await document.fonts.ready;
    },
    { heading: HEADING_FAMILY[variant], mono: MONO_FAMILY[variant] },
  );
  // Give the swapped faces one frame to lay out before capture.
  await page.waitForTimeout(300);
}

async function expectFamilies(page: Page, variant: Variant): Promise<void> {
  const title = page.getByRole("heading", { level: 1 }).first();
  const family = await title.evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family).toContain(HEADING_FAMILY[variant]);
  const loaded = await page.evaluate(
    ({ heading, mono }) => ({
      heading: document.fonts.check(`500 24px "${heading}"`),
      mono: document.fonts.check(`400 13px "${mono}"`),
    }),
    { heading: HEADING_FAMILY[variant], mono: MONO_FAMILY[variant] },
  );
  expect(loaded).toEqual({ heading: true, mono: true });
  // The heading voice comes from size, weight, tracking, and tone, not from
  // a heavier face: 24px / 500 / -0.02em on a 28px line in every variant.
  const style = await title.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      letterSpacing: computed.letterSpacing,
      lineHeight: computed.lineHeight,
    };
  });
  expect(style).toEqual({
    fontSize: "24px",
    fontWeight: "500",
    letterSpacing: "-0.48px",
    lineHeight: "28px",
  });
}

function expectShippedRequestsOnly(requests: readonly FontRequest[]): void {
  const files = [...new Set(requests.map((request) => request.url))].toSorted();
  expect(files).toEqual(SHIPPED_FONT_FILES);
}

for (const variant of VARIANTS) {
  test.describe(`typography proof: ${variant}`, () => {
    const dir = `${OUTPUT_ROOT}${variant}/`;

    test.beforeAll(async () => {
      mkdirSync(dir, { recursive: true });
      if (variant === "instrument-sans") {
        await ensureProofFonts();
      }
    });

    test.afterAll(() => {
      writeFileSync(
        `${dir}font-requests.json`,
        `${JSON.stringify(fontRequests.get(variant) ?? {}, null, 2)}\n`,
      );
    });

    test("Providers proof at 1440 x 900", async ({ page }) => {
      const requests = recordFontRequests(page, variant, "providers-en");
      await page.setViewportSize({ height: 900, width: 1440 });
      await installConsoleFixtures(page);
      await page.goto("/providers");
      await expect(page.getByText("Production").first()).toBeVisible();
      await applyVariant(page, variant);
      await expectFamilies(page, variant);
      await page.screenshot({ path: `${dir}providers-1440x900.png` });
      if (variant === "geist") {
        expectShippedRequestsOnly(requests);
      }
    });

    test("Runs stress at 1440 x 900", async ({ page }) => {
      recordFontRequests(page, variant, "runs-en");
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
      recordFontRequests(page, variant, "settings-en");
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
      const requests = recordFontRequests(page, variant, "providers-zh-cn");
      await page.setViewportSize({ height: 900, width: 1440 });
      await installConsoleFixtures(page, { locale: "zh-CN" });
      await page.goto("/providers");
      const title = page.getByRole("heading", { level: 1 });
      await expect(title).toBeVisible();
      await applyVariant(page, variant);
      // CJK glyphs come from the platform sans named in the zh stack; the
      // page must not fetch a web font to discover it lacks them.
      expect(await title.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
        "PingFang SC",
      );
      if (variant === "geist") {
        expectShippedRequestsOnly(requests);
      }
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
