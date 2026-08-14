export const PRODUCT_ANALYTICS_EVENTS = {
  appCreated: "app_created",
  integrationConnected: "integration_connected",
  loginStarted: "login_started",
  onboardingCompleted: "onboarding_completed",
  onboardingStarted: "onboarding_started",
  onboardingStepViewed: "onboarding_step_viewed",
  pageViewed: "page_viewed",
  signupCompleted: "signup_completed",
} as const;

export type ProductAnalyticsEvent =
  (typeof PRODUCT_ANALYTICS_EVENTS)[keyof typeof PRODUCT_ANALYTICS_EVENTS];

export interface ProductAnalyticsConfig {
  apiHost?: string | undefined;
  deploymentMode?: string | undefined;
  environment?: string | undefined;
  projectKey: string;
}

export interface ProductAnalyticsIdentity {
  accountId: string;
  email: string;
  name?: string | null;
}

export type ProductAnalyticsProperties = Readonly<
  Record<string, boolean | number | string | null | undefined>
>;

type ProductAnalyticsTransport = (input: string, init: RequestInit) => Promise<Response>;

interface ProductAnalyticsState {
  apiHost: string;
  deploymentMode: string;
  distinctId: string;
  enabled: boolean;
  environment: string;
  identifiedAccountId: string | null;
  projectKey: string;
}

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const ANONYMOUS_STORAGE_KEY = "mosoo_posthog_anonymous_id";
let transportOverride: ProductAnalyticsTransport | null = null;
let state: ProductAnalyticsState = createInitialState();

function createAnonymousId(): string {
  const cryptoObject = globalThis.crypto;
  const suffix =
    typeof cryptoObject?.randomUUID === "function"
      ? cryptoObject.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `mosoo_anon_${suffix}`;
}

function readStoredAnonymousId(): string | null {
  try {
    return globalThis.localStorage?.getItem(ANONYMOUS_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeAnonymousId(id: string): void {
  try {
    globalThis.localStorage?.setItem(ANONYMOUS_STORAGE_KEY, id);
  } catch {
    // Browser storage can be unavailable in restricted contexts.
  }
}

function getOrCreateAnonymousId(): string {
  const stored = readStoredAnonymousId();
  if (stored !== null && stored.startsWith("mosoo_anon_")) {
    return stored;
  }

  const id = createAnonymousId();
  storeAnonymousId(id);
  return id;
}

function createInitialState(): ProductAnalyticsState {
  return {
    apiHost: DEFAULT_POSTHOG_HOST,
    deploymentMode: "cloud",
    distinctId: getOrCreateAnonymousId(),
    enabled: false,
    environment: "production",
    identifiedAccountId: null,
    projectKey: "",
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function locationProperties(): ProductAnalyticsProperties {
  if (typeof window === "undefined") {
    return {};
  }

  return {
    $host: window.location.host,
    $pathname: window.location.pathname,
  };
}

function sanitizeProperties(properties: ProductAnalyticsProperties): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function postEvent(event: string, properties: Readonly<Record<string, unknown>>): void {
  if (!state.enabled) {
    return;
  }

  const transport = transportOverride ?? globalThis.fetch;
  if (typeof transport !== "function") {
    return;
  }

  const body = JSON.stringify({
    api_key: state.projectKey,
    event,
    properties: sanitizeProperties({
      ...locationProperties(),
      deployment_mode: state.deploymentMode,
      distinct_id: state.distinctId,
      environment: state.environment,
      ...properties,
    }),
    timestamp: new Date().toISOString(),
  });

  void transport(`${state.apiHost}/capture/`, {
    body,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}

export function configureProductAnalytics(config: ProductAnalyticsConfig): void {
  const projectKey = config.projectKey.trim();
  state = {
    ...state,
    apiHost: trimTrailingSlash(config.apiHost?.trim() || DEFAULT_POSTHOG_HOST),
    deploymentMode: config.deploymentMode?.trim() || "cloud",
    enabled: projectKey.length > 0,
    environment: config.environment?.trim() || "production",
    projectKey,
  };
}

export function captureProductEvent(
  event: ProductAnalyticsEvent,
  properties: ProductAnalyticsProperties = {},
): void {
  postEvent(event, properties);
}

export function identifyProductUser(identity: ProductAnalyticsIdentity): void {
  const accountId = identity.accountId.trim();
  if (accountId.length === 0 || state.identifiedAccountId === accountId) {
    return;
  }

  const anonymousId = state.distinctId;
  const internalOrTestUser = identity.email.trim().toLowerCase().endsWith("@dify.ai");
  state = { ...state, distinctId: accountId, identifiedAccountId: accountId };
  postEvent("$identify", {
    $anon_distinct_id: anonymousId,
    $set: sanitizeProperties({
      $internal_or_test_user: internalOrTestUser,
      name: identity.name ?? undefined,
    }),
  });
}

export function resetProductAnalytics(): void {
  const distinctId = createAnonymousId();
  storeAnonymousId(distinctId);
  state = {
    ...state,
    distinctId,
    identifiedAccountId: null,
  };
}

export function getProductAnalyticsState(): Readonly<ProductAnalyticsState> {
  return state;
}

export function setProductAnalyticsTransportForTests(
  transport: ProductAnalyticsTransport | null,
): void {
  transportOverride = transport;
}
