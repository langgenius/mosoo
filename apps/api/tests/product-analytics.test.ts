import { afterEach, describe, expect, it } from "bun:test";

import {
  captureServerProductEvent,
  isServerProductAnalyticsConfigured,
  setServerProductAnalyticsTransportForTests,
} from "../src/platform/analytics/product-analytics";

interface RecordedRequest {
  body: Record<string, unknown>;
  url: string;
}

afterEach(() => {
  setServerProductAnalyticsTransportForTests(null);
});

describe("server product analytics", () => {
  it("is disabled without a project key", async () => {
    const requests: RecordedRequest[] = [];
    setServerProductAnalyticsTransportForTests(async (url, init) => {
      requests.push({ body: JSON.parse(init.body as string) as Record<string, unknown>, url });
      return new Response(null, { status: 200 });
    });

    const bindings = {
      MOSOO_DEPLOYMENT_MODE: "cloud",
      MOSOO_ENVIRONMENT: "test",
    };
    expect(isServerProductAnalyticsConfigured(bindings)).toBe(false);
    await captureServerProductEvent(bindings, {
      distinctId: "acct_123",
      event: "project_created",
      properties: { project_id: "app_123" },
    });
    expect(requests).toHaveLength(0);
  });

  it("sends an explicit event with common SaaS context", async () => {
    const requests: RecordedRequest[] = [];
    setServerProductAnalyticsTransportForTests(async (url, init) => {
      requests.push({ body: JSON.parse(init.body as string) as Record<string, unknown>, url });
      return new Response(null, { status: 200 });
    });

    await captureServerProductEvent(
      {
        MOSOO_DEPLOYMENT_MODE: "cloud",
        MOSOO_ENVIRONMENT: "test",
        POSTHOG_API_HOST: "https://us.i.posthog.com/",
        POSTHOG_PROJECT_KEY: "phc_public",
      },
      {
        distinctId: "acct_123",
        event: "project_created",
        properties: {
          project_id: "app_123",
          organization_id: "org_123",
        },
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://us.i.posthog.com/capture/");
    expect(requests[0]?.body["api_key"]).toBe("phc_public");
    expect(requests[0]?.body["event"]).toBe("project_created");
    const properties = requests[0]?.body["properties"] as Record<string, unknown>;
    expect(properties).toEqual({
      project_id: "app_123",
      deployment_mode: "cloud",
      distinct_id: "acct_123",
      environment: "test",
      organization_id: "org_123",
    });
  });

  it("never throws when PostHog is unavailable", async () => {
    setServerProductAnalyticsTransportForTests(async () => {
      throw new Error("network down");
    });

    await expect(
      captureServerProductEvent(
        { POSTHOG_PROJECT_KEY: "phc_public" },
        { distinctId: "acct_123", event: "integration_connected" },
      ),
    ).resolves.toBeUndefined();
  });
});
