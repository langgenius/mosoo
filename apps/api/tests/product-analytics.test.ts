import { describe, expect, it, spyOn } from "bun:test";

import { captureServerProductEvent } from "../src/platform/analytics/product-analytics";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

interface RecordedRequest {
  body: Record<string, unknown>;
  url: string;
}

const BINDINGS = {
  MOSOO_ENVIRONMENT: "development",
  POSTHOG_API_HOST: "https://us.i.posthog.com",
} as ApiBindings;

async function captureWithFetch(
  bindings: ApiBindings,
  input: Parameters<typeof captureServerProductEvent>[1],
  respond: () => Promise<Response> = async () => new Response(null, { status: 200 }),
): Promise<RecordedRequest[]> {
  const requests: RecordedRequest[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    requests.push({
      body: JSON.parse(init?.body as string) as Record<string, unknown>,
      url: String(url),
    });
    return respond();
  });

  try {
    await captureServerProductEvent(bindings, input);
  } finally {
    fetchSpy.mockRestore();
  }

  return requests;
}

describe("server product analytics", () => {
  it("is disabled without a project key", async () => {
    const requests = await captureWithFetch(BINDINGS, {
      distinctId: "acct_123",
      event: "project_created",
      properties: { project_id: "app_123" },
    });

    expect(requests).toHaveLength(0);
  });

  it("sends an explicit event with common SaaS context", async () => {
    const requests = await captureWithFetch(
      { ...BINDINGS, POSTHOG_PROJECT_KEY: "phc_public" },
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
      environment: "development",
      organization_id: "org_123",
    });
  });

  it("never throws when PostHog is unavailable", async () => {
    await expect(
      captureWithFetch(
        { ...BINDINGS, POSTHOG_PROJECT_KEY: "phc_public" },
        { distinctId: "acct_123", event: "integration_connected" },
        async () => {
          throw new Error("network down");
        },
      ),
    ).resolves.toHaveLength(1);
  });
});
