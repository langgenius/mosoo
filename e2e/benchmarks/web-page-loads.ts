import { chromium } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

const baseUrl = process.env["MOSOO_WEB_BENCHMARK_URL"] ?? "http://127.0.0.1:4173";
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];
const sampleCount = readPositiveInteger("MOSOO_WEB_BENCHMARK_SAMPLES", 5);
const thresholdMs = readPositiveNumber("MOSOO_WEB_BENCHMARK_THRESHOLD_MS", 50);
const timeoutMs = readPositiveNumber("MOSOO_WEB_BENCHMARK_TIMEOUT_MS", 5_000);
const ROUTE_READY_MARK_PREFIX = "mosoo:route-ready:";
const ROUTE_PREFETCHED_MARK_PREFIX = "mosoo:route-prefetched:";
const AUTHENTICATED_BOOTSTRAP_PATH = "/cli-auth";
const AUTHENTICATED_ALTERNATE_BOOTSTRAP_PATH = "/apps";
const PUBLIC_BOOTSTRAP_PATH = "/integrations/mcp/oauth-complete";
const PUBLIC_ALTERNATE_BOOTSTRAP_PATH = "/v0-deploy-preview";

const ACCOUNT_ID = "01J0000000000000000000000D";
const ORGANIZATION_ID = "01J0000000000000000000000E";
const APP_ID = "01J0000000000000000000000F";
const ENVIRONMENT_ID = "01J0000000000000000000000G";
const AGENT_ID = "01J0000000000000000000000H";
const THREAD_ID = "01J0000000000000000000000J";

type SessionFixture = "authenticated" | "guest" | "onboarding";

interface PageCase {
  expectedPath?: string;
  path: string;
  session: SessionFixture;
}

// Each sample boots a stable page in a fresh context, completes the same
// pointer-intent prefetch users trigger before clicking, then times navigation
// through the destination route commit. Prefetch duration is reported
// separately. Keep one concrete URL for every RouteObject in
// route-registry.tsx; aliases and redirects remain user-visible entry URLs.
const pageCases: PageCase[] = [
  { path: "/login", session: "guest" },
  { path: "/onboarding", session: "onboarding" },
  { path: "/integrations/mcp/oauth-complete", session: "guest" },
  { path: "/cli-auth", session: "authenticated" },
  { path: "/", session: "authenticated" },
  { path: "/apps", session: "authenticated" },
  { path: "/org/settings", session: "authenticated" },
  { path: "/files", session: "authenticated" },
  { path: "/environment", session: "authenticated" },
  { path: `/environment/${ENVIRONMENT_ID}`, session: "authenticated" },
  { expectedPath: "/environment", path: "/environments", session: "authenticated" },
  {
    expectedPath: `/environment/${ENVIRONMENT_ID}`,
    path: `/environments/${ENVIRONMENT_ID}`,
    session: "authenticated",
  },
  { expectedPath: "/integrations/skills", path: "/integrations", session: "authenticated" },
  { expectedPath: "/integrations/skills", path: "/skill", session: "authenticated" },
  { expectedPath: "/integrations/skills", path: "/skills", session: "authenticated" },
  { expectedPath: "/integrations/mcp", path: "/mcp", session: "authenticated" },
  { path: "/integrations/skills", session: "authenticated" },
  { path: "/integrations/mcp", session: "authenticated" },
  { expectedPath: "/", path: "/deployments", session: "authenticated" },
  { path: "/v0-deploy-preview", session: "guest" },
  { path: "/agent", session: "authenticated" },
  { path: `/agent/${AGENT_ID}`, session: "authenticated" },
  { path: "/threads", session: "authenticated" },
  { path: `/threads/${THREAD_ID}`, session: "authenticated" },
  {
    expectedPath: "/app-settings/general",
    path: "/app-settings",
    session: "authenticated",
  },
  { path: "/app-settings/general", session: "authenticated" },
  { path: "/app-settings/usage", session: "authenticated" },
  {
    expectedPath: "/app-settings/usage",
    path: "/app-settings/cost",
    session: "authenticated",
  },
  { expectedPath: "/settings/profile", path: "/settings", session: "authenticated" },
  { path: "/settings/profile", session: "authenticated" },
  { path: "/settings/access-tokens", session: "authenticated" },
  {
    expectedPath: "/app-settings/general",
    path: "/settings/app",
    session: "authenticated",
  },
  {
    expectedPath: "/app-settings/usage",
    path: "/settings/usage",
    session: "authenticated",
  },
  {
    expectedPath: "/environment",
    path: "/settings/environments",
    session: "authenticated",
  },
  {
    expectedPath: "/app-settings/usage",
    path: "/settings/cost",
    session: "authenticated",
  },
  { expectedPath: "/settings/profile", path: "/profile", session: "authenticated" },
  { expectedPath: "/app-settings/usage", path: "/usage", session: "authenticated" },
  { path: "/providers", session: "authenticated" },
  { expectedPath: "/app-settings/usage", path: "/cost", session: "authenticated" },
];

interface PageResult {
  maxLoadMs: number;
  medianLoadMs: number;
  medianPrefetchMs: number;
  path: string;
}

interface PageMeasurement {
  loadMs: number;
  prefetchMs: number;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];
  if (current === undefined) {
    throw new Error("Cannot calculate a median without samples.");
  }
  if (sorted.length % 2 === 1) {
    return current;
  }
  const previous = sorted[middle - 1];
  if (previous === undefined) {
    throw new Error("Cannot calculate a median without samples.");
  }
  return (previous + current) / 2;
}

function viewerFixture(session: SessionFixture): Record<string, unknown> {
  const account =
    session === "guest"
      ? null
      : {
          email: "benchmark@mosoo.ai",
          id: ACCOUNT_ID,
          imageUrl: null,
          name: "Page-load benchmark",
          systemAgentModel: null,
        };
  const organization =
    session === "authenticated"
      ? {
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          id: ORGANIZATION_ID,
          name: "Benchmark organization",
        }
      : null;

  return {
    data: {
      viewer: {
        account,
        activeOrganization: organization,
        auth: { currentSecurityLevel: "session", methods: [] },
        organizations: organization === null ? [] : [organization],
      },
    },
  };
}

function appListFixture(): Record<string, unknown> {
  return {
    data: {
      appList: [
        {
          createdAt: "2026-01-01T00:00:00.000Z",
          defaultEnvironmentId: ENVIRONMENT_ID,
          id: APP_ID,
          name: "Benchmark app",
          ownerAccountId: ACCOUNT_ID,
        },
      ],
    },
  };
}

async function prepareContext(context: BrowserContext, session: SessionFixture): Promise<void> {
  await context.addInitScript(
    ({ appListResponse, viewerResponse }) => {
      localStorage.setItem("mosoo-locale", "en");

      const originalFetch = window.fetch.bind(window);
      const benchmarkFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const inputUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(inputUrl, window.location.href);
        if (!url.pathname.startsWith("/api/")) {
          return originalFetch(input, init);
        }

        let query = "";
        if (typeof init?.body === "string") {
          try {
            const body = JSON.parse(init.body) as { query?: unknown };
            query = typeof body.query === "string" ? body.query : "";
          } catch {
            // Return the deterministic benchmark error below for malformed input.
          }
        }

        const payload = query.includes("query Viewer")
          ? viewerResponse
          : query.includes("query AppList")
            ? appListResponse
            : { errors: [{ message: "The page-load benchmark does not resolve route data." }] };
        return new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json" },
          status: url.pathname === "/api/graphql" ? 200 : 503,
        });
      };
      window.fetch = benchmarkFetch as typeof window.fetch;
    },
    {
      appListResponse: appListFixture(),
      viewerResponse: viewerFixture(session),
    },
  );
}

function routeReadyMarkName(path: string): string {
  return `${ROUTE_READY_MARK_PREFIX}${path}`;
}

async function waitForRouteReady(page: Page, path: string, startedAt = 0): Promise<number> {
  const markName = routeReadyMarkName(path);
  await page.waitForFunction(
    ({ minimumStartTime, name }) =>
      performance
        .getEntriesByName(name, "mark")
        .some((entry) => entry.startTime >= minimumStartTime),
    { minimumStartTime: startedAt, name: markName },
    { timeout: timeoutMs },
  );
  return page.evaluate((name) => {
    const entries = performance.getEntriesByName(name, "mark");
    const latest = entries.at(-1);
    if (latest === undefined) {
      throw new Error(`The route-ready mark is missing: ${name}`);
    }
    return latest.startTime;
  }, markName);
}

async function prefetchRoute(page: Page, path: string): Promise<number> {
  const markName = `${ROUTE_PREFETCHED_MARK_PREFIX}${new URL(path, baseUrl).pathname}`;
  const startedAt = await page.evaluate((href) => {
    const anchor = document.createElement("a");
    anchor.href = href;
    document.body.append(anchor);
    const start = performance.now();
    anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    anchor.remove();
    return start;
  }, path);
  await page.waitForFunction(
    ({ minimumStartTime, name }) =>
      performance
        .getEntriesByName(name, "mark")
        .some((entry) => entry.startTime >= minimumStartTime),
    { minimumStartTime: startedAt, name: markName },
    { timeout: timeoutMs },
  );
  const finishedAt = await page.evaluate((name) => {
    const latest = performance.getEntriesByName(name, "mark").at(-1);
    if (latest === undefined) {
      throw new Error(`The route-prefetched mark is missing: ${name}`);
    }
    return latest.startTime;
  }, markName);
  return finishedAt - startedAt;
}

async function measurePage(pageCase: PageCase): Promise<PageMeasurement> {
  const context = await browser.newContext();
  await prepareContext(context, pageCase.session);
  const page = await context.newPage();
  try {
    const bootstrapPath =
      pageCase.session === "authenticated"
        ? pageCase.path === AUTHENTICATED_BOOTSTRAP_PATH
          ? AUTHENTICATED_ALTERNATE_BOOTSTRAP_PATH
          : AUTHENTICATED_BOOTSTRAP_PATH
        : pageCase.path === PUBLIC_BOOTSTRAP_PATH
          ? PUBLIC_ALTERNATE_BOOTSTRAP_PATH
          : PUBLIC_BOOTSTRAP_PATH;
    await page.goto(new URL(bootstrapPath, baseUrl).href, { waitUntil: "commit" });
    await waitForRouteReady(page, bootstrapPath);

    const prefetchMs = await prefetchRoute(page, pageCase.path);
    const startedAt = await page.evaluate((path) => {
      const start = performance.now();
      history.pushState(history.state, "", path);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      return start;
    }, pageCase.path);
    const readyAt = await waitForRouteReady(
      page,
      pageCase.expectedPath ?? pageCase.path,
      startedAt,
    );
    return {
      loadMs: Math.round((readyAt - startedAt) * 100) / 100,
      prefetchMs: Math.round(prefetchMs * 100) / 100,
    };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({
  ...(executablePath === undefined ? {} : { executablePath }),
  headless: true,
});

try {
  const results: PageResult[] = [];
  for (const pageCase of pageCases) {
    const samples: PageMeasurement[] = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      samples.push(await measurePage(pageCase));
    }
    const samplesMs = samples.map((sample) => sample.loadMs);
    const prefetchSamplesMs = samples.map((sample) => sample.prefetchMs);
    results.push({
      maxLoadMs: Math.max(...samplesMs),
      medianLoadMs: median(samplesMs),
      medianPrefetchMs: median(prefetchSamplesMs),
      path: pageCase.path,
    });
  }

  console.table(
    results.map((result) => ({
      "max load ms": result.maxLoadMs.toFixed(2),
      "median load ms": result.medianLoadMs.toFixed(2),
      "median prefetch ms": result.medianPrefetchMs.toFixed(2),
      route: result.path,
    })),
  );

  const failures = results.filter((result) => result.medianLoadMs >= thresholdMs);
  console.log(
    `Measured ${results.length} routes with ${sampleCount} fresh-context, intent-prefetched samples each; navigation-to-route-commit median limit ${thresholdMs.toFixed(2)} ms.`,
  );
  if (failures.length > 0) {
    console.error(
      `Routes over the limit: ${failures.map((failure) => `${failure.path} (${failure.medianLoadMs.toFixed(2)} ms)`).join(", ")}`,
    );
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
