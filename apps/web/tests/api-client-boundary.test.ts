import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { createAgentSession } from "../src/domains/session/api/agent-session";
import {
  deleteVendorCredential,
  updateVendorCredential,
} from "../src/domains/vendor-credential/api/vendor-credential-client";
import { requestGraphQL, UnauthorizedError } from "../src/platform/http/graphql-client";
import { apiPath } from "../src/platform/http/public-api";
import { toAppId, toVendorCredentialId } from "../src/routes/typed-id";

const originalFetch = globalThis.fetch;
const AGENT_ID = "01J000000000000000000000C1";
const SESSION_ID = "01J000000000000000000000C3";
const APP_ID = "01J000000000000000000000C4";
const VENDOR_CREDENTIAL_ID = "01J000000000000000000000C5";
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
      appId: APP_ID,
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

  test("keeps draft file uploads App-scoped in the Web client", () => {
    const source = readFileSync(
      new URL("../src/domains/file/api/app-draft-file-client.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("uploadAppDraftFiles");
    expect(source).toContain('purpose: "app_draft"');
    expect(source).toContain('kind: "app_draft"');
    expect(source).toContain("id: appId");
    expect(source).not.toContain("organization_draft");
    expect(source).not.toContain("organizationId");
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

    await createAgentSession(APP_ID, AGENT_ID, "ui");
    await createAgentSession(APP_ID, AGENT_ID, "preview", { waitForRuntimeReady: true });

    expect(capturedBodies).toEqual([
      {
        query: expect.any(String),
        variables: {
          input: {
            agentId: AGENT_ID,
            appId: APP_ID,
            type: "ui",
          },
        },
      },
      {
        query: expect.any(String),
        variables: {
          input: {
            agentId: AGENT_ID,
            appId: APP_ID,
            type: "preview",
            waitForRuntimeReady: true,
          },
        },
      },
    ]);
  });

  test("sends Provider credential update and delete with explicit App scope", async () => {
    const capturedBodies: unknown[] = [];
    const appId = toAppId(APP_ID);
    const credentialId = toVendorCredentialId(VENDOR_CREDENTIAL_ID);

    globalThis.fetch = async (_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected GraphQL request body to be serialized JSON.");
      }

      const body = JSON.parse(init.body);
      capturedBodies.push(body);

      if (
        typeof body === "object" &&
        body !== null &&
        "query" in body &&
        typeof body.query === "string" &&
        body.query.includes("updateVendorCredential")
      ) {
        return Response.json({
          data: {
            updateVendorCredential: {
              apiBase: null,
              id: VENDOR_CREDENTIAL_ID,
              maskedApiKey: "sk-...",
              models: null,
              name: "Updated",
              appId: APP_ID,
              vendorId: "openai",
            },
          },
        });
      }

      return Response.json({
        data: {
          deleteVendorCredential: {
            ok: true,
          },
        },
      });
    };

    await updateVendorCredential({
      id: credentialId,
      name: "Updated",
      appId,
    });
    await deleteVendorCredential({
      id: credentialId,
      appId,
    });

    expect(capturedBodies).toEqual([
      {
        query: expect.any(String),
        variables: {
          input: {
            id: VENDOR_CREDENTIAL_ID,
            name: "Updated",
            appId: APP_ID,
          },
        },
      },
      {
        query: expect.any(String),
        variables: {
          input: {
            id: VENDOR_CREDENTIAL_ID,
            appId: APP_ID,
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
