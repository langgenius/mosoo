import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { parse as parseYaml } from "yaml";

// Console design-contract gate (docs/design/console-design-contract.md,
// langgenius/mosoo#599, #601, #605). Each check encodes one contract rule so
// a regression fails in `just test` instead of waiting for a screenshot review.

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const CSS = readSource("../src/shared/styles/app.css");
const UI_DIR = new URL("../src/shared/ui/", import.meta.url);

const RECIPES = {
  badge: "../src/shared/ui/badge.tsx",
  button: "../src/shared/ui/button.tsx",
  dialog: "../src/shared/ui/dialog.tsx",
  dropdownMenu: "../src/shared/ui/dropdown-menu.tsx",
  input: "../src/shared/ui/input.tsx",
  label: "../src/shared/ui/label.tsx",
  listRow: "../src/shared/ui/list-row.tsx",
  pageHeader: "../src/shared/ui/page-header.tsx",
  select: "../src/shared/ui/select.tsx",
  sidebar: "../src/shared/ui/sidebar.tsx",
  switch: "../src/shared/ui/switch.tsx",
  table: "../src/shared/ui/table.tsx",
  textarea: "../src/shared/ui/textarea.tsx",
  viewToggle: "../src/shared/ui/view-toggle.tsx",
} as const;

// Semantic tokens every theme block must define, so a dark mapping cannot
// silently fall back to a light value.
const THEMED_TOKENS = [
  "--bg",
  "--bg-elevated",
  "--bg-sunken",
  "--bg-sidebar",
  "--hover",
  "--selected",
  "--pressed",
  "--fg-heading",
  "--fg-1",
  "--fg-2",
  "--fg-3",
  "--fg-muted",
  "--border-soft",
  "--border-default",
  "--border-strong",
  "--action-primary-bg",
  "--action-primary-fg",
  "--action-primary-hover",
  "--action-primary-active",
  "--action-primary-border",
  "--emphasis",
  "--emphasis-fg",
  "--link",
  "--link-hover",
  "--focus-ring",
  "--control-checked",
  "--control-unchecked",
  "--brand",
  "--brand-soft",
  "--brand-mark",
  "--success",
  "--success-fg",
  "--success-bg",
  "--warning",
  "--warning-fg",
  "--warning-bg",
  "--danger",
  "--danger-fg",
  "--danger-bg",
  "--info",
  "--info-fg",
  "--info-bg",
  "--pending",
  "--pending-fg",
  "--pending-bg",
] as const;

function themeBlock(selector: string): string {
  const start = CSS.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < CSS.length; index += 1) {
    if (CSS[index] === "{") {
      depth += 1;
    } else if (CSS[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return CSS.slice(open, index);
      }
    }
  }
  throw new Error(`Unterminated block for ${selector}`);
}

function luminance(hex: string): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function resolveToken(block: string, name: string, depth = 0): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`, "u").exec(block);
  expect({ name, defined: match !== null }).toEqual({ name, defined: true });
  const value = match?.[1]?.trim() ?? "";
  const reference = /^var\((--[a-z0-9-]+)\)$/u.exec(value);
  if (reference?.[1] !== undefined && depth < 6) {
    return resolveToken(block, reference[1], depth + 1);
  }
  return value;
}

describe("Console design contract", () => {
  test("defines every semantic token for the light and dark themes", () => {
    const light = themeBlock(":root");
    const dark = themeBlock('.dark,\n[data-theme="dark"]');

    for (const token of THEMED_TOKENS) {
      expect({ token, light: light.includes(`${token}:`) }).toEqual({ token, light: true });
      expect({ token, dark: dark.includes(`${token}:`) }).toEqual({ token, dark: true });
    }
  });

  test("text and status roles clear WCAG AA on their light surfaces", () => {
    const light = themeBlock(":root");
    const pairs: Array<[string, string, number]> = [
      ["--fg-1", "--paper-50", 4.5],
      ["--fg-1", "--paper-200", 4.5],
      ["--fg-2", "--paper-200", 4.5],
      ["--fg-3", "--paper-50", 4.5],
      ["--fg-3", "--paper-200", 4.5],
      ["--action-primary-fg", "--action-primary-bg", 4.5],
      ["--link", "--paper-50", 4.5],
      ["--brand", "--brand-soft", 4.5],
      ["--success-fg", "--success-bg", 4.5],
      ["--warning-fg", "--warning-bg", 4.5],
      ["--danger-fg", "--danger-bg", 4.5],
      ["--info-fg", "--info-bg", 4.5],
      ["--pending-fg", "--pending-bg", 4.5],
      ["--focus-ring", "--paper-50", 3],
      ["--control-checked", "--paper-50", 3],
    ];

    for (const [foreground, background, minimum] of pairs) {
      const ratio = contrast(resolveToken(light, foreground), resolveToken(light, background));
      expect({ foreground, background, passes: ratio >= minimum }).toEqual({
        foreground,
        background,
        passes: true,
      });
    }
  });

  test("keeps the brand hue and the success hue apart", () => {
    const light = themeBlock(":root");
    // Brand lime sits near hue 135; semantic success sits near hue 147. Both
    // are green, but the tints must not be the same value.
    expect(resolveToken(light, "--brand-soft")).not.toBe(resolveToken(light, "--success-bg"));
    expect(resolveToken(light, "--brand-mark")).not.toBe(resolveToken(light, "--success"));
    // Selection and hover fills stay neutral (no green channel bias).
    expect(resolveToken(light, "--selected")).toMatch(/^rgba\(0, 0, 0,/u);
    expect(resolveToken(light, "--hover")).toMatch(/^rgba\(0, 0, 0,/u);
  });

  test("bridges the roles to Tailwind and exposes the type and radius roles", () => {
    for (const bridge of [
      "--color-fg-heading: var(--fg-heading)",
      "--color-hover: var(--hover)",
      "--color-selected: var(--selected)",
      "--color-primary: var(--action-primary-bg)",
      "--color-primary-foreground: var(--action-primary-fg)",
      "--color-link: var(--link)",
      "--color-ring: var(--focus-ring)",
      "--color-control-checked: var(--control-checked)",
      "--color-brand-mark: var(--brand-mark)",
      "--color-success-fg: var(--success-fg)",
      "--color-pending-bg: var(--pending-bg)",
      "--radius-compact: var(--r-compact)",
      "--font-heading: var(--font-heading)",
      "--shadow-xs: var(--elev-xs)",
    ]) {
      expect(CSS).toContain(bridge);
    }
    expect(CSS).toContain("--r-compact: 8px");
    expect(CSS).toContain("--r-md: 10px");
    expect(CSS).toContain("--r-lg: 14px");
    expect(CSS).toMatch(/--font-heading:\s*\n?\s*"Instrument Sans"/u);
    expect(CSS).toMatch(/--font-mono:\s*"IBM Plex Mono"/u);
    expect(CSS).toContain(".t-page-title");
    expect(CSS).toContain(".t-eyebrow");
    expect(CSS).toContain(".t-mono");
  });

  test("shared recipes carry the contract measurements", () => {
    const button = readSource(RECIPES.button);
    expect(button).toContain('default: "h-8 rounded-md');
    expect(button).toContain('sm: "h-7 rounded-compact');
    expect(button).toContain('xs: "h-6 rounded-sm');
    expect(button).toContain('lg: "h-9 rounded-md');
    expect(button).toContain("bg-primary text-primary-foreground");

    const badge = readSource(RECIPES.badge);
    expect(badge).toContain("inline-flex h-5 w-fit");
    expect(badge).toContain("rounded-sm");
    for (const variant of ["brand", "success", "warning", "danger", "info", "pending"]) {
      expect(badge).toContain(`${variant}:`);
    }

    const switchSource = readSource(RECIPES.switch);
    expect(switchSource).toContain("h-3.5 w-6");
    expect(switchSource).toContain("size-2.5");
    expect(switchSource).toContain("data-[checked]:bg-control-checked");

    const input = readSource(RECIPES.input);
    expect(input).toContain("h-8 w-full min-w-0 rounded-md");
    expect(input).toContain("aria-invalid:border-danger");
    expect(input).toContain("read-only:");
    expect(readSource(RECIPES.textarea)).toContain("fieldClassName");

    const rows = readSource(RECIPES.listRow);
    expect(rows).toContain('data-slot="data-row"');
    expect(rows).toContain("min-h-10");
    expect(rows).toContain('data-slot="connection-row"');
    expect(rows).toContain("min-h-11");

    expect(readSource(RECIPES.pageHeader)).toContain("font-heading");
    // The single-choice view toggle is a real radio group (Base UI supplies
    // the roles, roving focus, and arrow-key movement).
    expect(readSource(RECIPES.viewToggle)).toContain('from "@base-ui/react/radio-group"');
    expect(readSource(RECIPES.viewToggle)).toContain("<Radio.Root");
    expect(readSource(RECIPES.viewToggle)).not.toContain('role="radio"');
  });

  test("shared recipes use the one focus ring and never fade disabled controls", () => {
    for (const path of [
      RECIPES.button,
      RECIPES.input,
      RECIPES.select,
      RECIPES.switch,
      RECIPES.sidebar,
      RECIPES.viewToggle,
    ]) {
      expect({ path, ring: readSource(path).includes("focus-visible:ring-2") }).toEqual({
        path,
        ring: true,
      });
    }

    for (const path of Object.values(RECIPES)) {
      const source = readSource(path);
      expect({ path, offender: /transition-all/u.exec(source)?.[0] ?? null }).toEqual({
        path,
        offender: null,
      });
      expect({ path, offender: /active:scale/u.exec(source)?.[0] ?? null }).toEqual({
        path,
        offender: null,
      });
      expect({ path, offender: /disabled:opacity-\d+/u.exec(source)?.[0] ?? null }).toEqual({
        path,
        offender: null,
      });
      expect({ path, offender: /\bopacity-[4-7]0\b/u.exec(source)?.[0] ?? null }).toEqual({
        path,
        offender: null,
      });
    }
  });

  test("shared UI consumes semantic tokens, not raw palette values", () => {
    const files = readdirSync(UI_DIR, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".tsx") && !file.startsWith("brand-icons"));

    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const source = readFileSync(new URL(file, UI_DIR), "utf8");
      expect({ file, rawColor: /#[0-9a-f]{3,8}\b/iu.exec(source)?.[0] ?? null }).toEqual({
        file,
        rawColor: null,
      });
      expect({
        file,
        arbitraryColor: /(?:bg|text|border|ring)-\[(?:#|rgb|hsl|oklch)/u.exec(source)?.[0] ?? null,
      }).toEqual({ file, arbitraryColor: null });
    }
  });

  test("every general icon registration is in the icon registry", () => {
    const registry = parseYaml(readSource("../../../docs/design/registry/icons.yml")) as {
      general: Record<string, string>;
      navigation: Record<string, { owner: string; source: string }>;
      purpose_built: Record<string, unknown>;
    };

    const adapter = readSource("../src/shared/ui/icons.tsx");
    for (const [, exportName, source] of adapter.matchAll(
      /export const (\w+) = \/\* @__PURE__ \*\/ createHugeicon\(\s*(\w+),/gu,
    )) {
      expect({ exportName, registered: registry.general[exportName ?? ""] }).toEqual({
        exportName,
        registered: source,
      });
    }

    const localSources = [
      "../src/app/account-menu.tsx",
      "../src/app/app-shell.tsx",
      "../src/app/navigation.tsx",
      "../src/app/org-navigation.tsx",
      "../src/shared/i18n/locale-switcher.tsx",
    ];
    for (const path of localSources) {
      for (const [, source, name] of readSource(path).matchAll(
        /createHugeicon\(\s*(\w+),\s*"(\w+)"/gu,
      )) {
        expect({ name, entry: registry.navigation[name ?? ""]?.source }).toEqual({
          name,
          entry: source,
        });
      }
    }

    for (const group of ["product", "sidebar", "vendor", "runtime", "channel", "state"]) {
      expect(registry.purpose_built[group]).toBeDefined();
    }
  });

  test("keeps the second icon library out of the app", () => {
    const packageJson = JSON.parse(readSource("../package.json")) as {
      dependencies: Record<string, string>;
    };
    for (const banned of [
      "lucide-react",
      "@radix-ui/react-icons",
      "react-icons",
      "@heroicons/react",
    ]) {
      expect(packageJson.dependencies[banned]).toBeUndefined();
    }
  });
});
