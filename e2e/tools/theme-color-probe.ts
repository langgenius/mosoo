import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import type { Page } from "@playwright/test";

// Theme-colour probe for docs/design/theme-color-usage.md
// (langgenius/mosoo#605). Renders public reference pages in both colour
// schemes, screenshots them, and reads the computed styles of buttons, links,
// headings, inputs, and the focused element so the research tables cite
// measured values. Run from the repo root: `bun e2e/tools/theme-color-probe.ts`.
// Output: .tmp/design/theme-color-probe/<page>-<scheme>.png and report.json.

const OUTPUT_DIR = fileURLToPath(new URL("../../.tmp/design/theme-color-probe/", import.meta.url));

const PAGES = [
  { id: "supabase-home", url: "https://supabase.com/" },
  { id: "supabase-pricing", url: "https://supabase.com/pricing" },
  { id: "supabase-docs", url: "https://supabase.com/docs" },
  { id: "supabase-signin", url: "https://supabase.com/dashboard/sign-in" },
  { id: "mintlify-home", url: "https://www.mintlify.com/" },
  { id: "mintlify-pricing", url: "https://www.mintlify.com/pricing" },
  { id: "mintlify-docs", url: "https://www.mintlify.com/docs" },
  { id: "mintlify-dashboard-login", url: "https://dashboard.mintlify.com/login" },
] as const;

const SCHEMES = ["light", "dark"] as const;

interface ElementSample {
  background: string;
  border: string;
  color: string;
  font: string;
  fontSize: string;
  fontWeight: string;
  height: number;
  radius: string;
  tag: string;
  text: string;
  textDecoration: string;
}

interface PageSample {
  active: ElementSample[];
  body: ElementSample;
  buttons: ElementSample[];
  focused: { boxShadow: string; outline: string; tag: string; text: string } | null;
  headings: ElementSample[];
  inputs: ElementSample[];
  links: ElementSample[];
  title: string;
  variables: Record<string, string>;
}

interface Report {
  id: string;
  observedAt: string;
  scheme: (typeof SCHEMES)[number];
  url: string;
  sample?: PageSample;
  error?: string;
}

function samplePage(): PageSample {
  const pick = (element: Element): ElementSample => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const text = (element as HTMLElement).innerText || element.getAttribute("aria-label") || "";
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      color: style.color,
      font: style.fontFamily.split(",")[0] ?? "",
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      height: Math.round(rect.height),
      radius: style.borderTopLeftRadius,
      tag: element.tagName.toLowerCase(),
      text: text.trim().slice(0, 60),
      textDecoration: style.textDecorationLine,
    };
  };
  const visible = (sample: ElementSample): boolean => sample.height > 0 && sample.text.length > 0;
  const variables: Record<string, string> = {};
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (
        !(rule instanceof CSSStyleRule) ||
        !/:root|\[data-theme|\.dark|html/u.test(rule.selectorText)
      ) {
        continue;
      }
      for (const name of Array.from(rule.style)) {
        if (name.startsWith("--") && /brand|primary|accent|green|ring|link/iu.test(name)) {
          variables[`${rule.selectorText} ${name}`] = rule.style.getPropertyValue(name).trim();
        }
      }
    }
  }
  const focusedElement = document.activeElement;
  const focusedStyle = focusedElement === null ? null : getComputedStyle(focusedElement);
  return {
    active: Array.from(
      document.querySelectorAll("[aria-current], [data-state='active'], [aria-selected='true']"),
    )
      .slice(0, 12)
      .map(pick),
    body: pick(document.body),
    buttons: Array.from(document.querySelectorAll("button, a[role='button']"))
      .slice(0, 80)
      .map(pick)
      .filter(visible),
    focused:
      focusedElement === null || focusedStyle === null
        ? null
        : {
            boxShadow: focusedStyle.boxShadow.slice(0, 160),
            outline: focusedStyle.outline,
            tag: focusedElement.tagName,
            text: ((focusedElement as HTMLElement).innerText ?? "").slice(0, 40),
          },
    headings: Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 12).map(pick),
    inputs: Array.from(document.querySelectorAll("input")).slice(0, 6).map(pick),
    links: Array.from(document.querySelectorAll("main a, article a, p a"))
      .slice(0, 80)
      .map(pick)
      .filter(visible),
    title: document.title,
    variables,
  };
}

async function probe(page: Page, scheme: (typeof SCHEMES)[number]): Promise<PageSample> {
  await page.evaluate((value) => {
    localStorage.setItem("theme", value);
    localStorage.setItem("supabaseDarkMode", value === "dark" ? "true" : "false");
  }, scheme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3_000);
  const firstButton = page.locator("button:visible, a[role=button]:visible").first();
  if ((await firstButton.count()) > 0) {
    await firstButton.focus().catch(() => undefined);
    await page.keyboard.press("Tab").catch(() => undefined);
  }
  return page.evaluate(samplePage);
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const report: Report[] = [];

  for (const scheme of SCHEMES) {
    for (const target of PAGES) {
      const context = await browser.newContext({
        colorScheme: scheme,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        viewport: { height: 900, width: 1440 },
      });
      const page = await context.newPage();
      const entry: Report = {
        id: target.id,
        observedAt: new Date().toISOString(),
        scheme,
        url: target.url,
      };
      try {
        await page.goto(target.url, { timeout: 45_000, waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3_000);
        entry.sample = await probe(page, scheme);
        await page.screenshot({ path: `${OUTPUT_DIR}${target.id}-${scheme}.png` });
      } catch (error) {
        entry.error = error instanceof Error ? error.message.slice(0, 300) : String(error);
      }
      report.push(entry);
      await context.close();
    }
  }

  await browser.close();
  writeFileSync(`${OUTPUT_DIR}report.json`, JSON.stringify(report, null, 2));
  for (const entry of report) {
    console.log(
      `${entry.id}/${entry.scheme}: ${entry.error ?? `${entry.sample?.buttons.length ?? 0} buttons, ${entry.sample?.links.length ?? 0} links`}`,
    );
  }
}

await main();
