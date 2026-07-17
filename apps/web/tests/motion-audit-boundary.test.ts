import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("motion audit boundary", () => {
  test("anchors popup scale animations to the trigger origin", () => {
    const dropdown = readSource("../src/shared/ui/dropdown-menu.tsx");
    const select = readSource("../src/shared/ui/select.tsx");

    expect(dropdown).toContain("origin-(--transform-origin)");
    expect(select).toContain("origin-(--transform-origin)");
  });

  test("keeps expandable content mounted while animating height", () => {
    const turnCard = readSource("../src/shared/ui/session-events/feed-turn-card.tsx");
    const drawer = readSource("../src/shared/ui/session-events/feed-turn-drawer.tsx");
    const deployments = readSource(
      "../src/routes/app-overview/deploy/components/deployments-history.tsx",
    );
    const threadDetail = readSource("../src/routes/threads/detail/view.tsx");

    for (const source of [turnCard, drawer, deployments, threadDetail]) {
      expect(source).toContain("transition-[grid-template-rows]");
      expect(source).toContain("grid-rows-[0fr]");
      expect(source).toContain("grid-rows-[1fr]");
    }

    expect(turnCard).toContain("transition-transform duration-150 ease-out");
    expect(drawer).toContain("transition-transform duration-150 ease-out");
    expect(threadDetail).toContain("transition-transform duration-150 ease-out");
  });

  test("copy feedback uses a stable animated icon slot", () => {
    const feedbackIcon = readSource("../src/shared/ui/copy-icon-feedback.tsx");
    const tokens = readSource("../src/routes/settings/access-tokens-tab.tsx");
    const installGuide = readSource("../src/routes/app-overview/app-overview-install.tsx");
    const turnDrawer = readSource("../src/shared/ui/session-events/feed-turn-drawer.tsx");

    expect(feedbackIcon).toContain("transition-[opacity,transform]");
    expect(feedbackIcon).toContain("scale-75 opacity-0");
    expect(feedbackIcon).toContain("scale-100 opacity-100");
    expect(tokens).toContain("CopyIconFeedback");
    expect(installGuide).toContain("CopyIconFeedback");
    expect(turnDrawer).toContain("CopyIconFeedback");
  });

  test("sidebar labels fade instead of unmounting during collapse", () => {
    const appShell = readSource("../src/app/app-shell.tsx");
    const appNavigation = readSource("../src/app/navigation.tsx");
    const orgNavigation = readSource("../src/app/org-navigation.tsx");

    expect(appShell).toContain("SidebarWordmark");
    expect(appNavigation).toContain("SidebarLabel");
    expect(orgNavigation).toContain("SidebarLabel");
    expect(appNavigation).toContain("delay-[80ms]");
    expect(orgNavigation).toContain("delay-[80ms]");
  });

  test("success milestones use the shared spring motion with reduced-motion fallback", () => {
    const css = readSource("../src/shared/styles/app.css");
    const publishSuccess = readSource("../src/routes/agent/lifecycle/publish-success-modal.tsx");
    const cliAuth = readSource("../src/routes/cli-auth/cli-auth.route.tsx");

    expect(css).toContain("@keyframes mosoo-success-pop");
    expect(css).toContain("var(--ease-spring)");
    expect(css).toContain("@keyframes mosoo-success-fade");
    expect(publishSuccess).toContain("mosoo-success-pop");
    expect(cliAuth).toContain("mosoo-success-pop");
  });
});
