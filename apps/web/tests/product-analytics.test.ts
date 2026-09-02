import { afterEach, describe, expect, it } from "bun:test";

import {
  captureProductEvent,
  configureProductAnalytics,
  getProductAnalyticsState,
  identifyProductUser,
  resetProductAnalytics,
  setProductAnalyticsTransportForTests,
} from "../src/analytics/product-analytics";

interface RecordedRequest {
  body: Record<string, unknown>;
  url: string;
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

function installBrowserLocation(pathname = "/projects", search = "?source=test"): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: `https://project.mosoo.ai${pathname}${search}`,
        host: "project.mosoo.ai",
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

afterEach(() => {
  resetProductAnalytics();
  setProductAnalyticsTransportForTests(null);
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("product analytics", () => {
  it("is inert without a project key", async () => {
    const requests: RecordedRequest[] = [];
    setProductAnalyticsTransportForTests(async (url, init) => {
      requests.push({ body: JSON.parse(init.body as string) as Record<string, unknown>, url });
      return new Response(null, { status: 200 });
    });

    configureProductAnalytics({ apiHost: "https://us.i.posthog.com", projectKey: "" });
    captureProductEvent("onboarding_started");
    await Promise.resolve();

    expect(requests).toHaveLength(0);
    expect(getProductAnalyticsState().enabled).toBe(false);
  });

  it("captures anonymous events without autocapture or sensitive properties", async () => {
    installBrowserLocation();
    const requests: RecordedRequest[] = [];
    setProductAnalyticsTransportForTests(async (url, init) => {
      requests.push({ body: JSON.parse(init.body as string) as Record<string, unknown>, url });
      return new Response(null, { status: 200 });
    });

    configureProductAnalytics({
      apiHost: "https://us.i.posthog.com/",
      deploymentMode: "cloud",
      environment: "test",
      projectKey: "phc_public",
    });
    captureProductEvent("onboarding_started", { step: "welcome" });
    await Promise.resolve();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://us.i.posthog.com/capture/");
    expect(requests[0]?.body["event"]).toBe("onboarding_started");
    expect(requests[0]?.body["api_key"]).toBe("phc_public");
    const properties = requests[0]?.body["properties"] as Record<string, unknown>;
    expect(properties["distinct_id"]).toMatch(/^mosoo_anon_/);
    expect(properties["deployment_mode"]).toBe("cloud");
    expect(properties["environment"]).toBe("test");
    expect(properties["step"]).toBe("welcome");
    expect(properties["$host"]).toBe("project.mosoo.ai");
    expect(properties["$pathname"]).toBe("/projects");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("source=test");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("referrer-secret");
  });

  it("aliases the anonymous identity once, then uses the stable account id", async () => {
    installBrowserLocation();
    const requests: RecordedRequest[] = [];
    setProductAnalyticsTransportForTests(async (url, init) => {
      requests.push({ body: JSON.parse(init.body as string) as Record<string, unknown>, url });
      return new Response(null, { status: 200 });
    });
    configureProductAnalytics({ projectKey: "phc_public" });

    const anonymousId = getProductAnalyticsState().distinctId;
    identifyProductUser({ accountId: "acct_123", email: "rock@dify.ai", name: "Rock" });
    captureProductEvent("page_viewed", { route: "/projects" });
    await Promise.resolve();

    expect(requests.map((request) => request.body["event"])).toEqual(["$identify", "page_viewed"]);
    const identifyProperties = requests[0]?.body["properties"] as Record<string, unknown>;
    expect(identifyProperties["distinct_id"]).toBe("acct_123");
    expect(identifyProperties["$anon_distinct_id"]).toBe(anonymousId);
    expect(identifyProperties["$set"]).toEqual({
      $internal_or_test_user: true,
      name: "Rock",
    });
    expect(JSON.stringify(requests[0]?.body)).not.toContain("rock@dify.ai");
    const pageProperties = requests[1]?.body["properties"] as Record<string, unknown>;
    expect(pageProperties["distinct_id"]).toBe("acct_123");
  });

  it("resets to a fresh anonymous identity on logout", () => {
    installBrowserLocation();
    configureProductAnalytics({ projectKey: "phc_public" });
    identifyProductUser({ accountId: "acct_123", email: "rock@example.com" });

    resetProductAnalytics();

    expect(getProductAnalyticsState().distinctId).toMatch(/^mosoo_anon_/);
    expect(getProductAnalyticsState().identifiedAccountId).toBe(null);
  });
});
