import { afterEach, describe, expect, spyOn, test } from "bun:test";

import {
  createProjectApiKey,
  revokePersonalAccessToken,
} from "../src/modules/auth/application/personal-access-token.service";
import {
  enforcePublicApiRateLimit,
  PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE,
} from "../src/modules/public-api/public-api-rate-limit.service";
import { runWithRequestLogContext } from "../src/platform/cloudflare/logger";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  PUBLIC_API_TEST_IDS,
  TOKENS,
} from "./helpers/public-api-http-test-fixture";
import {
  createPublicEventSessionNamespace,
  createPublicThreadApiTestApp,
  expectRecord,
  expectString,
  OWNER_VIEWER,
  readJson,
} from "./public-thread-api-fixtures";

interface CapturedRequest {
  event: string;
  properties: Record<string, unknown>;
}

const restoreMocks: Array<() => void> = [];

afterEach(() => {
  for (const restore of restoreMocks.splice(0)) restore();
});

async function fixture() {
  const database = await createPublicHttpContractDatabase();
  const key = await createProjectApiKey(database, OWNER_VIEWER, {
    label: "private-key-label",
    projectId: PUBLIC_API_TEST_IDS.project,
  });
  const bindings: ApiBindings = {
    ...(createPublicHttpTestBindings(database) as ApiBindings),
    MOSOO_ENVIRONMENT: "production",
    POSTHOG_API_HOST: "https://us.i.posthog.com",
    POSTHOG_PROJECT_KEY: "phc_test",
  };
  const app = createPublicThreadApiTestApp();
  const pending: Promise<unknown>[] = [];
  const context: ExecutionContext = {
    ...createTestExecutionContext(),
    waitUntil: (promise) => {
      pending.push(promise);
    },
  };
  const captures: CapturedRequest[] = [];
  let respond = async (): Promise<Response> => new Response(null, { status: 200 });
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const capture = expectRecord(JSON.parse(String(init?.body)));
    captures.push({
      event: expectString(capture.event),
      properties: expectRecord(capture.properties),
    });
    return respond();
  });
  restoreMocks.push(() => fetchSpy.mockRestore());

  async function request(path: string, init: RequestInit = {}, token: string | null = key.value) {
    const headers = new Headers(init.headers);
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    const apiRequest = new Request(`https://api.example.com/api${path}`, { ...init, headers });
    return runWithRequestLogContext(apiRequest, () =>
      app.request(apiRequest, undefined, bindings, context),
    );
  }

  return {
    bindings,
    captures,
    database,
    flush: () => Promise.all(pending.splice(0)),
    key,
    request,
    setResponse: (response: () => Promise<Response>) => {
      respond = response;
    },
  };
}

describe("Public API request analytics", () => {
  test.each(["v1", "v2"] as const)(
    "%s captures one successful request using the verified Project key and a route template",
    async (version) => {
      const f = await fixture();
      const response = await f.request(
        `/${version}/agents/${PUBLIC_API_TEST_IDS.agent}/threads?secret=private-query`,
      );
      expect(response.status).toBe(200);
      await f.flush();
      expect(f.captures).toEqual([
        {
          event: "api_request_completed",
          properties: {
            api_key_id: f.key.token.id,
            api_surface: "public_api",
            api_version: version,
            credential_type: "project_key",
            deployment_mode: "cloud",
            distinct_id: OWNER_VIEWER.id,
            environment: "production",
            http_method: "GET",
            idempotency_replayed: false,
            is_internal: false,
            project_id: PUBLIC_API_TEST_IDS.project,
            request_succeeded: true,
            route: `/api/${version}/agents/:agentId/threads`,
            status_code: 200,
          },
        },
      ]);
      const serialized = JSON.stringify(f.captures);
      for (const secret of [
        f.key.value,
        f.key.token.label,
        OWNER_VIEWER.email,
        "private-query",
        PUBLIC_API_TEST_IDS.agent,
      ]) {
        expect(serialized).not.toContain(secret);
      }
    },
  );

  test("keeps rotated keys separate while retaining the same Project", async () => {
    const f = await fixture();
    const replacement = await createProjectApiKey(f.database, OWNER_VIEWER, {
      label: "Replacement",
      projectId: PUBLIC_API_TEST_IDS.project,
    });
    const path = `/v2/agents/${PUBLIC_API_TEST_IDS.agent}/threads`;
    expect((await f.request(path)).status).toBe(200);
    expect((await f.request(path, {}, replacement.value)).status).toBe(200);
    await f.flush();
    expect(f.captures.map(({ properties }) => properties.api_key_id)).toEqual([
      f.key.token.id,
      replacement.token.id,
    ]);
    expect(
      f.captures.every(({ properties }) => properties.project_id === PUBLIC_API_TEST_IDS.project),
    ).toBe(true);
  });

  test("separates CLI credentials without inventing a Project scope", async () => {
    const f = await fixture();
    const response = await f.request(
      `/v2/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
      {},
      TOKENS.owner,
    );
    expect(response.status).toBe(200);
    await f.flush();
    expect(f.captures).toHaveLength(1);
    expect(f.captures[0]?.properties).toMatchObject({
      api_key_id: PUBLIC_API_TEST_IDS.patOwner,
      credential_type: "cli_login",
      distinct_id: OWNER_VIEWER.id,
      request_succeeded: true,
    });
    expect(f.captures[0]?.properties).not.toHaveProperty("project_id");
  });

  test("marks internal API callers without requiring a Web identify event or sending email", async () => {
    const f = await fixture();
    const email = "  API-ONLY@DIFY.AI  ";
    await f.database
      .prepare("UPDATE account SET email = ? WHERE id = ?")
      .bind(email, OWNER_VIEWER.id)
      .run();
    expect(
      (await f.request(`/v2/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {}, TOKENS.owner)).status,
    ).toBe(200);
    await f.flush();
    expect(f.captures).toHaveLength(1);
    expect(f.captures[0]?.properties.is_internal).toBe(true);
    expect(JSON.stringify(f.captures)).not.toContain(email);
  });

  test("excludes anonymous, cookie-only, invalid or revoked keys, docs, OPTIONS and unknown routes", async () => {
    const f = await fixture();
    const path = `/v2/agents/${PUBLIC_API_TEST_IDS.agent}/threads`;
    expect((await f.request(path, {}, null)).status).toBe(401);
    expect(
      (
        await f.request(
          path,
          { headers: { Cookie: "better-auth.session_token=private-cookie" } },
          null,
        )
      ).status,
    ).toBe(401);
    expect((await f.request(path, {}, "msp_invalid")).status).toBe(401);
    expect((await f.request("/v1/openapi.json")).status).toBe(200);
    expect((await f.request("/v2/openapi.json")).status).toBe(200);
    expect((await f.request(path, { method: "OPTIONS" })).status).toBe(404);
    expect((await f.request("/v2/not-a-route")).status).toBe(404);
    expect((await f.request("/graphql", { method: "POST", body: "{}" })).status).toBe(404);
    await revokePersonalAccessToken(f.database, OWNER_VIEWER, f.key.token.id);
    expect((await f.request(path)).status).toBe(401);
    await f.flush();
    expect(f.captures).toEqual([]);
  });

  test("records mapped 400 and cross-Project 404 responses without request content or a forged Project", async () => {
    const f = await fixture();
    const invalid = await f.request(`/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
      method: "POST",
      body: '{"input":"private-prompt"',
    });
    expect(invalid.status).toBe(400);
    const forbidden = await f.request("/v2/projects/01J000000000000000000000Z1/threads", {
      method: "POST",
      body: "{}",
    });
    expect(forbidden.status).toBe(404);
    await f.flush();
    expect(f.captures.map(({ properties }) => properties.status_code)).toEqual([400, 404]);
    expect(f.captures.every(({ properties }) => properties.request_succeeded === false)).toBe(true);
    expect(
      f.captures.every(({ properties }) => properties.project_id === PUBLIC_API_TEST_IDS.project),
    ).toBe(true);
    expect(JSON.stringify(f.captures)).not.toContain("private-prompt");
    expect(JSON.stringify(f.captures)).not.toContain("01J000000000000000000000Z1");
  });

  test("records a rate-limited request as unsuccessful", async () => {
    const f = await fixture();
    for (let i = 0; i < PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE; i++) {
      await enforcePublicApiRateLimit(f.database, PUBLIC_API_TEST_IDS.project);
    }
    const response = await f.request(`/v2/agents/${PUBLIC_API_TEST_IDS.agent}/threads`);
    expect(response.status).toBe(429);
    await f.flush();
    expect(f.captures).toHaveLength(1);
    expect(f.captures[0]?.properties).toMatchObject({
      request_succeeded: false,
      status_code: 429,
    });
  });

  test("captures server errors after authentication without leaking the error", async () => {
    const f = await fixture();
    const prepare = f.database.prepare.bind(f.database);
    const prepareSpy = spyOn(f.database, "prepare").mockImplementation((query) => {
      if (query.includes('from "session"')) throw new Error("private-database-error");
      return prepare(query);
    });
    restoreMocks.push(() => prepareSpy.mockRestore());
    const response = await f.request(`/v2/threads/${PUBLIC_API_TEST_IDS.ownerSession}`);
    expect(response.status).toBe(500);
    await f.flush();
    expect(f.captures).toHaveLength(1);
    expect(f.captures[0]?.properties).toMatchObject({
      request_succeeded: false,
      status_code: 500,
    });
    expect(JSON.stringify(f.captures)).not.toContain("private-database-error");
  });

  test("counts each HTTP retry once and marks an idempotent replay", async () => {
    const f = await fixture();
    const path = `/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`;
    const init = {
      body: JSON.stringify({ userId: "private-end-user" }),
      headers: { "Idempotency-Key": "private-retry-key" },
      method: "POST",
    };
    const created = await f.request(path, init);
    const replayed = await f.request(path, init);
    expect(created.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await created.json()).toEqual(await replayed.json());
    await f.flush();
    expect(f.captures).toHaveLength(2);
    expect(f.captures.map(({ properties }) => properties.idempotency_replayed)).toEqual([
      false,
      true,
    ]);
    expect(JSON.stringify(f.captures)).not.toContain("private-end-user");
    expect(JSON.stringify(f.captures)).not.toContain("private-retry-key");
  });

  test("captures an SSE connection once while its stream is still open", async () => {
    const f = await fixture();
    const created = await f.request(`/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
      body: JSON.stringify({ userId: "private-end-user" }),
      method: "POST",
    });
    expect(created.status).toBe(201);
    const threadId = expectString(expectRecord((await readJson(created)).thread).id);
    await f.flush();
    f.captures.splice(0);
    const liveEvents = createPublicEventSessionNamespace();
    f.bindings.Session = liveEvents.binding;
    const abort = new AbortController();
    try {
      const response = await f.request(`/v1/threads/${threadId}/events/stream`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
      await f.flush();
      expect(f.captures).toHaveLength(1);
      expect(f.captures[0]?.properties.route).toBe("/api/v1/threads/:threadId/events/stream");
      await response.body?.cancel();
      expect(f.captures).toHaveLength(1);
    } finally {
      abort.abort();
      liveEvents.close();
    }
  });

  test("returns the API response before capture completes and ignores a failed capture", async () => {
    const f = await fixture();
    let failCapture: (reason: Error) => void = () => {};
    f.setResponse(
      () =>
        new Promise<Response>((_resolve, reject) => {
          failCapture = reject;
        }),
    );
    const response = await f.request(`/v2/agents/${PUBLIC_API_TEST_IDS.agent}/threads`);
    expect(response.status).toBe(200);
    expect(f.captures).toHaveLength(1);
    failCapture(new Error("PostHog unavailable"));
    await expect(f.flush()).resolves.toHaveLength(1);
    expect(response.status).toBe(200);
  });

  test("is a no-op without execution context when PostHog is disabled", async () => {
    const f = await fixture();
    delete f.bindings.POSTHOG_PROJECT_KEY;
    const request = new Request(
      `https://api.example.com/api/v2/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
      { headers: { Authorization: `Bearer ${f.key.value}` } },
    );
    const app = createPublicThreadApiTestApp();
    const response = await runWithRequestLogContext(request, () =>
      app.request(request, undefined, f.bindings),
    );
    expect(response.status).toBe(200);
    await f.flush();
    expect(f.captures).toEqual([]);
  });
});
