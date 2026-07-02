import { describe, expect, test } from "bun:test";

import { PUBLIC_THREAD_JSON_BODY_MAX_BYTES } from "@mosoo/contracts/public-api";

import { readBoundAgentCallRequestBody } from "../src/adapters/http/routes/public-thread-api-request";
import { PublicApiError } from "../src/modules/public-api/public-api-errors";

function contextFor(request: Request): { req: { raw: Request } } {
  return { req: { raw: request } };
}

describe("readBoundAgentCallRequestBody", () => {
  test("rejects a body whose Content-Length exceeds the public-API cap", async () => {
    const request = new Request("https://api.test/api/v1/bound/token", {
      body: '{"message":"hi"}',
      headers: { "content-length": String(PUBLIC_THREAD_JSON_BODY_MAX_BYTES + 1) },
      method: "POST",
    });

    await expect(readBoundAgentCallRequestBody(contextFor(request))).rejects.toBeInstanceOf(
      PublicApiError,
    );
  });

  test("parses a well-formed body within the cap", async () => {
    const request = new Request("https://api.test/api/v1/bound/token", {
      body: JSON.stringify({ message: "hello" }),
      method: "POST",
    });

    await expect(readBoundAgentCallRequestBody(contextFor(request))).resolves.toEqual({
      message: "hello",
    });
  });
});
