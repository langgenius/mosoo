import { describe, expect, test } from "bun:test";

import {
  assertCreateThreadContract,
  assertNonProductionBaseUrl,
} from "./public-api-nonproduction-smoke";

function createDocument() {
  return {
    components: {
      schemas: {
        CreateThreadRequest: {
          additionalProperties: false,
          properties: {
            input: { type: "object" },
            resources: { type: "array" },
            userId: { type: "string" },
          },
          required: ["userId"],
          type: "object",
        },
      },
    },
    paths: {
      "/agents/{agentId}/threads": {
        post: { requestBody: { required: true } },
      },
    },
  };
}

describe("Public API non-production smoke", () => {
  test("normalizes a deployed non-production API URL", () => {
    expect(assertNonProductionBaseUrl("https://staging.example.com/api/v1/").href).toBe(
      "https://staging.example.com/api/v1",
    );
  });

  test("refuses every Mosoo production host", () => {
    for (const host of ["cloud.mosoo.ai", "mosoo.ai", "try.mosoo.ai"]) {
      expect(() => assertNonProductionBaseUrl(`https://${host}/api/v1`)).toThrow(
        "Refusing to run Public API smoke against production host",
      );
    }
  });

  test("accepts only the exact documented create Thread contract", () => {
    expect(() => assertCreateThreadContract(createDocument())).not.toThrow();

    const staleDocument = createDocument();
    staleDocument.components.schemas.CreateThreadRequest.required = [];
    expect(() => assertCreateThreadContract(staleDocument)).toThrow("must require exactly userId");
  });
});
