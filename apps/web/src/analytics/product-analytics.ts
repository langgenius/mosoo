export const PRODUCT_ANALYTICS_EVENTS = {
  loginStarted: "login_started",
  onboardingStarted: "onboarding_started",
  pageViewed: "page_viewed",
} as const;

type ProductAnalyticsEvent =
  (typeof PRODUCT_ANALYTICS_EVENTS)[keyof typeof PRODUCT_ANALYTICS_EVENTS];

interface ProductAnalyticsIdentity {
  accountId: string;
  email: string;
  name?: string | null;
}

type ProductAnalyticsProperties = Readonly<
  Record<string, boolean | number | string | null | undefined>
>;

interface ProductAnalyticsState {
  distinctId: string;
  identifiedAccountId: string | null;
  projectKey: string;
}

const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/";
const ANONYMOUS_STORAGE_KEY = "mosoo_posthog_anonymous_id";

function createAnonymousId(): string {
  const cryptoObject = globalThis.crypto;
  const suffix =
    typeof cryptoObject?.randomUUID === "function"
      ? cryptoObject.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `mosoo_anon_${suffix}`;
}

function storeNewAnonymousId(): string {
  const id = createAnonymousId();
  localStorage.setItem(ANONYMOUS_STORAGE_KEY, id);
  return id;
}

function getOrCreateAnonymousId(): string {
  const stored = localStorage.getItem(ANONYMOUS_STORAGE_KEY);
  return stored?.startsWith("mosoo_anon_") ? stored : storeNewAnonymousId();
}

let state: ProductAnalyticsState = {
  distinctId: getOrCreateAnonymousId(),
  identifiedAccountId: null,
  projectKey: "",
};

function sanitizeProperties(properties: ProductAnalyticsProperties): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function postEvent(event: string, properties: Readonly<Record<string, unknown>>): void {
  if (state.projectKey === "") {
    return;
  }

  const body = JSON.stringify({
    api_key: state.projectKey,
    event,
    properties: sanitizeProperties({
      $host: window.location.host,
      $pathname: window.location.pathname,
      deployment_mode: "cloud",
      distinct_id: state.distinctId,
      environment: "production",
      ...properties,
    }),
    timestamp: new Date().toISOString(),
  });

  void fetch(POSTHOG_CAPTURE_URL, {
    body,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}

export function configureProductAnalytics(projectKey: string): void {
  state = { ...state, projectKey: projectKey.trim() };
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
  state = {
    ...state,
    distinctId: storeNewAnonymousId(),
    identifiedAccountId: null,
  };
}
