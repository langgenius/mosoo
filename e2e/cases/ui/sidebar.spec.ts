import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";

import { formatHarnessError } from "../../lib/env-preflight";

// Deterministic acceptance for the console sidebar (langgenius/mosoo#600): the
// upper work zone / lower persistent zone split, the dedicated Tools icons, the
// collapsed rail, keyboard focus, CJK labels, the no-Project state, the mobile
// drawer, and the Org layer. Every API projection is a fixture, so the case
// needs no provider keys and doubles as the screenshot capture for design
// review: PNGs land in .tmp/e2e/sidebar.

const SCREENSHOT_DIR = fileURLToPath(new URL("../../../.tmp/e2e/sidebar/", import.meta.url));

const accountId = "01J00000000000000000000203";
const organizationId = "01J00000000000000000000201";
const projectId = "01J00000000000000000000200";
const secondProjectId = "01J00000000000000000000210";
const now = "2026-09-08T08:00:00.000Z";

const TOOL_LINKS = [
  { icon: "skills", name: "Skills", path: "/integrations/skills" },
  { icon: "mcp-servers", name: "MCP servers", path: "/integrations/mcp" },
  { icon: "providers", name: "Providers", path: "/providers" },
  { icon: "environments", name: "Environments", path: "/environment" },
] as const;

const WORK_LINKS = [
  { name: "Create agent", path: "/agent?create=1" },
  { name: "Overview", path: "/" },
  { name: "Runs", path: "/threads" },
  { name: "Agents", path: "/agent" },
  { name: "Files", path: "/files" },
  ...TOOL_LINKS,
] as const;

const PERSISTENT_LINKS = [{ name: "Project settings", path: "/project-settings" }] as const;

type ProjectFixture = "none" | "one" | "two";

interface GraphQLRequestBody {
  operationName?: string;
  query: string;
  variables?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseGraphQLRequestBody(postData: string | null): GraphQLRequestBody {
  if (postData === null) {
    throw new Error(
      formatHarnessError({
        fix: "Use requestGraphQL(...) so the fixture can assert the operation and variables.",
        what: "The sidebar E2E received an empty GraphQL request body.",
        why: "The deterministic sidebar check must pin every API projection it depends on.",
      }),
    );
  }

  const parsed: unknown = JSON.parse(postData);

  if (!isRecord(parsed) || typeof parsed["query"] !== "string") {
    throw new Error(
      formatHarnessError({
        fix: "Send `{ query, variables }` from the Web GraphQL client or add a parser case for the new envelope.",
        what: "The sidebar E2E received a GraphQL request envelope it cannot parse.",
        why: "The fixture is the executable contract for the console shell.",
      }),
    );
  }

  return {
    ...(typeof parsed["operationName"] === "string"
      ? { operationName: parsed["operationName"] }
      : {}),
    query: parsed["query"],
    ...(isRecord(parsed["variables"]) ? { variables: parsed["variables"] } : {}),
  };
}

function getOperationName(body: GraphQLRequestBody): string | null {
  if (body.operationName !== undefined && body.operationName.trim().length > 0) {
    return body.operationName;
  }

  const match = /^\s*(?:query|mutation)\s+([_A-Za-z][_0-9A-Za-z]*)/u.exec(body.query);
  return match?.[1] ?? null;
}

async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    status: 200,
  });
}

async function fulfillAuthSessionFixture(route: Route): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({
      session: {
        createdAt: now,
        expiresAt: "2027-09-08T08:00:00.000Z",
        id: "sidebar-auth-session",
        ipAddress: null,
        token: "sidebar-auth-token",
        updatedAt: now,
        userAgent: null,
        userId: accountId,
      },
      user: {
        createdAt: now,
        email: "ada@example.com",
        emailVerified: true,
        id: accountId,
        image: null,
        name: "Ada Lovelace",
        updatedAt: now,
      },
    }),
    contentType: "application/json",
    status: 200,
  });
}

function projectSummary(id: string, name: string) {
  return {
    createdAt: now,
    defaultEnvironmentId: null,
    id,
    name,
    ownerAccountId: accountId,
  };
}

function projectsForFixture(projects: ProjectFixture) {
  switch (projects) {
    case "none":
      return [];
    case "one":
      return [projectSummary(projectId, "Console redesign")];
    case "two":
      return [
        projectSummary(projectId, "Console redesign"),
        projectSummary(secondProjectId, "Billing service"),
      ];
  }
}

async function installSidebarFixtures(
  page: Page,
  options: { locale?: string; projects?: ProjectFixture } = {},
): Promise<void> {
  const projects = options.projects ?? "one";

  // Each test gets a fresh browser context, so only the state a scenario needs
  // is seeded; nothing is cleared, which keeps reloads inside a test honest.
  await page.addInitScript(
    ({ locale, selectedProjectId }) => {
      if (selectedProjectId !== null) {
        localStorage.setItem("mosoo:selected-project", selectedProjectId);
      }
      if (locale !== null) {
        localStorage.setItem("mosoo-locale", locale);
      }
    },
    {
      locale: options.locale ?? null,
      selectedProjectId: projects === "two" ? projectId : null,
    },
  );

  await page.route(/\/api\/auth\/get-session(?:\?|$)/u, fulfillAuthSessionFixture);
  await page.route("**/api/graphql", async (route) => {
    const body = parseGraphQLRequestBody(route.request().postData());
    const operationName = getOperationName(body);

    switch (operationName) {
      case "Viewer": {
        await fulfillJson(route, {
          viewer: {
            account: {
              email: "ada@example.com",
              id: accountId,
              imageUrl: null,
              name: "Ada Lovelace",
              systemAgentModel: null,
            },
            activeOrganization: {
              avatarUrl: null,
              createdAt: now,
              id: organizationId,
              name: "Analytical Engines",
            },
            auth: {
              currentSecurityLevel: "low",
              methods: ["email_otp"],
            },
            organizations: [
              {
                avatarUrl: null,
                createdAt: now,
                id: organizationId,
                name: "Analytical Engines",
              },
            ],
          },
        });
        return;
      }
      case "ProjectList": {
        await fulfillJson(route, { projectList: projectsForFixture(projects) });
        return;
      }
      case "AccessibleAgents": {
        await fulfillJson(route, { accessibleAgentList: [] });
        return;
      }
      case "ThreadAgentSessionList": {
        await fulfillJson(route, {
          threadAgentSessionList: {
            nodes: [],
            pageInfo: { endCursor: null, hasMore: false },
          },
        });
        return;
      }
      case "FileList": {
        await fulfillJson(route, { fileList: { files: [] } });
        return;
      }
      case "ProjectSkills": {
        await fulfillJson(route, { projectSkillList: [] });
        return;
      }
    }

    throw new Error(
      formatHarnessError({
        fix: "Add a fixture for the requested GraphQL root field, or move the assertion to a live smoke if it needs real backend state.",
        what: `The sidebar E2E received an unexpected GraphQL request${
          operationName === null ? "" : ` (${operationName})`
        }.`,
        why: "The sidebar acceptance test must make every Web/API projection explicit.",
      }),
    );
  });
}

function desktopSidebar(page: Page): Locator {
  return page.locator("nav[aria-label]").first();
}

async function expectNoHorizontalOverflow(page: Page, container: Locator): Promise<void> {
  expect(await container.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function expectZonesStacked(page: Page, nav: Locator): Promise<void> {
  const work = nav.locator('[data-sidebar-zone="work"]');
  const persistent = nav.locator('[data-sidebar-zone="persistent"]');
  const viewport = page.viewportSize();
  const workBox = await work.boundingBox();
  const persistentBox = await persistent.boundingBox();

  expect(viewport).not.toBeNull();
  expect(workBox).not.toBeNull();
  expect(persistentBox).not.toBeNull();
  if (viewport === null || workBox === null || persistentBox === null) {
    return;
  }

  // The work zone ends where the persistent zone begins, and the persistent
  // zone is fully on screen however tall the work list is.
  expect(workBox.y + workBox.height).toBeLessThanOrEqual(persistentBox.y + 1);
  expect(persistentBox.y + persistentBox.height).toBeLessThanOrEqual(viewport.height);
}

async function screenshot(
  page: Page,
  name: string,
  clip?: { height: number; width: number },
): Promise<void> {
  await page.screenshot({
    path: `${SCREENSHOT_DIR}${name}.png`,
    ...(clip ? { clip: { x: 0, y: 0, ...clip } } : { fullPage: false }),
  });
}

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test("expanded sidebar separates the work zone from the persistent zone", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await installSidebarFixtures(page, { projects: "two" });
  await page.goto("/files");

  const nav = desktopSidebar(page);
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(nav).toBeVisible();

  for (const link of [...WORK_LINKS, ...PERSISTENT_LINKS]) {
    await expect(nav.getByRole("link", { exact: true, name: link.name })).toHaveAttribute(
      "href",
      link.path,
    );
  }
  await expect(nav.getByRole("link", { exact: true, name: "Files" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { exact: true, name: "Overview" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const tool of TOOL_LINKS) {
    await expect(
      nav
        .getByRole("link", { exact: true, name: tool.name })
        .locator(`svg[data-tool-icon="${tool.icon}"]`),
    ).toBeVisible();
  }
  await expect(nav.getByText("Tools", { exact: true })).toBeVisible();
  await expect(
    nav.getByRole("button", { name: /Switch project: Console redesign/u }),
  ).toBeVisible();
  await expect(nav.getByRole("button", { name: /Ada Lovelace/u })).toBeVisible();

  const persistent = nav.locator('[data-sidebar-zone="persistent"]');
  await expect(persistent.getByRole("link", { name: "Project settings" })).toBeVisible();
  await expect(persistent.getByRole("button", { name: "Help & docs" })).toBeVisible();
  await expect(persistent.getByRole("button", { name: /^Language:/u })).toBeVisible();

  await expectZonesStacked(page, nav);
  await expectNoHorizontalOverflow(page, nav);
  await screenshot(page, "expanded-1440x900", { height: 900, width: 720 });

  await nav.getByRole("link", { exact: true, name: "Agents" }).hover();
  await screenshot(page, "hover-state", { height: 460, width: 720 });

  await nav.getByRole("button", { name: /Switch project/u }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Billing service" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Back to Analytical Engines" })).toHaveAttribute(
    "href",
    "/projects",
  );
  await screenshot(page, "project-switcher-menu", { height: 480, width: 720 });
});

test("short viewports scroll the work zone and keep the footer anchored", async ({ page }) => {
  await page.setViewportSize({ height: 560, width: 1280 });
  await installSidebarFixtures(page);
  await page.goto("/files");

  const nav = desktopSidebar(page);
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  const work = nav.locator('[data-sidebar-zone="work"]');

  expect(await work.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expectZonesStacked(page, nav);
  await expect(nav.getByRole("button", { name: /Ada Lovelace/u })).toBeVisible();

  await work.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(nav.getByRole("link", { exact: true, name: "Environments" })).toBeInViewport();
  await expectNoHorizontalOverflow(page, nav);
  await screenshot(page, "short-viewport-1280x560", { height: 560, width: 720 });
});

test("collapsed rail keeps every entry point recognisable and reachable", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await installSidebarFixtures(page);
  await page.goto("/integrations/skills");

  const nav = desktopSidebar(page);
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await nav.getByRole("button", { name: "Collapse sidebar" }).click();

  await expect
    .poll(async () => (await nav.boundingBox())?.width ?? 0, { timeout: 5_000 })
    .toBeLessThanOrEqual(64);
  await expect(nav.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  for (const link of [...WORK_LINKS, ...PERSISTENT_LINKS]) {
    await expect(nav.getByRole("link", { exact: true, name: link.name })).toHaveAttribute(
      "href",
      link.path,
    );
  }
  await expect(nav.getByRole("link", { exact: true, name: "Skills" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const tool of TOOL_LINKS) {
    await expect(nav.locator(`svg[data-tool-icon="${tool.icon}"]`)).toBeVisible();
  }
  await expect(nav.getByText("Tools", { exact: true })).toHaveCount(0);

  await nav.getByRole("link", { exact: true, name: "Providers" }).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Providers");

  await expectZonesStacked(page, nav);
  await expectNoHorizontalOverflow(page, nav);
  await screenshot(page, "collapsed-1440x900", { height: 900, width: 480 });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
});

test("keyboard focus is visible and independent of selection", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await installSidebarFixtures(page);
  await page.goto("/files");

  const nav = desktopSidebar(page);
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  const runs = nav.getByRole("link", { exact: true, name: "Runs" });

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  for (let step = 0; step < 40; step += 1) {
    if (await runs.evaluate((element) => element === document.activeElement)) {
      break;
    }
    await page.keyboard.press("Tab");
  }

  await expect(runs).toBeFocused();
  const focusRing = await runs.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(focusRing).not.toBe("none");
  await expect(runs).not.toHaveAttribute("aria-current", "page");
  await screenshot(page, "keyboard-focus", { height: 420, width: 720 });
});

test("labels stay on one line in CJK locales", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await installSidebarFixtures(page, { locale: "zh-CN" });
  await page.goto("/files");

  const nav = desktopSidebar(page);
  await expect(nav.getByRole("link", { exact: true, name: "项目设置" })).toBeVisible();
  await expect(nav.getByText("工具", { exact: true })).toBeVisible();

  const overflowing = await nav
    .locator("a, button")
    .evaluateAll((rows) =>
      rows
        .filter((row) => row.scrollWidth > row.clientWidth)
        .map((row) => row.textContent?.trim() ?? row.getAttribute("aria-label") ?? "?"),
    );
  expect(overflowing).toEqual([]);
  await expectNoHorizontalOverflow(page, nav);
  await screenshot(page, "expanded-zh-cn", { height: 900, width: 720 });
});

test("no Project keeps creation visible but disabled", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await installSidebarFixtures(page, { projects: "none" });
  await page.goto("/files");

  const nav = desktopSidebar(page);
  await expect(nav.getByRole("button", { name: /No Project available/u })).toBeVisible();
  const create = nav.getByRole("button", { exact: true, name: "Create agent" });
  await expect(create).toHaveAttribute("aria-disabled", "true");
  await expect(nav.getByRole("link", { exact: true, name: "Create agent" })).toHaveCount(0);
  await screenshot(page, "no-project-disabled", { height: 420, width: 720 });
});

test("mobile drawer carries the same hierarchy", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await installSidebarFixtures(page);
  await page.goto("/files");

  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();

  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await drawer.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map(async (animation) => animation.finished));
  });
  // The drawer is anchored to the left edge and slides in from that edge.
  expect((await drawer.boundingBox())?.x).toBe(0);
  expect(
    await drawer.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--tw-enter-translate-x").trim(),
    ),
  ).toBe("-100%");
  for (const link of [...WORK_LINKS, ...PERSISTENT_LINKS]) {
    await expect(drawer.getByRole("link", { exact: true, name: link.name })).toHaveAttribute(
      "href",
      link.path,
    );
  }
  await expect(drawer.getByRole("button", { name: /Ada Lovelace/u })).toBeVisible();
  await screenshot(page, "mobile-drawer-390x844");
});

test("Org layer shares the row grammar and footer", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await installSidebarFixtures(page, { projects: "two" });
  await page.goto("/projects");

  const aside = page.locator("aside").first();
  await expect(aside.getByRole("link", { exact: true, name: "Projects" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(aside.getByRole("link", { exact: true, name: "Org settings" })).toHaveAttribute(
    "href",
    "/org/settings",
  );
  for (const soon of ["Usage", "Billing"]) {
    await expect(aside.getByText(soon, { exact: true })).toBeVisible();
    await expect(aside.getByRole("link", { exact: true, name: soon })).toHaveCount(0);
  }
  await expect(aside.getByRole("button", { name: /Ada Lovelace/u })).toBeVisible();
  await expectZonesStacked(page, aside);
  await screenshot(page, "org-layer-1440x900", { height: 900, width: 720 });
});
