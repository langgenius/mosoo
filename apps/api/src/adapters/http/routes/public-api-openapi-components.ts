import { PUBLIC_API_OPENAPI_SCHEMAS } from "@mosoo/contracts/public-api";

const WORKSPACE_RUN_SOURCE_SCHEMA = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        agentId: { type: "string" },
        agentVersionId: { type: ["string", "null"] },
        agentVersionNumber: { type: ["integer", "null"] },
        kind: { const: "agent" },
      },
      required: ["agentId", "agentVersionId", "agentVersionNumber", "kind"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        harness: { enum: ["claude-code", "openai-codex", "opencode"] },
        kind: { const: "harness" },
        version: { type: "string" },
      },
      required: ["harness", "kind", "version"],
      type: "object",
    },
  ],
};

const WORKSPACE_API_SCHEMAS = {
  HarnessCatalogEntry: {
    additionalProperties: false,
    properties: {
      capabilities: {
        additionalProperties: false,
        properties: Object.fromEntries(
          ["approve", "artifacts", "cancel", "resume", "stream", "subagents"].map((name) => [
            name,
            { enum: ["native", "normalized", "unsupported"] },
          ]),
        ),
        required: ["approve", "artifacts", "cancel", "resume", "stream", "subagents"],
        type: "object",
      },
      defaultModel: { type: "string" },
      description: { type: "string" },
      environment: {
        additionalProperties: false,
        properties: {
          default: { const: "workspace" },
          repositoryRequired: { const: false },
        },
        required: ["default", "repositoryRequired"],
        type: "object",
      },
      label: { type: "string" },
      quickstart: { type: "string" },
      requiredCredentials: { items: { type: "string" }, type: "array" },
      runtimeId: { type: "string" },
      slug: { enum: ["claude-code", "openai-codex", "opencode"] },
      status: { enum: ["available", "unavailable"] },
      supportedModels: { items: { type: "string" }, type: "array" },
      version: { type: "string" },
    },
    required: [
      "capabilities",
      "defaultModel",
      "description",
      "environment",
      "label",
      "quickstart",
      "requiredCredentials",
      "runtimeId",
      "slug",
      "status",
      "supportedModels",
      "version",
    ],
    type: "object",
  },
  WorkspaceRunRequest: {
    oneOf: [
      {
        additionalProperties: false,
        properties: {
          agent: { minLength: 1, type: "string" },
          input: {},
        },
        required: ["agent", "input"],
        type: "object",
      },
      {
        additionalProperties: false,
        properties: {
          environment: { minLength: 1, type: "string" },
          harness: { enum: ["claude-code", "openai-codex", "opencode"] },
          input: {},
          model: { minLength: 1, type: "string" },
        },
        required: ["harness", "input"],
        type: "object",
      },
    ],
  },
  WorkspaceRunResponse: {
    additionalProperties: false,
    properties: {
      environment: {
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          revisionId: { type: "string" },
        },
        required: ["id", "name", "revisionId"],
        type: "object",
      },
      id: { type: "string" },
      links: {
        additionalProperties: false,
        properties: Object.fromEntries(
          ["approve", "artifacts", "cancel", "events", "result", "stream"].map((name) => [
            name,
            { type: "string" },
          ]),
        ),
        required: ["approve", "artifacts", "cancel", "events", "result", "stream"],
        type: "object",
      },
      model: { type: "string" },
      source: WORKSPACE_RUN_SOURCE_SCHEMA,
      status: {
        enum: [
          "queued",
          "booting",
          "running",
          "waiting_input",
          "completed",
          "failed",
          "cancelled",
          "expired",
        ],
      },
      threadId: { type: "string" },
      workspaceId: { type: "string" },
    },
    required: [
      "environment",
      "id",
      "links",
      "model",
      "source",
      "status",
      "threadId",
      "workspaceId",
    ],
    type: "object",
  },
  WorkspaceRunResultResponse: {
    additionalProperties: false,
    properties: {
      output: {
        oneOf: [{ $ref: "#/components/schemas/RunFinalOutput" }, { type: "null" }],
      },
      run: { $ref: "#/components/schemas/WorkspaceRunResponse" },
    },
    required: ["output", "run"],
    type: "object",
  },
} satisfies Record<string, Record<string, unknown>>;

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

export function createPublicApiOpenApiComponents() {
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
      Unauthenticated: jsonResponse("A valid Access Token is required.", {
        $ref: "#/components/schemas/ErrorResponse",
      }),
    },
    schemas: {
      ...PUBLIC_API_OPENAPI_SCHEMAS,
      ...WORKSPACE_API_SCHEMAS,
    },
    securitySchemes: {
      accessToken: {
        bearerFormat: "mosoo Access Token",
        description:
          "Use Authorization: Bearer mst_... . Access Tokens identify an account and do not carry scopes.",
        scheme: "bearer",
        type: "http",
      },
      workspaceApiKey: {
        bearerFormat: "mosoo Workspace API key",
        description:
          "Use Authorization: Bearer msk_... . A Workspace API key can start and control Runs only in its bound Workspace.",
        scheme: "bearer",
        type: "http",
      },
    },
  };
}
