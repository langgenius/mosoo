import { afterEach, describe, expect, spyOn, test } from "bun:test";

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
import { runWithRequestLogContext } from "../src/platform/cloudflare/logger";
import type { ApiBindings, ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  insertOwnerSession,
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

function createDriverRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  registerDriverRoute(app);
  return app;
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
    .app()
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
    .app()
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
  return createDriverRouteTestApp().request(
    request,
    undefined,
    bindings,
    createTestExecutionContext(),
  );
}

async function setupBudgetFixture(vendorId = "anthropic", cap = 10000) {
  const { bindings, database } = await setupFixture({ vendorId });
  Object.assign(bindings, { MOSOO_TURN_BUDGET_POLICY: '{"defaultUsd":0.01,"maxUsd":1}' });
  await insertOwnerSession(database);
  const runId = PUBLIC_API_TEST_IDS.run;
  database.execute(`  INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, driver_instance_id,
    trigger, status, provider, model, runtime_id, created_at, updated_at)
  VALUES ('${runId}', '${PUBLIC_API_TEST_IDS.ownerSession}', '${PUBLIC_API_TEST_IDS.agent}',
    '${PUBLIC_API_TEST_IDS.ownerAccount}', '${DRIVER_INSTANCE_ID}', 'user_prompt', 'running',
    'anthropic', 'claude-sonnet-5', 'claude-agent-sdk', 1789732800000, 1789732800000);
  INSERT INTO session_run_budget (session_run_id, cap_usd_micros, created_at, updated_at)
  VALUES ('${runId}', ${cap}, 1789732800000, 1789732800000);`);
  return { bindings, database };
}

describe("driver LLM proxy route", () => {
  test("does not mistake free token counting for missing model usage", async () => {
    const { bindings, database } = await setupBudgetFixture();
    const grant = await createLlmProxyGrant(bindings);
    let calls = 0;
    const captured = captureUpstreamFetch(() =>
      Response.json(
        ++calls === 1 ? { input_tokens: 1000 } : { usage: { input_tokens: 1, output_tokens: 1 } },
      ),
    );
    const request = (path: string) =>
      llmProxyRequest(path, {
        method: "POST",
        headers: { "x-api-key": grant },
        body: '{"model":"claude-sonnet-5"}',
      });
    expect(await (await dispatch(bindings, request("/v1/messages/count_tokens"))).json()).toEqual({
      input_tokens: 1000,
    });
    expect(
      await database
        .prepare(
          "SELECT estimated_cost_usd_micros, active_request_id, blocked_reason FROM session_run_budget",
        )
        .first(),
    ).toEqual({ estimated_cost_usd_micros: 0, active_request_id: null, blocked_reason: null });
    expect((await dispatch(bindings, request("/messages"))).status).toBe(200);
    expect(captured).toHaveLength(2);
  });

  test("keeps a concurrent request from spending until prior usage settles", async () => {
    const { bindings } = await setupBudgetFixture();
    let finish: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":0}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":1}}\n\ndata: {"type":"message_stop"}\n\n',
            ),
          );
          controller.close();
        };
      },
    });
    const captured = captureUpstreamFetch(
      () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    );
    const grant = await createLlmProxyGrant(bindings);
    const request = () =>
      llmProxyRequest("/messages", {
        method: "POST",
        headers: { "x-api-key": grant },
        body: '{"model":"claude-sonnet-5"}',
      });
    const first = await dispatch(bindings, request());
    const pending = await dispatch(bindings, request());
    expect(pending.status).toBe(429);
    expect(pending.headers.get("Retry-After")).toBe("1");
    expect(await pending.json()).toMatchObject({ code: "budget_request_in_flight" });
    expect(captured).toHaveLength(1);
    finish?.();
    await first.text();
  });

  test("fails closed when the client cancels before usage can be established", async () => {
    const { bindings } = await setupBudgetFixture();
    const captured = captureUpstreamFetch(
      () =>
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { "Content-Type": "text/event-stream" },
        }),
    );
    const grant = await createLlmProxyGrant(bindings);
    const request = () =>
      llmProxyRequest("/messages", {
        method: "POST",
        headers: { "x-api-key": grant },
        body: '{"model":"claude-sonnet-5"}',
      });
    const first = await dispatch(bindings, request());
    await first.body?.cancel("caller cancelled");
    const denied = await dispatch(bindings, request());
    expect(denied.status).toBe(402);
    expect(await denied.json()).toMatchObject({ code: "budget_usage_unavailable" });
    expect(captured).toHaveLength(1);
  });

  test("cannot spend using a budgeted grant after the run ends and policy is removed", async () => {
    const { bindings, database } = await setupBudgetFixture();
    database.execute("UPDATE session_run SET status = 'completed'");
    delete bindings.MOSOO_TURN_BUDGET_POLICY;
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings);
    const denied = await dispatch(
      bindings,
      llmProxyRequest("/messages", {
        method: "POST",
        headers: { "x-api-key": grant },
        body: '{"model":"claude-sonnet-5"}',
      }),
    );
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ code: "budget_run_unavailable" });
    expect(captured).toHaveLength(0);
  });

  test("accounts for OpenAI terminal usage split across transport chunks", async () => {
    const { bindings } = await setupBudgetFixture("openai", 1);
    const stream =
      'event: response.completed\r\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1000,"output_tokens":100,"input_tokens_details":{"cached_tokens":200}}}}\r\n\r\n';
    const captured = captureUpstreamFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const bytes = new TextEncoder().encode(stream);
              for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const grant = await createLlmProxyGrant(bindings, {
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });
    const request = () =>
      llmProxyRequest("/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${grant}`, "Content-Type": "application/json" },
        body: '{"model":"gpt-5.4","input":"test","stream":true}',
      });
    const first = await dispatch(bindings, request());
    expect(await first.text()).toBe(stream);
    expect((await dispatch(bindings, request())).status).toBe(402);
    expect(captured).toHaveLength(1);
  });

  test.each([false, true])(
    "does not spend an OpenAI cache write twice: streaming=%s",
    async (streaming) => {
      const { bindings, database } = await setupBudgetFixture("openai", 500);
      const usage = {
        input_tokens: 1000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 100, cache_write_tokens: 800 },
      };
      const captured = captureUpstreamFetch(() =>
        streaming
          ? new Response(
              `data: ${JSON.stringify({ type: "response.completed", response: { usage } })}\n\n`,
              { headers: { "Content-Type": "text/event-stream" } },
            )
          : Response.json({ usage }),
      );
      const grant = await createLlmProxyGrant(bindings, {
        modelId: "gpt-5.6-luna",
        modelProtocol: "openai-responses",
      });
      const request = () =>
        llmProxyRequest("/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${grant}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-5.6-luna", input: "test", stream: streaming }),
        });
      for (let call = 0; call < 2; call++) {
        const response = await dispatch(bindings, request());
        expect(response.status).toBe(200);
        await response.text();
      }
      const budget = await database
        .prepare("SELECT estimated_cost_usd_micros,active_request_id FROM session_run_budget")
        .first();
      expect(budget).toMatchObject({ estimated_cost_usd_micros: 684, active_request_id: null });
      expect((await dispatch(bindings, request())).status).toBe(402);
      expect(captured).toHaveLength(2);
    },
  );

  test("rejects inconsistent OpenAI cache buckets as unavailable usage", async () => {
    const { bindings } = await setupBudgetFixture("openai");
    const captured = captureUpstreamFetch(() =>
      Response.json({
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          input_tokens_details: { cached_tokens: 800, cache_write_tokens: 300 },
        },
      }),
    );
    const grant = await createLlmProxyGrant(bindings, {
      modelId: "gpt-5.6-luna",
      modelProtocol: "openai-responses",
    });
    const request = () =>
      llmProxyRequest("/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${grant}`, "Content-Type": "application/json" },
        body: '{"model":"gpt-5.6-luna","input":"test"}',
      });
    await (await dispatch(bindings, request())).text();
    const denied = await dispatch(bindings, request());
    expect(denied.status).toBe(402);
    expect(await denied.json()).toMatchObject({ code: "budget_usage_unavailable" });
    expect(captured).toHaveLength(1);
  });

  test("fails closed on truncated usage instead of treating it as zero cost", async () => {
    const { bindings } = await setupBudgetFixture();
    const captured = captureUpstreamFetch(
      () =>
        new Response(
          'data: {"type":"message_start","message":{"usage":{"input_tokens":1000,"output_tokens":0}}}\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const grant = await createLlmProxyGrant(bindings);
    const request = () =>
      llmProxyRequest("/messages", {
        method: "POST",
        headers: { "x-api-key": grant },
        body: '{"model":"claude-sonnet-5"}',
      });
    await (await dispatch(bindings, request())).text();
    const denied = await dispatch(bindings, request());
    expect(denied.status).toBe(402);
    expect(await denied.json()).toMatchObject({ code: "budget_usage_unavailable" });
    expect(captured).toHaveLength(1);
  });

  test("rejects a model without a price estimate before spending against a budget", async () => {
    const { bindings } = await setupBudgetFixture();
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, { modelId: "unpriced-test-model" });
    const result = await dispatch(
      bindings,
      llmProxyRequest("/messages", {
        method: "POST",
        headers: { "x-api-key": grant },
        body: '{"model":"unpriced-test-model"}',
      }),
    );
    expect(result.status).toBe(402);
    expect(captured).toHaveLength(0);
  });
  test.each([false, true])(
    "stops new requests after exhaustion even when policy is removed: %s",
    async (removePolicy) => {
      const { bindings } = await setupBudgetFixture();
      const stream = [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1000,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":1000}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join("");
      const captured = captureUpstreamFetch(
        () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
      );
      const grant = await createLlmProxyGrant(bindings);
      const request = () =>
        llmProxyRequest("/messages", {
          method: "POST",
          headers: { "x-api-key": grant, "content-type": "application/json" },
          body: '{"model":"claude-sonnet-5","max_tokens":1000,"stream":true,"messages":[{"role":"user","content":"test"}]}',
        });
      const first = await dispatch(bindings, request());
      expect(first.status).toBe(200);
      expect(await first.text()).toBe(stream);
      if (removePolicy) delete bindings.MOSOO_TURN_BUDGET_POLICY;
      const second = await dispatch(bindings, request());
      expect(second.status).toBe(402);
      expect(await second.json()).toMatchObject({ code: "budget_exhausted" });
      expect(captured).toHaveLength(1);
    },
  );
  test.each([
    { method: "DELETE", path: "/chat/completions", reason: "method_not_allowed" },
    { path: "/responses", reason: "path_not_allowed" },
    { path: "/private-path-content", reason: "path_not_allowed" },
    { body: "private-invalid-json", reason: "body_invalid_json" },
    { body: "[]", reason: "body_invalid_shape" },
    { body: '{"prompt":"private-prompt"}', reason: "body_model_missing" },
    { body: '{"model":null}', reason: "body_model_invalid" },
    {
      body: '{"model":"private-model-content","messages":[{"role":"user","content":"private-prompt"}]}',
      reason: "body_model_mismatch",
    },
  ])(
    "logs sanitized, trace-correlated rejection: $reason",
    async ({ body, method, path, reason }) => {
      const { bindings } = await setupFixture({ vendorId: "openai-compatible" });
      const captured = captureUpstreamFetch();
      const grant = await createLlmProxyGrant(bindings, {
        modelId: "deepseek/deepseek-v4-flash",
        modelProtocol: "openai-chat-completions",
      });
      const request = llmProxyRequest(
        `${path ?? "/chat/completions"}?private_query=private-query-content`,
        {
          ...(method === "DELETE"
            ? {}
            : { body: body ?? '{"model":"deepseek/deepseek-v4-flash"}' }),
          headers: {
            Authorization: `Bearer ${grant}`,
            "content-type": "application/json",
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
            "x-request-id": "proxy-rejection-test",
          },
          method: method ?? "POST",
        },
      );
      const warning = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const response = await runWithRequestLogContext(request, () => dispatch(bindings, request));

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: "LLM proxy request is outside the granted model capability.",
        });
        expect(captured).toHaveLength(0);
        expect(warning).toHaveBeenCalledTimes(1);
        const serializedLog = String(warning.mock.calls[0]?.[0]);
        const entry = JSON.parse(serializedLog);
        expect(entry).toMatchObject({
          message: "runtime.llm_proxy.capability_rejected",
          context: {
            traceId: "0123456789abcdef0123456789abcdef",
            requestId: "proxy-rejection-test",
          },
        });
        expect(entry.metadata).toEqual({
          credentialId: CREDENTIAL_ID,
          driverGeneration: 0,
          driverInstanceId: DRIVER_INSTANCE_ID,
          modelProtocol: "openai-chat-completions",
          projectId: PROJECT_ID,
          reason,
        });
        for (const sensitiveValue of [
          grant,
          UPSTREAM_API_KEY,
          "private-",
          "deepseek/deepseek-v4-flash",
        ]) {
          expect(serializedLog).not.toContain(sensitiveValue);
        }
      } finally {
        warning.mockRestore();
      }
    },
  );

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

  test.each([
    { models: [], reason: "body_model_missing" },
    { models: ["gpt-image-2", "gpt-image-2"], reason: "body_model_ambiguous" },
    { models: [new Blob(["private-model-content"])], reason: "body_model_invalid" },
    { models: ["private-model-content"], reason: "body_model_mismatch" },
    { models: [], malformed: true, reason: "body_invalid_multipart" },
  ])("diagnoses rejected multipart edits: $reason", async ({ models, malformed, reason }) => {
    const { bindings } = await setupFixture({ vendorId: "openai" });
    const captured = captureUpstreamFetch();
    const grant = await createLlmProxyGrant(bindings, {
      imageModelId: "gpt-image-2",
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });
    const body = new FormData();
    for (const model of models) body.append("model", model);
    body.append("prompt", "private-prompt");
    body.append("image", new Blob(["private-image-content"]), "private-image-name.png");
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await dispatch(
        bindings,
        llmProxyRequest("/images/edits", {
          body: malformed ? "private-invalid-multipart" : body,
          headers: {
            Authorization: `Bearer ${grant}`,
            ...(malformed ? { "content-type": "multipart/form-data; boundary=missing" } : {}),
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(403);
      expect(captured).toHaveLength(0);
      expect(warning).toHaveBeenCalledTimes(1);
      const serializedLog = String(warning.mock.calls[0]?.[0]);
      expect(JSON.parse(serializedLog)).toMatchObject({
        message: "runtime.llm_proxy.capability_rejected",
        metadata: { modelProtocol: "openai-responses", reason },
      });
      expect(serializedLog).not.toContain("private-");
      expect(serializedLog).not.toContain(grant);
    } finally {
      warning.mockRestore();
    }
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
      .app()
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
