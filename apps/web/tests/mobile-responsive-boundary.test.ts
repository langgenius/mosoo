import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP_SHELL_SOURCE = readFileSync(new URL("../src/app/app-shell.tsx", import.meta.url), "utf8");
const APP_SETTINGS_LAYOUT_SOURCE = readFileSync(
  new URL("../src/routes/app-settings/app-settings.route.tsx", import.meta.url),
  "utf8",
);
const SETTINGS_LAYOUT_SOURCE = readFileSync(
  new URL("../src/routes/settings/settings.route.tsx", import.meta.url),
  "utf8",
);
const PREVIEW_MODE_SOURCE = readFileSync(
  new URL("../src/routes/agent/components/preview-mode.tsx", import.meta.url),
  "utf8",
);
const AGENT_DETAIL_SOURCE = readFileSync(
  new URL("../src/routes/agent/agent-detail.route.tsx", import.meta.url),
  "utf8",
);
const PAGE_HEADER_SOURCE = readFileSync(
  new URL("../src/shared/ui/page-header.tsx", import.meta.url),
  "utf8",
);
const LIST_PAGE_SOURCE = readFileSync(
  new URL("../src/shared/ui/list-page.tsx", import.meta.url),
  "utf8",
);
const EMPTY_STATE_SOURCE = readFileSync(
  new URL("../src/shared/ui/empty-state.tsx", import.meta.url),
  "utf8",
);
const ACCESS_TOKENS_SOURCE = readFileSync(
  new URL("../src/routes/settings/access-tokens-tab.tsx", import.meta.url),
  "utf8",
);
const WORKSPACE_HOME_SOURCE = readFileSync(
  new URL("../src/routes/app-overview/app-overview.route.tsx", import.meta.url),
  "utf8",
);
const HELP_MENU_SOURCE = readFileSync(
  new URL("../src/features/help/help-menu.tsx", import.meta.url),
  "utf8",
);

describe("mobile console boundaries", () => {
  test("App and Org shells expose a discoverable mobile navigation drawer", () => {
    expect(APP_SHELL_SOURCE).toContain('aria-label={t("apps.openNavigation")}');
    expect(APP_SHELL_SOURCE).toContain("mobileSidebar");
    expect(APP_SHELL_SOURCE).toContain('className="md:hidden"');
    expect(APP_SHELL_SOURCE).toContain("left-0");
    expect(APP_SHELL_SOURCE).toContain("right-auto");
    expect(APP_SHELL_SOURCE).toContain("hidden w-[224px] shrink-0 flex-col");
    expect(APP_SHELL_SOURCE).toContain("md:flex");
  });

  test("mobile navigation closes for app switches, route changes, and desktop breakpoints", () => {
    expect(APP_SHELL_SOURCE).toContain("renderNavigation(closeNavigation)");
    expect(APP_SHELL_SOURCE).toContain('globalThis.matchMedia("(min-width: 768px)")');
    expect(APP_SHELL_SOURCE).toContain("location.pathname");
    expect(APP_SHELL_SOURCE).toContain("location.search");
  });

  test("mobile Org headers keep an accessible level-one heading", () => {
    expect(APP_SHELL_SOURCE).toContain('<h1 className="text-fg-1 ml-auto');
  });

  test("only one responsive sidebar registers the global help shortcut", () => {
    expect(APP_SHELL_SOURCE).toContain("helpShortcutEnabled={false}");
    expect(HELP_MENU_SOURCE).toContain("shortcutEnabled = true");
  });

  test("nested settings navigation becomes a horizontal mobile tab strip", () => {
    expect(APP_SETTINGS_LAYOUT_SOURCE).toContain(
      "flex h-full flex-col overflow-hidden md:flex-row",
    );
    expect(SETTINGS_LAYOUT_SOURCE).toContain("flex h-full flex-col overflow-hidden md:flex-row");
  });

  test("agent preview stacks session and editor on mobile", () => {
    expect(PREVIEW_MODE_SOURCE).toContain("flex-col md:flex-row");
    expect(PREVIEW_MODE_SOURCE).toContain("h-[42%] w-full");
    expect(PREVIEW_MODE_SOURCE).toContain("md:h-auto md:w-1/2");
    expect(PREVIEW_MODE_SOURCE).toContain("h-[58%] w-full");
  });

  test("agent detail header wraps its tabs below primary controls on mobile", () => {
    expect(AGENT_DETAIL_SOURCE).toContain("flex-wrap");
    expect(AGENT_DETAIL_SOURCE).toContain("order-3");
    expect(AGENT_DETAIL_SOURCE).toContain("w-full");
  });

  test("shared list chrome uses mobile-safe padding and wrapping", () => {
    expect(PAGE_HEADER_SOURCE).toContain("px-4 pt-5 pb-4");
    expect(PAGE_HEADER_SOURCE).toContain("sm:px-8");
    expect(LIST_PAGE_SOURCE).toContain("flex-wrap");
    expect(LIST_PAGE_SOURCE).toContain("w-full sm:w-[260px]");
    expect(LIST_PAGE_SOURCE).toContain("px-4 pb-4 sm:px-8");
  });

  test("shared list empty states fill the remaining page content height", () => {
    expect(LIST_PAGE_SOURCE).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
    expect(EMPTY_STATE_SOURCE).toContain("min-h-[320px] flex-1");
  });

  test("wide account tables and Workspace Home stay mobile-safe", () => {
    expect(ACCESS_TOKENS_SOURCE).toContain('className="xl:hidden"');
    expect(ACCESS_TOKENS_SOURCE).toContain("hidden min-w-[560px] xl:block");
    expect(WORKSPACE_HOME_SOURCE).toContain("flex-col");
    expect(WORKSPACE_HOME_SOURCE).toContain("lg:grid-cols-");
    expect(WORKSPACE_HOME_SOURCE).toContain("sm:text-5xl");
  });
});
