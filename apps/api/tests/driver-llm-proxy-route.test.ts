import { afterEach, describe, expect, test } from "bun:test";

import { driverInstancesTable, vendorCredentialsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, ProjectId, VendorCredentialId } from "@mosoo/id";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { registerDriverRoute } from "../src/adapters/http/routes/driver-route";
import { getRuntimeDriverLlmProxyPath } from "../src/modules/runtime/domain/runtime-driver-routes";
import { createRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import type { RuntimeActionTokenPayload } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { storeVendorCredentialSecret } from "../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings, ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
} from "./helpers/public-api-http-test-fixture";

const CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J0000000000000000000000B",
  "credential ID",
);
const OTHER_CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J0000000000000000000000E",
  "other credential ID",
);
const PROJECT_ID = PUBLIC_API_TEST_IDS.project as ProjectId;
const DRIVER_INSTANCE_ID = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
const OTHER_DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>(
  "01J0000000000000000000000G",
  "other driver instance ID",
);
const UPSTREAM_API_KEY = "sk-real-upstream-key";

type ContractDatabase = Awaited<ReturnType<typeof createPublicHttpContractDatabase>>;

interface CapturedUpstreamRequest {
  body: string | null;
  headers: Headers;
  method: string;
  redirect: RequestRedirect;
  signal: AbortSignal;
  url: string;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createDriverRouteTestProject(): Hono<ApiGatewayEnvironment> {
  const project = new Hono<ApiGatewayEnvironment>();
  registerDriverRoute(project);
  return project;
}

function captureUpstreamFetch(response?: () => Response): CapturedUpstreamRequest[] {
  const captured: CapturedUpstreamRequest[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    captured.push({
      body: request.method === "GET" || request.method === "HEAD" ? null : await request.text(),
      headers: request.headers,
      method: request.method,
      redirect: request.redirect,
      signal: request.signal,
      url: request.url,
    });

    return (
      response?.() ??
      new Response('{"ok":true}', {
        headers: {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
          "x-upstream-marker": "1",
        },
        status: 200,
      })
    );
  }) as typeof fetch;

  return captured;
}

async function insertDriverInstance(
  database: ContractDatabase,
  status: "provisioning" | "connecting" | "ready" | "failed",
  input: {
    bootTokenExpiresAt?: number;
    driverInstanceId?: DriverInstanceId;
    generation?: number;
    lastHeartbeatAt?: number | null;
    updatedAt?: number;
  } = {},
) {
  const nowMs = input.updatedAt ?? Date.now();
  await database
    .project()
    .insert(driverInstancesTable)
    .values({
      bootTokenExpiresAt: input.bootTokenExpiresAt ?? nowMs + 60_000,
      bootTokenHash: new Uint8Array([1, 2, 3]),
      bootTokenUsedAt: null,
      closeCode: null,
      closeReason: null,
      connectionId: null,
      createdAt: nowMs,
      driverPid: null,
      driverStartedAt: null,
      driverVersion: null,
      errorMessage: null,
      expiresAt: nowMs + 60_000,
      generation: input.generation ?? 0,
      heartbeatCount: 0,
      id: input.driverInstanceId ?? DRIVER_INSTANCE_ID,
      lastHeartbeatAt: input.lastHeartbeatAt ?? null,
      processId: null,
      protocol: "orpc-ws",
      protocolVersion: 2,
      runtime: "claude-agent-sdk",
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sandboxSessionId: PUBLIC_API_TEST_IDS.ownerSession,
      status,
      statusChangedAt: nowMs,
      statusSource: "api",
      updatedAt: nowMs,
    })
    .run();
}

async function insertVendorCredential(
  database: ContractDatabase,
  bindings: ApiBindings,
  input: {
    apiBase?: string | null;
    credentialId?: VendorCredentialId;
    vendorId: string;
  },
) {
  const credentialId = input.credentialId ?? CREDENTIAL_ID;
  const secretId = await storeVendorCredentialSecret(bindings, {
    apiKey: UPSTREAM_API_KEY,
    credentialId,
    projectId: PROJECT_ID,
    providerId: input.vendorId,
    purpose: "credential_create_api_key",
  });
  const nowMs = Date.now();

  await database
    .project()
    .insert(vendorCredentialsTable)
    .values({
      apiBase: input.apiBase ?? null,
      apiKeySecretId: secretId,
      createdAt: nowMs,
      id: credentialId,
      isDefault: true,
      models: null,
      name: `${input.vendorId} credential`,
      projectId: PROJECT_ID,
      updatedAt: nowMs,
      vendorId: input.vendorId,
    })
    .run();
}

async function createLlmProxyGrant(
  bindings: ApiBindings,
  overrides: Partial<Extract<RuntimeActionTokenPayload, { action: "llm_proxy" }>> = {},
): Promise<string> {
  return createRuntimeActionToken(bindings, {
    action: "llm_proxy",
    projectId: PROJECT_ID,
    driverGeneration: 0,
    driverInstanceId: DRIVER_INSTANCE_ID,
    expiresAt: Date.now() + 60_000,
    modelId: "claude-sonnet-5",
    modelProtocol: "anthropic-messages",
    resourceId: CREDENTIAL_ID,
    ...overrides,
  });
}

function llmProxyRequest(
  subPath: string,
  init: RequestInit & { credentialId?: VendorCredentialId } = {},
): Request {
  const { credentialId, ...requestInit } = init;
  return new Request(
    `https://api.example.com${getRuntimeDriverLlmProxyPath(credentialId ?? CREDENTIAL_ID)}${subPath}`,
    requestInit,
  );
}

async function setupFixture(input?: {
  apiBase?: string | null;
  driverGeneration?: number;
  driverStatus?: "provisioning" | "connecting" | "ready" | "failed" | "absent";
  driverUpdatedAt?: number;
  vendorId?: string;
}) {
  const database = await createPublicHttpContractDatabase();
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;

  if (input?.driverStatus !== "absent") {
    await insertDriverInstance(database, input?.driverStatus ?? "ready", {
      generation: input?.driverGeneration,
      updatedAt: input?.driverUpdatedAt,
    });
  }

  await insertVendorCredential(database, bindings, {
    apiBase: input?.apiBase ?? null,
    vendorId: input?.vendorId ?? "anthropic",
  });

  return { bindings, database };
}

async function dispatch(bindings: ApiBindings, request: Request): Promise<Response> {
  return createDriverRouteTestProject().request(
    request,
    undefined,
    bindings,
    createTestExecutionContext(),
  );
}

describe("driver LLM proxy route", () => {
  test("forwards api-key style requests with the vault credential injected", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages?beta=true", {
        body: JSON.stringify({ model: "claude-sonnet-5" }),
        headers: {
          "anthropic-version": "2024-10-22",
          "content-type": "application/json",
          "x-api-key": grant,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("x-upstream-marker")).toBe("1");
    expect(response.headers.get("transfer-encoding")).toBeNull();

    expect(captured).toHaveLength(1);
    const upstream = captured[0];
    expect(upstream?.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(upstream?.method).toBe("POST");
    expect(upstream?.redirect).toBe("manual");
    expect(upstream?.body).toBe(JSON.stringify({ model: "claude-sonnet-5" }));
    // The grant never leaves the control plane; the vault key does not exist
    // anywhere in the sandbox-visible request.
    expect(upstream?.headers.get("x-api-key")).toBe(UPSTREAM_API_KEY);
    expect(upstream?.headers.get("authorization")).toBeNull();
    // Client-pinned protocol headers win over catalog defaults.
    expect(upstream?.headers.get("anthropic-version")).toBe("2024-10-22");
  });

  test("fills catalog protocol headers when the client omits them", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        body: JSON.stringify({ model: "claude-sonnet-5" }),
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(captured[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
  });

  test("forwards bearer style requests to a custom endpoint", async () => {
    const { bindings } = await setupFixture({
      apiBase: "https://gateway.example.com/v1?api-version=2026-07-01",
      vendorId: "openai",
    });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/responses?stream=true", {
        body: JSON.stringify({ model: "gpt-5.4" }),
        headers: { Authorization: `Bearer ${grant}` },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(captured[0]?.url).toBe(
      "https://gateway.example.com/v1/responses?api-version=2026-07-01&stream=true",
    );
    expect(captured[0]?.headers.get("authorization")).toBe(`Bearer ${UPSTREAM_API_KEY}`);
    expect(captured[0]?.headers.get("x-api-key")).toBeNull();
  });

  test("forwards scoped OpenAI image generations and multipart edits", async () => {
    const { bindings } = await setupFixture({ vendorId: "openai" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      imageModelId: "gpt-image-2",
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });

    const generationResponse = await dispatch(
      bindings,
      llmProxyRequest("/images/generations", {
        body: JSON.stringify({ model: "gpt-image-2", prompt: "Draw a pet." }),
        headers: {
          Authorization: `Bearer ${grant}`,
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    const editBody = new FormData();
    editBody.append("model", "gpt-image-2");
    editBody.append("prompt", "Animate this pet.");
    editBody.append("image", new Blob(["png"], { type: "image/png" }), "pet.png");
    const editResponse = await dispatch(
      bindings,
      llmProxyRequest("/images/edits", {
        body: editBody,
        headers: { Authorization: `Bearer ${grant}` },
        method: "POST",
      }),
    );

    expect(generationResponse.status).toBe(200);
    expect(editResponse.status).toBe(200);
    expect(captured.map((request) => request.url)).toEqual([
      "https://api.openai.com/v1/images/generations",
      "https://api.openai.com/v1/images/edits",
    ]);
    expect(captured[0]?.body).toBe(JSON.stringify({ model: "gpt-image-2", prompt: "Draw a pet." }));
    expect(captured[1]?.headers.get("content-type")).toStartWith("multipart/form-data; boundary=");
    expect(captured[1]?.body).toContain('name="model"');
    expect(captured[1]?.body).toContain("gpt-image-2");
  });

  test("rejects OpenAI image calls outside the scoped model capability", async () => {
    const { bindings } = await setupFixture({ vendorId: "openai" });
    const captured = captureUpstreamFetch();
    const unscopedGrant = await createLlmProxyGrant(bindings, {
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });
    const scopedGrant = await createLlmProxyGrant(bindings, {
      imageModelId: "gpt-image-2",
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });

    const unscopedResponse = await dispatch(
      bindings,
      llmProxyRequest("/images/generations", {
        body: JSON.stringify({ model: "gpt-image-2", prompt: "Draw a pet." }),
        headers: { Authorization: `Bearer ${unscopedGrant}` },
        method: "POST",
      }),
    );
    const wrongModelResponse = await dispatch(
      bindings,
      llmProxyRequest("/images/generations", {
        body: JSON.stringify({ model: "gpt-image-1", prompt: "Draw a pet." }),
        headers: { Authorization: `Bearer ${scopedGrant}` },
        method: "POST",
      }),
    );
    const duplicateModelBody = new FormData();
    duplicateModelBody.append("model", "gpt-image-2");
    duplicateModelBody.append("model", "gpt-image-1");
    duplicateModelBody.append("image", new Blob(["png"], { type: "image/png" }), "pet.png");
    const duplicateModelResponse = await dispatch(
      bindings,
      llmProxyRequest("/images/edits", {
        body: duplicateModelBody,
        headers: { Authorization: `Bearer ${scopedGrant}` },
        method: "POST",
      }),
    );

    expect(unscopedResponse.status).toBe(403);
    expect(wrongModelResponse.status).toBe(403);
    expect(duplicateModelResponse.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("binds native Gemini endpoints to the granted model", async () => {
    const { bindings } = await setupFixture({ vendorId: "opencode" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      modelId: "gemini-3.5-flash",
      modelProtocol: "google-gemini",
    });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/models/gemini-3.5-flash:streamGenerateContent?alt=sse", {
        body: "{}",
        headers: { "x-goog-api-key": grant },
        method: "POST",
      }),
    );
    const otherModelResponse = await dispatch(
      bindings,
      llmProxyRequest("/models/gemini-3.5-pro:streamGenerateContent?alt=sse", {
        body: "{}",
        headers: { "x-goog-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(captured[0]?.url).toBe(
      "https://opencode.ai/zen/v1/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
    );
    expect(captured[0]?.headers.get("authorization")).toBe(`Bearer ${UPSTREAM_API_KEY}`);
    expect(captured[0]?.headers.get("x-goog-api-key")).toBeNull();
    expect(otherModelResponse.status).toBe(403);
    expect(captured).toHaveLength(1);
  });

  test("returns 426 locally for the Codex Responses WebSocket probe", async () => {
    const { bindings } = await setupFixture({ vendorId: "openai" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/responses", {
        headers: {
          Authorization: `Bearer ${grant}`,
          Upgrade: "websocket",
        },
        method: "GET",
      }),
    );

    expect(response.status).toBe(426);
    expect(response.headers.get("upgrade")).toBe("websocket");
    expect(captured).toHaveLength(0);
  });

  test("rejects OpenAI endpoints outside the runtime capability", async () => {
    const { bindings } = await setupFixture({ vendorId: "openai" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });

    const modelListResponse = await dispatch(
      bindings,
      llmProxyRequest("/models", {
        headers: { Authorization: `Bearer ${grant}` },
        method: "GET",
      }),
    );
    const inputTokensResponse = await dispatch(
      bindings,
      llmProxyRequest("/responses/input_tokens", {
        headers: { Authorization: `Bearer ${grant}` },
        method: "POST",
      }),
    );

    expect(modelListResponse.status).toBe(403);
    expect(inputTokensResponse.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("rejects a body model outside the granted capability", async () => {
    const { bindings } = await setupFixture({ vendorId: "openai" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/responses", {
        body: JSON.stringify({ model: "gpt-5.5" }),
        headers: { Authorization: `Bearer ${grant}` },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("canonicalizes an admitted JSON body before forwarding it", async () => {
    const { bindings } = await setupFixture({ vendorId: "openai" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/responses", {
        body: '{"model":"gpt-5.5","model":"gpt-5.4","input":"hello"}',
        headers: { Authorization: `Bearer ${grant}` },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(captured[0]?.body).toBe('{"model":"gpt-5.4","input":"hello"}');
  });

  test("requires a canonical JSON body model for non-Gemini requests", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const missingModelResponse = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        body: "{}",
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );
    const malformedBodyResponse = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        body: "not-json",
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(missingModelResponse.status).toBe(403);
    expect(malformedBodyResponse.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("rejects requests without a grant", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();

    const response = await dispatch(bindings, llmProxyRequest("/v1/messages", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(captured).toHaveLength(0);
  });

  test("does not run global driver maintenance before authenticating the request", async () => {
    const { bindings, database } = await setupFixture();
    await insertDriverInstance(database, "provisioning", {
      bootTokenExpiresAt: Date.now() - 1,
      driverInstanceId: OTHER_DRIVER_INSTANCE_ID,
    });

    const response = await dispatch(bindings, llmProxyRequest("/v1/messages", { method: "POST" }));
    const unrelatedDriver = await database
      .project()
      .select({ status: driverInstancesTable.status })
      .from(driverInstancesTable)
      .where(eq(driverInstancesTable.id, OTHER_DRIVER_INSTANCE_ID))
      .get();

    expect(response.status).toBe(401);
    expect(unrelatedDriver?.status).toBe("provisioning");
  });

  test("rejects malformed grants", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        headers: { "x-api-key": "not-a-real-grant" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(captured).toHaveLength(0);
  });

  test("rejects grants minted for another action", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createRuntimeActionToken(bindings, {
      action: "mcp_proxy",
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
      resourceId: parsePlatformId("01J0000000000000000000000G", "server id"),
    });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        body: JSON.stringify({ model: "claude-sonnet-5" }),
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("rejects grants for a different credential", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, { resourceId: OTHER_CREDENTIAL_ID });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        body: JSON.stringify({ model: "claude-sonnet-5" }),
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("rejects grants once the driver instance is gone", async () => {
    const { bindings } = await setupFixture({ driverStatus: "absent" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("rejects grants for failed driver instances", async () => {
    const { bindings } = await setupFixture({ driverStatus: "failed" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("rejects grants once the scoped driver heartbeat is stale", async () => {
    const { bindings } = await setupFixture({
      driverUpdatedAt: Date.now() - 60_000,
    });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("rejects grants minted for a stale driver generation", async () => {
    const { bindings } = await setupFixture({ driverGeneration: 2 });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, { driverGeneration: 1 });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("rejects grants whose project does not own the credential", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      projectId: parsePlatformId<ProjectId>("01J0000000000000000000000Z", "other project id"),
    });

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        body: JSON.stringify({ model: "claude-sonnet-5" }),
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(captured).toHaveLength(0);
  });

  test("rejects a path normalized across the provider endpoint boundary", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/%2e%2e/internal", {
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test.each(["/v1/%2e%2e%2finternal", "/v1/%2e%2e%5cinternal", "/v1/%252e%252e%252finternal"])(
    "rejects encoded path separators and double encoding: %s",
    async (subPath) => {
      const { bindings } = await setupFixture();
      const captured = captureUpstreamFetch();
      const grant = await createLlmProxyGrant(bindings);

      const response = await dispatch(
        bindings,
        llmProxyRequest(subPath, {
          headers: { "x-api-key": grant },
          method: "POST",
        }),
      );

      expect(response.status).toBe(400);
      expect(captured).toHaveLength(0);
    },
  );

  test.each(["/v1/messages/", "/v1//messages", "/v1/messages/admin", "//messages"])(
    "rejects non-exact provider endpoint paths: %s",
    async (subPath) => {
      const { bindings } = await setupFixture();
      const captured = captureUpstreamFetch();
      const grant = await createLlmProxyGrant(bindings);

      const response = await dispatch(
        bindings,
        llmProxyRequest(subPath, {
          headers: { "x-api-key": grant },
          method: "POST",
        }),
      );

      expect(response.status).toBe(403);
      expect(captured).toHaveLength(0);
    },
  );

  test("rejects methods outside the model inference capability", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        headers: { "x-api-key": grant },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  test("propagates the sandbox request cancellation signal upstream", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);
    const controller = new AbortController();

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        body: JSON.stringify({ model: "claude-sonnet-5" }),
        headers: { "x-api-key": grant },
        method: "POST",
        signal: controller.signal,
      }),
    );
    controller.abort();

    expect(response.status).toBe(200);
    expect(captured[0]?.signal.aborted).toBe(true);
  });

  test("rejects proxied paths with malformed percent encoding", async () => {
    const { bindings } = await setupFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/%zz/messages", {
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(captured).toHaveLength(0);
  });

  test("maps upstream failures to 502", async () => {
    const { bindings } = await setupFixture();
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as typeof fetch;
    const grant = await createLlmProxyGrant(bindings);

    const response = await dispatch(
      bindings,
      llmProxyRequest("/v1/messages", {
        body: JSON.stringify({ model: "claude-sonnet-5" }),
        headers: { "x-api-key": grant },
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "LLM proxy upstream request failed." });
  });
});
