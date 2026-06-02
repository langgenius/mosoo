import { PUBLISHED_AGENT_OPENAPI_SCHEMAS } from "@mosoo/contracts/public-api";

function jsonResponse(description: string, schema: Record<string, unknown>) {
  return {
    content: {
      "application/json": {
        schema,
      },
    },
    description,
  };
}

export function createPublishedAgentOpenApiComponents() {
  return {
    responses: {
      Conflict: jsonResponse(
        "The Agent/session state rejects this action, or an Idempotency-Key is already processing or was reused for a different request.",
        {
          $ref: "#/components/schemas/ErrorResponse",
        },
      ),
      Forbidden: jsonResponse("The caller cannot consume this Agent.", {
        $ref: "#/components/schemas/ErrorResponse",
      }),
      InternalError: jsonResponse("The request failed unexpectedly.", {
        $ref: "#/components/schemas/ErrorResponse",
      }),
      InvalidRequest: jsonResponse("The request shape or query value is invalid.", {
        $ref: "#/components/schemas/ErrorResponse",
      }),
      NotFound: jsonResponse("The resource was not found for this caller.", {
        $ref: "#/components/schemas/ErrorResponse",
      }),
      RateLimited: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
        description:
          "The caller token exceeded the public API request budget for the current window.",
        headers: {
          "Retry-After": {
            description: "Seconds to wait before retrying the request.",
            schema: { minimum: 1, type: "integer" },
          },
        },
      },
      Unauthenticated: jsonResponse("A valid Human PAT or Service token is required.", {
        $ref: "#/components/schemas/ErrorResponse",
      }),
    },
    schemas: PUBLISHED_AGENT_OPENAPI_SCHEMAS,
    securitySchemes: {
      publicApiBearer: {
        bearerFormat: "Mosoo Human PAT or Organization Service token",
        description:
          "Use Authorization: Bearer grt_pat_... for Human PAT calls or an Organization Service token for machine calls.",
        scheme: "bearer",
        type: "http",
      },
      personalAccessToken: {
        bearerFormat: "Mosoo PAT",
        description:
          "Use Authorization: Bearer grt_pat_... . PATs identify an account and do not carry scopes.",
        scheme: "bearer",
        type: "http",
      },
    },
  };
}
