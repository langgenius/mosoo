import { logWarn } from "../cloudflare/logger";
import type { ApiBindings } from "../cloudflare/worker-types";

export const SERVER_PRODUCT_ANALYTICS_EVENTS = {
  apiRequestCompleted: "api_request_completed",
  agentCreated: "agent_created",
  projectCreated: "project_created",
  sandboxCreated: "sandbox_created",
  taskSucceeded: "task_succeeded",
  integrationConnected: "integration_connected",
  onboardingCompleted: "onboarding_completed",
  signupCompleted: "signup_completed",
} as const;

export type ServerProductAnalyticsEvent =
  (typeof SERVER_PRODUCT_ANALYTICS_EVENTS)[keyof typeof SERVER_PRODUCT_ANALYTICS_EVENTS];

export type ServerProductAnalyticsProperties = Readonly<
  Record<string, boolean | number | string | null | undefined>
>;

export async function captureServerProductEvent(
  bindings: ApiBindings,
  input: {
    distinctId: string;
    event: ServerProductAnalyticsEvent;
    properties?: ServerProductAnalyticsProperties;
  },
): Promise<void> {
  const projectKey = bindings.POSTHOG_PROJECT_KEY?.trim();
  if (!projectKey) {
    return;
  }

  const properties = Object.fromEntries(
    Object.entries({
      deployment_mode: "cloud",
      distinct_id: input.distinctId,
      environment: bindings.MOSOO_ENVIRONMENT,
      ...input.properties,
    }).filter(([, value]) => value !== undefined),
  );

  try {
    const response = await fetch(`${bindings.POSTHOG_API_HOST}/capture/`, {
      body: JSON.stringify({
        api_key: projectKey,
        event: input.event,
        properties,
        timestamp: new Date().toISOString(),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      logWarn("product-analytics.capture_rejected", {
        event: input.event,
        status: response.status,
      });
    }
  } catch {
    // Analytics must never break the product's authoritative business path.
    logWarn("product-analytics.capture_failed", { event: input.event });
  }
}
