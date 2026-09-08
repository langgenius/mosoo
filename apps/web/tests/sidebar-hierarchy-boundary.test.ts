import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import en from "../src/shared/i18n/translations/en.json";
import ja from "../src/shared/i18n/translations/ja.json";
import zhCN from "../src/shared/i18n/translations/zh-CN.json";
import zhTW from "../src/shared/i18n/translations/zh-TW.json";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const SIDEBAR_SOURCES = {
  accountMenu: "../src/app/account-menu.tsx",
  appShell: "../src/app/app-shell.tsx",
  helpMenu: "../src/features/help/help-menu.tsx",
  localeSwitcher: "../src/shared/i18n/locale-switcher.tsx",
  navigation: "../src/app/navigation.tsx",
  orgNavigation: "../src/app/org-navigation.tsx",
  sidebar: "../src/shared/ui/sidebar.tsx",
  sidebarIcons: "../src/shared/ui/sidebar-icons.tsx",
} as const;

// Every row in the Project work list uses the original glyph family.
const GLYPH_ENTRY_POINTS = [
  { icon: "OverviewIcon", key: "nav.overview", path: "/" },
  { icon: "RunsIcon", key: "nav.runs", path: "/threads" },
  { icon: "AgentsIcon", key: "nav.agents", path: "/agent" },
  { icon: "FilesIcon", key: "nav.files", path: "/files" },
  { icon: "SkillsIcon", key: "nav.skills", path: "/integrations/skills" },
  { icon: "McpServersIcon", key: "nav.mcpServers", path: "/integrations/mcp" },
  { icon: "ProvidersIcon", key: "nav.providers", path: "/providers" },
  { icon: "EnvironmentsIcon", key: "nav.environments", path: "/environment" },
] as const;

const LOCALES = { en, ja, "zh-CN": zhCN, "zh-TW": zhTW } as const;

function rawColors(path: string): string[] {
  return (readSource(path).match(/#[0-9a-f]{3,8}\b/giu) ?? []).map((hex) => hex.toLowerCase());
}

// Console sidebar design gate. Each check encodes a decision from
// docs/design/console-sidebar.md so a regression fails in `just test` instead
// of depending on someone noticing it in a screenshot.
describe("Console sidebar hierarchy", () => {
  test("splits the sidebar into a scrolling work zone and an anchored persistent zone", () => {
    const source = readSource(SIDEBAR_SOURCES.appShell);

    expect(source).toMatch(
      /data-sidebar-zone="work"\s+className="[^"]*\bmin-h-0\b[^"]*\bflex-1\b[^"]*\boverflow-y-auto\b/,
    );
    expect(source).toMatch(/data-sidebar-zone="persistent"\s+className="[^"]*\bshrink-0\b/);
    expect(source).not.toContain('<div className="flex-1" />');
  });

  test("keeps the Project work list and the persistent footer on one navigation source", () => {
    const source = readSource(SIDEBAR_SOURCES.navigation);
    const resourcesIndex = source.indexOf('t("nav.resources")');
    const settingsIndex = source.indexOf('t("nav.settings")');

    expect(resourcesIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(resourcesIndex);
    expect(source).toContain("persistent: [");
    expect(source).not.toContain("SlidersHorizontalIcon");
  });

  test("keeps Create agent the one filled control, black through its own token", () => {
    const source = readSource(SIDEBAR_SOURCES.appShell);
    const css = readSource("../src/shared/styles/app.css");

    expect(source).toContain("bg-sidebar-cta text-sidebar-cta-fg hover:bg-sidebar-cta-hover");
    expect(source).not.toContain("bg-primary");
    expect(source).toContain('aria-disabled="true"');
    expect(css.match(/--sidebar-cta-bg:/g)).toHaveLength(2);
    expect(css).toContain("--sidebar-cta-bg: var(--emphasis)");
    expect(css).toContain("--emphasis: var(--ink-900)");
    expect(css).toContain("--color-sidebar-cta: var(--sidebar-cta-bg)");
  });

  test("draws all eight work rows with the original glyph family, no stock substitutes", () => {
    const source = readSource(SIDEBAR_SOURCES.navigation);

    expect(source).toContain('from "@/shared/ui/sidebar-icons"');
    for (const glyph of GLYPH_ENTRY_POINTS) {
      expect(source).toMatch(
        new RegExp(
          `icon: ${glyph.icon},\\s*label: t\\("${glyph.key}"\\),\\s*path: "${glyph.path}"`,
        ),
      );
    }
    // Only the persistent footer's project settings row still uses Hugeicons.
    expect(source.match(/@hugeicons\/core-free-icons\//g)).toHaveLength(1);
    expect(source).toContain("Settings02Icon");
  });

  test("sidebar glyphs follow one construction contract", () => {
    const source = readSource(SIDEBAR_SOURCES.sidebarIcons);

    expect(source).toContain('viewBox="0 0 24 24"');
    expect(source).toContain("strokeWidth={1.5}");
    expect(source).toContain('strokeLinecap="round"');
    expect(source).toContain('strokeLinejoin="round"');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain("data-sidebar-icon={glyph}");
    expect(source.match(/glyph="[a-z-]+"/g)).toHaveLength(GLYPH_ENTRY_POINTS.length);
    expect(rawColors(SIDEBAR_SOURCES.sidebarIcons)).toEqual([]);
    expect(source).not.toMatch(/fill="(?!none|currentColor)/u);
    expect(source).not.toContain("linearGradient");
  });

  test("keeps emoji and improvised glyphs out of the sidebar", () => {
    for (const path of Object.values(SIDEBAR_SOURCES)) {
      const source = readSource(path);
      expect({ offender: /\p{Extended_Pictographic}/u.exec(source)?.[0] ?? null, path }).toEqual({
        offender: null,
        path,
      });
    }
  });

  test("uses one row recipe with explicit focus, selected, open, and disabled states", () => {
    const sidebar = readSource(SIDEBAR_SOURCES.sidebar);

    expect(sidebar).toContain("focus-visible:ring-2");
    expect(sidebar).toContain('aria-current={active ? "page" : undefined}');
    expect(sidebar).toContain('aria-disabled="true"');
    expect(sidebar).toContain("cursor-not-allowed");
    expect(sidebar).toContain("hover:bg-sidebar-row-hover");
    expect(sidebar).toContain("bg-sidebar-row-active");
    expect(sidebar).toContain("data-[popup-open]:bg-sidebar-row-active");
    expect(sidebar).not.toContain("transition-all");
    expect(sidebar).not.toContain("active:scale");
    expect(sidebar).not.toMatch(/\bopacity-\d/u);

    for (const path of [
      SIDEBAR_SOURCES.navigation,
      SIDEBAR_SOURCES.orgNavigation,
      SIDEBAR_SOURCES.helpMenu,
    ]) {
      expect(readSource(path)).toContain("SidebarRow");
    }
    expect(readSource(SIDEBAR_SOURCES.localeSwitcher)).toContain("sidebarRowClassName");
  });

  test("maps sidebar fills to semantic tokens in both themes", () => {
    const css = readSource("../src/shared/styles/app.css");

    expect(css.match(/--sidebar-row-hover:/g)).toHaveLength(2);
    expect(css.match(/--sidebar-row-active:/g)).toHaveLength(2);
    expect(css).toContain("--color-sidebar-row-hover: var(--sidebar-row-hover)");
    expect(css).toContain("--color-sidebar-row-active: var(--sidebar-row-active)");
    expect(css).toContain("--bg-sidebar: var(--paper-200)");

    for (const path of Object.values(SIDEBAR_SOURCES)) {
      expect({ offenders: rawColors(path), path }).toEqual({ offenders: [], path });
    }
  });

  test("disambiguates project settings from account settings in every locale", () => {
    for (const [locale, catalog] of Object.entries(LOCALES)) {
      expect({ locale, resources: catalog.nav.resources.length > 0 }).toEqual({
        locale,
        resources: true,
      });
      expect({ distinct: catalog.nav.settings !== catalog.nav.accountSettings, locale }).toEqual({
        distinct: true,
        locale,
      });
    }

    expect(readSource(SIDEBAR_SOURCES.navigation)).toContain('t("nav.settings")');
    expect(readSource(SIDEBAR_SOURCES.accountMenu)).toContain('t("nav.accountSettings")');
    expect(readSource(SIDEBAR_SOURCES.accountMenu)).not.toContain('t("nav.settings")');
  });
});
