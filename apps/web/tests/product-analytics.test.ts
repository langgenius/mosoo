import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";

interface RecordedRequest {
  body: Record<string, unknown>;
  url: string;
}

const storage = new Map<string, string>();
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});

const {
  captureProductEvent,
  configureProductAnalytics,
  identifyProductUser,
  resetProductAnalytics,
} = await import("../src/analytics/product-analytics");

const ANONYMOUS_STORAGE_KEY = "mosoo_posthog_anonymous_id";
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let requests: RecordedRequest[] = [];

function installBrowserLocation(pathname = "/projects", search = "?source=test"): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: `https://app.mosoo.ai${pathname}${search}`,
        host: "app.mosoo.ai",
        pathname,
        search,
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { referrer: "https://mosoo.ai/?code=referrer-secret" },
  });
}

function requestProperties(index: number): Record<string, unknown> {
  return requests[index]?.body["properties"] as Record<string, unknown>;
}

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(init.body as string) as Record<string, unknown>, url });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  resetProductAnalytics();
  configureProductAnalytics("");
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

afterAll(() => {
  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, "localStorage");
  } else {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  }
});

describe("product analytics", () => {
  it("is inert without a project key", async () => {
    configureProductAnalytics(" ");
    captureProductEvent("onboarding_started");
    await Promise.resolve();

    expect(requests).toHaveLength(0);
  });

  it("captures anonymous events without autocapture or sensitive properties", async () => {
    installBrowserLocation();
    configureProductAnalytics("phc_public");
    captureProductEvent("onboarding_started", { step: "welcome" });
    await Promise.resolve();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://us.i.posthog.com/capture/");
    expect(requests[0]?.body["event"]).toBe("onboarding_started");
    expect(requests[0]?.body["api_key"]).toBe("phc_public");
    const properties = requestProperties(0);
    expect(properties["distinct_id"]).toBe(storage.get(ANONYMOUS_STORAGE_KEY));
    expect(properties["distinct_id"]).toMatch(/^mosoo_anon_/);
    expect(properties["deployment_mode"]).toBe("cloud");
    expect(properties["environment"]).toBe("production");
    expect(properties["step"]).toBe("welcome");
    expect(properties["$host"]).toBe("app.mosoo.ai");
    expect(properties["$pathname"]).toBe("/projects");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("source=test");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("referrer-secret");
  });

  it("aliases the anonymous identity once, then uses the stable account id", async () => {
    installBrowserLocation();
    configureProductAnalytics("phc_public");

    const anonymousId = storage.get(ANONYMOUS_STORAGE_KEY);
    identifyProductUser({ accountId: "acct_123", email: "rock@dify.ai", name: "Rock" });
    identifyProductUser({ accountId: "acct_123", email: "rock@dify.ai", name: "Rock" });
    captureProductEvent("page_viewed", { route: "/projects" });
    await Promise.resolve();

    expect(requests.map((request) => request.body["event"])).toEqual(["$identify", "page_viewed"]);
    const identifyProperties = requestProperties(0);
    expect(identifyProperties["distinct_id"]).toBe("acct_123");
    expect(identifyProperties["$anon_distinct_id"]).toBe(anonymousId);
    expect(identifyProperties["$set"]).toEqual({
      $internal_or_test_user: true,
      name: "Rock",
    });
    expect(JSON.stringify(requests[0]?.body)).not.toContain("rock@dify.ai");
    expect(requestProperties(1)["distinct_id"]).toBe("acct_123");
  });

  it("resets to a fresh anonymous identity on logout", async () => {
    installBrowserLocation();
    configureProductAnalytics("phc_public");
    const anonymousId = storage.get(ANONYMOUS_STORAGE_KEY);
    identifyProductUser({ accountId: "acct_123", email: "rock@example.com" });

    resetProductAnalytics();
    captureProductEvent("page_viewed");
    await Promise.resolve();

    const distinctId = requestProperties(1)["distinct_id"];
    expect(distinctId).toMatch(/^mosoo_anon_/);
    expect(distinctId).not.toBe(anonymousId);
    expect(distinctId).toBe(storage.get(ANONYMOUS_STORAGE_KEY));
  });
});
