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
  toolIcons: "../src/shared/ui/tool-icons.tsx",
} as const;

const TOOL_ENTRY_POINTS = [
  { icon: "SkillsToolIcon", key: "nav.skills", path: "/integrations/skills" },
  { icon: "McpServersToolIcon", key: "nav.mcpServers", path: "/integrations/mcp" },
  { icon: "ProvidersToolIcon", key: "nav.providers", path: "/providers" },
  { icon: "EnvironmentsToolIcon", key: "nav.environments", path: "/environment" },
] as const;

const LOCALES = { en, ja, "zh-CN": zhCN, "zh-TW": zhTW } as const;

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
    const toolsIndex = source.indexOf('t("nav.tools")');
    const settingsIndex = source.indexOf('t("nav.settings")');

    expect(toolsIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(toolsIndex);
    expect(source).toContain("persistent: [");
    expect(source).not.toContain("SlidersHorizontalIcon");
  });

  test("gives the four Tools their dedicated icon family instead of stock glyphs", () => {
    const source = readSource(SIDEBAR_SOURCES.navigation);

    expect(source).toContain('from "@/shared/ui/tool-icons"');
    for (const tool of TOOL_ENTRY_POINTS) {
      expect(source).toMatch(
        new RegExp(`icon: ${tool.icon},\\s*label: t\\("${tool.key}"\\),\\s*path: "${tool.path}"`),
      );
    }
  });

  test("tool icons follow one construction contract", () => {
    const source = readSource(SIDEBAR_SOURCES.toolIcons);

    expect(source).toContain('viewBox="0 0 24 24"');
    expect(source).toContain("strokeWidth={1.5}");
    expect(source).toContain('strokeLinecap="round"');
    expect(source).toContain('strokeLinejoin="round"');
    expect(source).toContain('aria-hidden="true"');
    expect(source.match(/tool="[a-z-]+"/g)).toHaveLength(TOOL_ENTRY_POINTS.length);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(source).not.toMatch(/fill="(?!none|currentColor)/u);
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

    for (const path of Object.values(SIDEBAR_SOURCES)) {
      expect({ path, rawColor: /#[0-9a-f]{3,8}\b/iu.exec(readSource(path))?.[0] ?? null }).toEqual({
        path,
        rawColor: null,
      });
    }
  });

  test("disambiguates project settings from account settings in every locale", () => {
    for (const [locale, catalog] of Object.entries(LOCALES)) {
      expect({ locale, tools: catalog.nav.tools.length > 0 }).toEqual({ locale, tools: true });
      expect({ locale, distinct: catalog.nav.settings !== catalog.nav.accountSettings }).toEqual({
        locale,
        distinct: true,
      });
    }

    expect(readSource(SIDEBAR_SOURCES.navigation)).toContain('t("nav.settings")');
    expect(readSource(SIDEBAR_SOURCES.accountMenu)).toContain('t("nav.accountSettings")');
    expect(readSource(SIDEBAR_SOURCES.accountMenu)).not.toContain('t("nav.settings")');
  });
});
