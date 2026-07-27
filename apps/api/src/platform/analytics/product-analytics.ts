export const SERVER_PRODUCT_ANALYTICS_EVENTS = {
  agentCreated: "agent_created",
  appCreated: "app_created",
  taskSucceeded: "task_succeeded",
  integrationConnected: "integration_connected",
  onboardingCompleted: "onboarding_completed",
  signupCompleted: "signup_completed",
} as const;

export type ServerProductAnalyticsEvent =
  (typeof SERVER_PRODUCT_ANALYTICS_EVENTS)[keyof typeof SERVER_PRODUCT_ANALYTICS_EVENTS];

export interface ServerProductAnalyticsBindings {
  MOSOO_DEPLOYMENT_MODE?: string;
  MOSOO_ENVIRONMENT?: string;
  POSTHOG_API_HOST?: string;
  POSTHOG_PROJECT_KEY?: string;
}

export type ServerProductAnalyticsProperties = Readonly<
  Record<string, boolean | number | string | null | undefined>
>;

type ProductAnalyticsTransport = (input: string, init: RequestInit) => Promise<Response>;
let transportOverride: ProductAnalyticsTransport | null = null;

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getProjectKey(bindings: ServerProductAnalyticsBindings): string {
  return bindings.POSTHOG_PROJECT_KEY?.trim() ?? "";
}

export function isServerProductAnalyticsConfigured(
  bindings: ServerProductAnalyticsBindings,
): boolean {
  return getProjectKey(bindings).length > 0;
}

export async function captureServerProductEvent(
  bindings: ServerProductAnalyticsBindings,
  input: {
    distinctId: string;
    event: ServerProductAnalyticsEvent;
    properties?: ServerProductAnalyticsProperties;
  },
): Promise<void> {
  const projectKey = getProjectKey(bindings);
  if (projectKey.length === 0 || input.distinctId.trim().length === 0) {
    return;
  }

  const apiHost = trimTrailingSlash(bindings.POSTHOG_API_HOST?.trim() || DEFAULT_POSTHOG_HOST);
  const properties = Object.fromEntries(
    Object.entries({
      deployment_mode: bindings.MOSOO_DEPLOYMENT_MODE?.trim() || "cloud",
      distinct_id: input.distinctId,
      environment: bindings.MOSOO_ENVIRONMENT?.trim() || "production",
      ...input.properties,
    }).filter(([, value]) => value !== undefined),
  );
  const transport = transportOverride ?? globalThis.fetch;

  try {
    await transport(`${apiHost}/capture/`, {
      body: JSON.stringify({
        api_key: projectKey,
        event: input.event,
        properties,
        timestamp: new Date().toISOString(),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    // Analytics must never break the product's authoritative business path.
  }
}

export function setServerProductAnalyticsTransportForTests(
  transport: ProductAnalyticsTransport | null,
): void {
  transportOverride = transport;
}
