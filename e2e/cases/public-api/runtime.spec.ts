import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import {
  PUBLIC_RUNTIME_CATALOG,
  VENDOR_OPENAI_COMPATIBLE,
  listPresetModelsForVendor,
} from "@mosoo/runtime-catalog";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { createRuntimeSignalCollector } from "../../lib/runtime-progress";

type ProviderId = "anthropic" | "deepseek" | "openai";
type RuntimeCredentialVendorId = "anthropic" | "openai" | typeof VENDOR_OPENAI_COMPATIBLE.vendorId;

const DEFAULT_DEEPSEEK_API_BASE = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: Array<{ message: string }>;
}

interface RuntimeSelection {
  apiBase: string | null;
  credentialVendorId: RuntimeCredentialVendorId;
  model: string;
  providerId: ProviderId;
  providerModelIds: readonly string[];
  runtimeId: string;
}

function readProviderId(): ProviderId {
  const provider = process.env["MOSOO_E2E_PROVIDER"]?.trim() ?? "";

  if (provider === "" || provider === "openai") {
    return "openai";
  }

  if (provider === "anthropic") {
    return "anthropic";
  }

  if (provider === "deepseek") {
    return "deepseek";
  }

  throw new Error(`Unsupported MOSOO_E2E_PROVIDER=${provider}.`);
}

function requireProviderApiKey(providerId: ProviderId): string {
  const apiKey =
    process.env["MOSOO_E2E_PROVIDER_API_KEY"]?.trim() ||
    (providerId === "anthropic"
      ? process.env["MOSOO_E2E_ANTHROPIC_API_KEY"]?.trim()
      : providerId === "deepseek"
        ? process.env["MOSOO_E2E_DEEPSEEK_API_KEY"]?.trim()
        : process.env["MOSOO_E2E_OPENAI_API_KEY"]?.trim()) ||
    "";

  if (apiKey.length === 0) {
    throw new Error("Public API runtime E2E requires a provider API key.");
  }

  return apiKey;
}

function findPublicRuntime(runtimeId: string) {
  return PUBLIC_RUNTIME_CATALOG.find((entry) => entry.runtimeId === runtimeId);
}

function readRuntimeIdOverride(): string | null {
  return process.env["MOSOO_E2E_RUNTIME_ID"]?.trim() || null;
}

function selectPresetRuntime(providerId: "anthropic" | "openai"): RuntimeSelection {
  const runtimeIdOverride = readRuntimeIdOverride();
  const runtime =
    runtimeIdOverride === null
      ? PUBLIC_RUNTIME_CATALOG.find(
          (entry) =>
            entry.defaultProvider === providerId &&
            entry.vendors.some((vendor) => vendor.vendorId === providerId),
        )
      : findPublicRuntime(runtimeIdOverride);

  if (runtime === undefined) {
    throw new Error(
      runtimeIdOverride === null
        ? `No public runtime catalog entry for provider ${providerId}.`
        : `No public runtime catalog entry for MOSOO_E2E_RUNTIME_ID=${runtimeIdOverride}.`,
    );
  }

  if (!runtime.vendors.some((vendor) => vendor.vendorId === providerId)) {
    throw new Error(`Runtime ${runtime.runtimeId} does not support provider ${providerId}.`);
  }

  const model =
    runtime.defaultProvider === providerId
      ? runtime.defaultModel
      : listPresetModelsForVendor(providerId).find((entry) =>
          runtime.supportedModelIds?.includes(entry.modelId),
        )?.modelId;

  if (model === undefined) {
    throw new Error(
      `Runtime ${runtime.runtimeId} does not expose a model for provider ${providerId}.`,
    );
  }

  return {
    apiBase: null,
    credentialVendorId: providerId,
    model,
    providerId,
    providerModelIds: [],
    runtimeId: runtime.runtimeId,
  };
}

function selectDeepSeekRuntime(): RuntimeSelection {
  const runtimeId = readRuntimeIdOverride() ?? "openai-runtime";
  const runtime = findPublicRuntime(runtimeId);

  if (runtime === undefined) {
    throw new Error(`No public runtime catalog entry for MOSOO_E2E_RUNTIME_ID=${runtimeId}.`);
  }

  if (!runtime.acceptsCustomProvider) {
    throw new Error(
      `Runtime ${runtime.runtimeId} does not accept OpenAI-compatible custom providers. Use a public runtime with acceptsCustomProvider=true before running DeepSeek live E2E.`,
    );
  }

  const model = process.env["MOSOO_E2E_DEEPSEEK_MODEL"]?.trim() || DEFAULT_DEEPSEEK_MODEL;

  return {
    apiBase: process.env["MOSOO_E2E_DEEPSEEK_BASE_URL"]?.trim() || DEFAULT_DEEPSEEK_API_BASE,
    credentialVendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    model,
    providerId: "deepseek",
    providerModelIds: [model],
    runtimeId: runtime.runtimeId,
  };
}

function getRuntimeSelection(providerId: ProviderId): RuntimeSelection {
  if (providerId === "deepseek") {
    return selectDeepSeekRuntime();
  }

  return selectPresetRuntime(providerId);
}

function runId(): string {
  return Date.now().toString(36);
}

async function waitForApiHealth(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/health", {
          timeout: 5_000,
        });

        if (!response.ok()) {
          return `status:${response.status()}`;
        }

        const payload: unknown = await response.json();

        return payload !== null &&
          typeof payload === "object" &&
          "ok" in payload &&
          payload.ok === true
          ? "ready"
          : "not-ready";
      },
      {
        intervals: [500, 1_000, 2_000],
        timeout: 90_000,
      },
    )
    .toBe("ready");
}

async function requestGraphQL<TData>(
  request: APIRequestContext,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<TData> {
  const response = await request.post(`${PUBLIC_API_PREFIX}/graphql`, {
    data: {
      query,
      variables,
    },
    headers: {
      "Content-Type": "application/json",
    },
    timeout: 30_000,
  });
  const payload = (await response.json().catch(() => null)) as GraphQLResponse<TData> | null;
  const errors = payload?.errors?.map((entry) => entry.message).join("; ") ?? "";

  if (!response.ok() || errors.length > 0 || payload?.data === undefined) {
    throw new Error(`GraphQL request failed: ${response.status()} ${errors}`);
  }

  return payload.data;
}

async function login(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(
    `${PUBLIC_API_PREFIX}/auth/development-backdoor/mosoo-ai-login`,
    {
      data: { email },
      timeout: 30_000,
    },
  );

  if (!response.ok()) {
    throw new Error(`Development login failed with HTTP ${response.status()}.`);
  }
}

async function ensureOnboarding(request: APIRequestContext): Promise<void> {
  await requestGraphQL(
    request,
    `
    mutation E2EOnboarding($input: BootstrapOnboardingInput!) {
      onboardingBootstrap(input: $input) {
        completed
      }
    }
  `,
    {
      input: {},
    },
  );
}

async function getActiveAppId(request: APIRequestContext): Promise<string> {
  const viewer = await requestGraphQL<{
    viewer: {
      activeOrganization: {
        id: string;
      } | null;
    };
  }>(
    request,
    `
    query E2EViewer {
      viewer {
        activeOrganization {
          id
        }
      }
    }
  `,
  );
  const organizationId = viewer.viewer.activeOrganization?.id;

  if (!organizationId) {
    throw new Error("Onboarding did not create an active organization.");
  }

  const apps = await requestGraphQL<{
    appList: Array<{
      id: string;
    }>;
  }>(
    request,
    `
      query E2EAppList($organizationId: ULID!) {
        appList(organizationId: $organizationId) {
          id
        }
      }
    `,
    { organizationId },
  );
  const appId = apps.appList[0]?.id;

  if (!appId) {
    throw new Error("Onboarding did not create an App.");
  }

  return appId;
}

async function createAgent(
  request: APIRequestContext,
  input: {
    appId: string;
    name: string;
    runtime: RuntimeSelection;
  },
): Promise<string> {
  const data = await requestGraphQL<{
    createAgent: {
      id: string;
    };
  }>(
    request,
    `
      mutation E2ECreateAgent($input: CreateAgentInput!) {
        createAgent(input: $input) {
          id
        }
      }
    `,
    {
      input: {
        description: "Public API runtime E2E agent",
        kind: "cattle",
        model: input.runtime.model,
        name: input.name,
        appId: input.appId,
        prompt: "Reply concisely. Do not use tools.",
        provider: input.runtime.credentialVendorId,
        runtimeId: input.runtime.runtimeId,
        skillIds: [],
      },
    },
  );

  return data.createAgent.id;
}

async function configureProviderCredential(
  request: APIRequestContext,
  input: {
    apiKey: string;
    apiBase: string | null;
    appId: string;
    label: string;
    providerId: RuntimeCredentialVendorId;
    providerModelIds: readonly string[];
  },
): Promise<void> {
  const created = await requestGraphQL<{
    createVendorCredential: {
      id: string;
    };
  }>(
    request,
    `
      mutation E2ECreateVendorCredential($input: CreateVendorCredentialInput!) {
        createVendorCredential(input: $input) {
          id
        }
      }
    `,
    {
      input: {
        apiBase: input.apiBase,
        apiKey: input.apiKey,
        models: input.providerModelIds,
        name: input.label,
        appId: input.appId,
        vendorId: input.providerId,
      },
    },
  );

  await requestGraphQL(
    request,
    `
      mutation E2ESetDefaultVendorCredential($input: SetDefaultVendorCredentialInput!) {
        setDefaultVendorCredential(input: $input) {
          id
        }
      }
    `,
    {
      input: {
        id: created.createVendorCredential.id,
        appId: input.appId,
      },
    },
  );
}

async function publishAgent(
  request: APIRequestContext,
  input: {
    agentId: string;
    appId: string;
  },
): Promise<void> {
  await requestGraphQL(
    request,
    `
      mutation E2EPublishAgent($input: PublishAgentInput!) {
        publishAgent(input: $input) {
          id
        }
      }
    `,
    {
      input,
    },
  );
}

async function createPersonalAccessToken(
  request: APIRequestContext,
  label: string,
): Promise<string> {
  const response = await request.post(`${PUBLIC_API_PREFIX}/access-tokens`, {
    data: { label },
    timeout: 30_000,
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok() || typeof payload !== "object" || payload === null || !("value" in payload)) {
    throw new Error(`Could not create Public API token: HTTP ${response.status()}.`);
  }

  const token = payload.value;

  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Public API token response did not include value.");
  }

  return token;
}

async function createThreadViaPublicApi(
  request: APIRequestContext,
  input: {
    agentId: string;
    expectedToken: string;
    label: string;
    pat: string;
  },
): Promise<string> {
  const response = await request.post(`/api/v1/agents/${input.agentId}/threads`, {
    data: {
      input: {
        content: [
          {
            text: `Reply with exactly ${input.expectedToken}. Do not use tools.`,
            type: "text",
          },
        ],
        type: "user.message",
      },
    },
    headers: {
      Authorization: `Bearer ${input.pat}`,
      "Idempotency-Key": `e2e-public-api-runtime-${input.label}`,
    },
    timeout: 30_000,
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok() || typeof payload !== "object" || payload === null || !("thread" in payload)) {
    throw new Error(`Public API create thread failed: HTTP ${response.status()}.`);
  }

  const thread = payload.thread;

  if (typeof thread !== "object" || thread === null || !("id" in thread)) {
    throw new Error("Public API create thread response did not include thread.id.");
  }

  const threadId = thread.id;

  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("Public API create thread response thread.id is invalid.");
  }

  return threadId;
}

async function waitForPublicApiRuntimeResult(
  request: APIRequestContext,
  input: {
    expectedToken: string;
    pat: string;
    threadId: string;
  },
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/threads/${input.threadId}/events?limit=100`, {
          headers: {
            Authorization: `Bearer ${input.pat}`,
          },
          timeout: 10_000,
        });
        const payload: unknown = await response.json().catch(() => null);

        if (
          !response.ok() ||
          typeof payload !== "object" ||
          payload === null ||
          !("events" in payload)
        ) {
          return `events-http-${response.status()}`;
        }

        const events = payload.events;

        if (!Array.isArray(events)) {
          return "events-invalid";
        }

        for (const event of events) {
          if (typeof event !== "object" || event === null) {
            continue;
          }

          if (event.type === "run.failed") {
            return `run.failed:${"content" in event ? String(event.content) : ""}`;
          }

          if (
            typeof event.type === "string" &&
            event.type.startsWith("agent.message") &&
            "content" in event &&
            String(event.content).includes(input.expectedToken)
          ) {
            return "completed";
          }
        }

        return events.length === 0
          ? "waiting:no-events"
          : `waiting:${events.at(-1)?.type ?? "event"}`;
      },
      {
        intervals: [1_000, 2_000, 5_000],
        timeout: 180_000,
      },
    )
    .toBe("completed");
}

test("Public API creates a real runtime thread and receives runtime events", async ({
  request,
}, testInfo) => {
  const providerId = readProviderId();
  const apiKey = requireProviderApiKey(providerId);
  const runtime = getRuntimeSelection(providerId);
  const label = runId();
  const email = process.env["MOSOO_E2E_EMAIL"]?.trim() || `public-api-runtime-${label}@mosoo.ai`;
  const expectedToken = `PUBLIC_API_RUNTIME_${label.toUpperCase()}`;
  const signals = createRuntimeSignalCollector({
    progress: true,
    source: "public-api-runtime",
  });

  signals.checkpoint("api.health.start");
  await waitForApiHealth(request);
  signals.checkpoint("api.health.done");
  await login(request, email);
  signals.checkpoint("api.auth.done", { email });
  await ensureOnboarding(request);
  const appId = await getActiveAppId(request);
  signals.checkpoint("api.app.ready", { appId });
  const agentId = await createAgent(request, {
    appId,
    name: `Public API runtime ${label}`,
    runtime,
  });
  signals.checkpoint("api.agent.created", {
    agentId,
    provider: providerId,
    runtimeId: runtime.runtimeId,
  });
  await configureProviderCredential(request, {
    apiKey,
    apiBase: runtime.apiBase,
    appId,
    label: `Public API runtime ${label}`,
    providerId: runtime.credentialVendorId,
    providerModelIds: runtime.providerModelIds,
  });
  signals.checkpoint("api.provider.configured", {
    provider: providerId,
    runtimeProvider: runtime.credentialVendorId,
  });
  await publishAgent(request, { agentId, appId });
  signals.checkpoint("api.agent.published", { agentId });
  const pat = await createPersonalAccessToken(request, `Public API runtime ${label}`);
  signals.checkpoint("public-api.token.created");
  const threadId = await createThreadViaPublicApi(request, {
    agentId,
    expectedToken,
    label,
    pat,
  });
  signals.checkpoint("public-api.thread.created", { threadId });
  await waitForPublicApiRuntimeResult(request, {
    expectedToken,
    pat,
    threadId,
  });
  signals.checkpoint("public-api.runtime.completed", { threadId });
  signals.assertCoverage({
    requiredCategories: ["feature_path_execution"],
  });
  await signals.attachArtifact(testInfo);
});
