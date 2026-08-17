import { describe, expect, test } from "bun:test";

import {
  findOpenApiBreakingChanges,
  validateOpenApiBreakingChangeApproval,
} from "./public-api-compatibility";

function document(input: {
  requestBodyRequired?: boolean;
  required?: string[];
  status?: string;
  userIdEnum?: string[];
}) {
  return {
    components: {
      schemas: {
        CreateThreadRequest: {
          additionalProperties: false,
          properties: {
            legacy: { type: "string" },
            userId: {
              enum: input.userIdEnum ?? ["customer", "operator"],
              type: "string",
            },
          },
          required: input.required ?? [],
          type: "object",
        },
      },
    },
    paths: {
      "/threads": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateThreadRequest" },
              },
            },
            required: input.requestBodyRequired ?? false,
          },
          responses: {
            [input.status ?? "201"]: {
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
          },
        },
      },
    },
  };
}

describe("public API compatibility", () => {
  test("reports request tightening, field removal, enum narrowing, and response removal", () => {
    const before = document({});
    const after = document({
      requestBodyRequired: true,
      required: ["userId"],
      status: "202",
      userIdEnum: ["customer"],
    });
    delete after.components.schemas.CreateThreadRequest.properties.legacy;

    expect(findOpenApiBreakingChanges(before, after)).toEqual([
      "components.schemas.CreateThreadRequest.properties.legacy was removed",
      'components.schemas.CreateThreadRequest.properties.userId.enum removed "operator"',
      "components.schemas.CreateThreadRequest.required added userId",
      "paths./threads.post.requestBody became required",
      "paths./threads.post.responses removed 201",
    ]);
  });

  test("accepts additive paths, optional fields, enum values, and responses", () => {
    const before = document({});
    const after = document({ userIdEnum: ["customer", "operator", "service"] });
    after.components.schemas.CreateThreadRequest.properties.requestId = { type: "string" };
    after.paths["/health"] = {
      get: { responses: { "200": { content: {} } } },
    };
    after.paths["/threads"].post.responses["400"] = { content: {} };

    expect(findOpenApiBreakingChanges(before, after)).toEqual([]);
  });

  test("reports newly introduced enum, const, and composition constraints", () => {
    const before = document({});
    const beforeUserId = before.components.schemas.CreateThreadRequest.properties.userId as Record<
      string,
      unknown
    >;
    delete beforeUserId["enum"];

    for (const [keyword, value] of [
      ["enum", ["contract-smoke"]],
      ["const", "contract-smoke"],
      ["oneOf", [{ const: "contract-smoke" }]],
    ] as const) {
      const after = structuredClone(before);
      const afterUserId = after.components.schemas.CreateThreadRequest.properties.userId as Record<
        string,
        unknown
      >;
      afterUserId[keyword] = value;

      expect(findOpenApiBreakingChanges(before, after)).toContain(
        `components.schemas.CreateThreadRequest.properties.userId.${keyword} was added`,
      );
    }
  });

  test("requires staged approvals to bind to the base digest and rollout facts", () => {
    const baselineSha256 = "a".repeat(64);

    expect(
      validateOpenApiBreakingChangeApproval(
        {
          baselineSha256,
          change: "components.schemas.CreateThreadRequest.required added userId",
          compatibilityStartedAt: "2026-08-01",
          enforcementDate: "2026-09-01",
          issue: "https://github.com/langgenius/mosoo/issues/532",
          minimumClientVersion: "0.2.0",
        },
        baselineSha256,
      ),
    ).toEqual([]);
  });
});
