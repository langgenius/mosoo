import { afterEach, describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { VendorCredentialId } from "@mosoo/id";

import {
  deleteVendorCredential,
  listAvailableAgentModels,
  updateVendorCredential,
} from "../src/domains/vendor-credential/api/vendor-credential-client";
import { requestGraphQL, UnauthorizedError } from "../src/platform/http/graphql-client";
import { apiPath } from "../src/platform/http/public-api";
import { toProjectId } from "../src/routes/typed-id";

const originalFetch = globalThis.fetch;
const PROJECT_ID = "01J000000000000000000000C4";
const VENDOR_CREDENTIAL_ID = "01J000000000000000000000C5";
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
  test("preserves a model protocol mismatch returned by the model catalog", async () => {
    globalThis.fetch = async () =>
      Response.json({
        data: {
          availableAgentModels: [
            {
              available: false,
              displayName: "Custom chat",
              modelId: "custom-chat",
              modelProtocol: "openai-chat-completions",
              reason: "wrong-protocol",
              source: "custom",
              statusDetail: "OpenAI Runtime requires OpenAI Responses.",
              statusLabel: "Protocol not supported",
              vendorId: "openai-compatible",
              vendorLabel: "Custom Provider",
            },
          ],
        },
      });
    const entries = await listAvailableAgentModels({
      projectId: toProjectId(PROJECT_ID),
      runtimeId: "openai-runtime",
    });
    expect(entries[0]).toMatchObject({
      available: false,
      modelProtocol: "openai-chat-completions",
      reason: "wrong-protocol",
      statusLabel: "Protocol not supported",
    });
  });

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

  test("sends Provider credential update and delete with explicit Project scope", async () => {
    const capturedBodies: unknown[] = [];
    const projectId = toProjectId(PROJECT_ID);
    const credentialId = parsePlatformId<VendorCredentialId>(VENDOR_CREDENTIAL_ID);

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
              modelProtocol: null,
              models: null,
              name: "Updated",
              projectId: PROJECT_ID,
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
      projectId,
    });
    await deleteVendorCredential({
      id: credentialId,
      projectId,
    });

    expect(capturedBodies).toEqual([
      {
        query: expect.any(String),
        variables: {
          input: {
            id: VENDOR_CREDENTIAL_ID,
            name: "Updated",
            projectId: PROJECT_ID,
          },
        },
      },
      {
        query: expect.any(String),
        variables: {
          input: {
            id: VENDOR_CREDENTIAL_ID,
            projectId: PROJECT_ID,
          },
        },
      },
    ]);
  });

  test("maps GraphQL auth failures to the shared unauthorized error", async () => {
    globalThis.fetch = async () =>
      Response.json(
        {
          data: null,
          errors: [
            {
              extensions: {
                code: "UNAUTHORIZED",
              },
              message: "Unauthorized.",
            },
          ],
        },
        {
          status: 401,
        },
      );

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
      Response.json(
        {
          errors: [
            {
              extensions: {
                code: "FORBIDDEN",
              },
              message: "You do not have permission to perform this action.",
            },
          ],
        },
        {
          status: 403,
        },
      );

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
