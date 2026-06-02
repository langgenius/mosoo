import { afterEach, describe, expect, test } from "bun:test";

import { createAgentSession } from "../src/domains/session/api/agent-session";
import { requestGraphQL, UnauthorizedError } from "../src/platform/http/graphql-client";
import { apiPath } from "../src/platform/http/public-api";

const originalFetch = globalThis.fetch;
const AGENT_ID = "01J000000000000000000000C1";
const ORGANIZATION_ID = "01J000000000000000000000C2";
const SESSION_ID = "01J000000000000000000000C3";
const createSessionResponse = {
  data: {
    createAgentSession: {
      agentId: AGENT_ID,
      archivedAt: null,
      createdAt: "2026-05-27T00:00:00.000Z",
      deploymentVersionId: null,
      deploymentVersionNumber: null,
      id: SESSION_ID,
      kind: "pet",
      lastMessageAt: null,
      lastRun: null,
      model: "gpt-5.4",
      organizationId: ORGANIZATION_ID,
      provider: "openai",
      runtimeId: "openai-runtime",
      status: "IDLE",
      title: null,
      type: "preview",
      updatedAt: "2026-05-27T00:00:00.000Z",
    },
  },
};
const testQuery = {
  toString() {
    return "mutation Test($input: TestInput!) { test(input: $input) { ok } }";
  },
};

function requireRequestBody(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected GraphQL request body to be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("web API client boundary", () => {
  test("targets the same-origin API prefix", () => {
    expect(apiPath("/graphql")).toBe("/api/graphql");
    expect(apiPath("/v1/openapi.json")).toBe("/api/v1/openapi.json");
  });

  test("sends typed GraphQL operations through the public API route", async () => {
    let capturedInput: RequestInfo | URL | null = null;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return Response.json({
        data: {
          ok: true,
        },
      });
    };

    await expect(
      requestGraphQL(testQuery, {
        input: {
          id: "agent-1",
        },
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(capturedInput).toBe("/api/graphql");
    expect(capturedInit?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(capturedInit?.method).toBe("POST");
    if (typeof capturedInit?.body !== "string") {
      throw new Error("Expected GraphQL request body to be serialized JSON.");
    }
    expect(requireRequestBody(capturedInit.body)).toEqual({
      query: expect.any(String),
      variables: {
        input: {
          id: "agent-1",
        },
      },
    });
  });

  test("omits runtime warmup waits unless create session callers explicitly opt in", async () => {
    const capturedBodies: unknown[] = [];

    globalThis.fetch = async (_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected GraphQL request body to be serialized JSON.");
      }

      capturedBodies.push(JSON.parse(init.body));
      return Response.json(createSessionResponse);
    };

    await createAgentSession(AGENT_ID, "ui");
    await createAgentSession(AGENT_ID, "preview", { waitForRuntimeReady: true });

    expect(capturedBodies).toEqual([
      {
        query: expect.any(String),
        variables: {
          input: {
            agentId: AGENT_ID,
            type: "ui",
          },
        },
      },
      {
        query: expect.any(String),
        variables: {
          input: {
            agentId: AGENT_ID,
            type: "preview",
            waitForRuntimeReady: true,
          },
        },
      },
    ]);
  });

  test("maps GraphQL auth failures to the shared unauthorized error", async () => {
    globalThis.fetch = async () =>
      Response.json({
        data: null,
        errors: [
          {
            extensions: {
              code: "UNAUTHENTICATED",
            },
            message: "Sign in required.",
          },
        ],
      });

    await expect(
      requestGraphQL(testQuery, {
        input: {
          id: "agent-1",
        },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("maps GraphQL authorization and HTTP errors to user-facing messages", async () => {
    globalThis.fetch = async () =>
      Response.json({
        errors: [
          {
            extensions: {
              code: "FORBIDDEN",
            },
            message: "Forbidden.",
          },
        ],
      });

    await expect(
      requestGraphQL(testQuery, {
        input: {
          id: "agent-1",
        },
      }),
    ).rejects.toThrow("You do not have permission to perform this action.");

    globalThis.fetch = async () =>
      Response.json(
        {
          errors: [
            {
              message: "Gateway rejected the operation.",
            },
          ],
        },
        {
          status: 502,
        },
      );

    await expect(
      requestGraphQL(testQuery, {
        input: {
          id: "agent-1",
        },
      }),
    ).rejects.toThrow("Gateway rejected the operation.");
  });

  test("fails fast when a successful GraphQL response omits data", async () => {
    globalThis.fetch = async () => Response.json({});

    await expect(
      requestGraphQL(testQuery, {
        input: {
          id: "agent-1",
        },
      }),
    ).rejects.toThrow("The GraphQL response did not include data.");
  });
});
