import { describe, expect, it, spyOn } from "bun:test";

import { createGraphQLGateway } from "../src/adapters/graphql/create-graphql-gateway";
import {
  createPersonalAccessToken,
  createProjectApiKey,
} from "../src/modules/auth/application/personal-access-token.service";
import { createApiTestFixture } from "./helpers/api-test-fixture";

interface CapturedEvent {
  event: string;
  properties: Record<string, unknown>;
}

async function recordCaptures<T>(
  run: () => Promise<T>,
  respond: () => Promise<Response> = async () => new Response(null, { status: 200 }),
): Promise<{ events: CapturedEvent[]; result: T }> {
  const events: CapturedEvent[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    events.push(JSON.parse(String(init?.body)) as CapturedEvent);
    return respond();
  });
  try {
    return { events, result: await run() };
  } finally {
    fetchSpy.mockRestore();
  }
}

async function fixture() {
  const api = await createApiTestFixture();
  const bindings = {
    ...api.bindings,
    MOSOO_ENVIRONMENT: "development" as const,
    POSTHOG_API_HOST: "https://us.i.posthog.com",
    POSTHOG_PROJECT_KEY: "phc_test",
  };
  const key = await createProjectApiKey(api.database, api.viewer, {
    label: "Private project key label",
    projectId: api.ids.projectId,
  });
  const cli = await createPersonalAccessToken(api.database, api.viewer, {
    label: "Private CLI token label",
  });
  const pending: Promise<unknown>[] = [];
  const gateway = createGraphQLGateway();

  async function request(
    query: string,
    options: {
      headers?: HeadersInit;
      token?: string | null;
      variables?: Record<string, unknown>;
    } = {},
  ) {
    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");
    headers.set("content-type", "application/json");
    const token = options.token === undefined ? key.value : options.token;
    if (token !== null) {
      headers.set("authorization", `Bearer ${token}`);
    }
    return gateway.fetch(
      new Request("http://localhost:5173/api/graphql?private=do-not-record", {
        body: JSON.stringify({ query, variables: options.variables }),
        headers,
        method: "POST",
      }),
      { bindings, executionContext: { waitUntil: (promise) => pending.push(promise) } },
    );
  }

  return { ...api, bindings, cli, key, pending, request };
}

describe("GraphQL API activity analytics", () => {
  it("records one event per authenticated HTTP request with only safe token metadata", async () => {
    const f = await fixture();
    const { events, result } = await recordCaptures(async () => {
      const response = await f.request(
        "query PrivateOperation { first: __typename second: __typename }",
      );
      await Promise.all(f.pending);
      return response;
    });

    expect(result.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "api_request_completed",
      properties: {
        api_key_id: f.key.token.id,
        api_surface: "graphql",
        credential_type: "project_key",
        deployment_mode: "cloud",
        distinct_id: f.viewer.id,
        environment: "development",
        graphql_error_count: 0,
        http_method: "POST",
        is_internal: false,
        project_id: f.ids.projectId,
        request_succeeded: true,
        route: "/api/graphql",
        status_code: 200,
      },
    });
    expect(Object.keys(events[0]?.properties ?? {}).toSorted()).toEqual(
      [
        "api_key_id",
        "api_surface",
        "credential_type",
        "deployment_mode",
        "distinct_id",
        "environment",
        "graphql_error_count",
        "http_method",
        "is_internal",
        "project_id",
        "request_succeeded",
        "route",
        "status_code",
      ].toSorted(),
    );
    for (const secret of [
      f.key.value,
      f.viewer.email,
      f.viewer.name,
      "PrivateOperation",
      "do-not-record",
    ])
      expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("keeps simultaneous CLI login and Project key activity separate", async () => {
    const f = await fixture();
    const { events } = await recordCaptures(async () => {
      await Promise.all([
        f.request("{ __typename }"),
        f.request("{ __typename }", { token: f.cli.value }),
      ]);
      await Promise.all(f.pending);
    });

    expect(events).toHaveLength(2);
    expect(
      events.find((event) => event.properties["api_key_id"] === f.key.token.id)?.properties,
    ).toMatchObject({ credential_type: "project_key", project_id: f.ids.projectId });
    const cliProperties = events.find(
      (event) => event.properties["api_key_id"] === f.cli.token.id,
    )?.properties;
    expect(cliProperties).toMatchObject({ credential_type: "cli_login", distinct_id: f.viewer.id });
    expect(cliProperties).not.toHaveProperty("project_id");
  });

  it("does not label GraphQL errors in HTTP 200 responses as successful usage", async () => {
    const f = await fixture();
    const { events, result } = await recordCaptures(async () => {
      const response = await f.request(
        "query PrivateOperation($id: ULID!) { accessibleAgentList(projectId: $id) { id } }",
        { variables: { id: "sensitive-variable-value" } },
      );
      await Promise.all(f.pending);
      return response;
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toHaveProperty("errors");
    expect(events).toHaveLength(1);
    expect(events[0]?.properties).toMatchObject({
      graphql_error_count: 1,
      request_succeeded: false,
      status_code: 200,
    });
    expect(JSON.stringify(events)).not.toContain("sensitive-variable-value");
    expect(JSON.stringify(events)).not.toContain("PrivateOperation");
  });

  it("excludes unauthenticated requests and invalid GraphQL before authentication", async () => {
    const f = await fixture();
    const { events } = await recordCaptures(async () => {
      await f.request("{ __typename }", { token: null });
      await f.request("{ __typename }", { token: "msp_invalid" });
      await f.request("not a graphql document");
      await Promise.all(f.pending);
    });
    expect(events).toHaveLength(0);
  });

  it("excludes Web sessions even when a bearer token accompanies the cookie", async () => {
    const f = await fixture();
    await f.client.loginAsMosooAiTestAccount();
    const { events, result } = await recordCaptures(async () => {
      const response = await f.request("{ __typename }", { headers: f.client.sessionHeaders() });
      await Promise.all(f.pending);
      return response;
    });
    expect(result.status).toBe(200);
    expect(events).toHaveLength(0);
  });

  it("preserves the response when PostHog capture fails", async () => {
    const f = await fixture();
    const { events, result } = await recordCaptures(
      async () => {
        const response = await f.request("{ __typename }");
        await Promise.all(f.pending);
        return response;
      },
      async () => {
        throw new Error("PostHog unavailable");
      },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ data: { __typename: "Query" } });
    expect(events).toHaveLength(1);
    expect(f.pending).toHaveLength(1);
  });

  it("returns the GraphQL response before PostHog capture finishes", async () => {
    const f = await fixture();
    const capture = Promise.withResolvers<Response>();
    await recordCaptures(
      async () => {
        try {
          const response = await f.request("{ __typename }");
          expect(response.status).toBe(200);
          expect(f.pending).toHaveLength(1);
        } finally {
          capture.resolve(new Response(null, { status: 200 }));
          await Promise.all(f.pending);
        }
      },
      () => capture.promise,
    );
  });

  it("marks internal CLI users without sending their email or relying on Web identify", async () => {
    const f = await fixture();
    await f.database
      .prepare("UPDATE account SET email = ? WHERE id = ?")
      .bind("internal@DIFY.AI", f.viewer.id)
      .run();
    const { events } = await recordCaptures(async () => {
      await f.request("{ __typename }", { token: f.cli.value });
      await Promise.all(f.pending);
    });
    expect(events[0]?.properties).toMatchObject({
      credential_type: "cli_login",
      is_internal: true,
    });
    expect(JSON.stringify(events)).not.toContain("internal@DIFY.AI");
  });
});
