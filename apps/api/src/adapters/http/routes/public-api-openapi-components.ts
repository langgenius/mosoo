import { PUBLIC_API_OPENAPI_SCHEMAS } from "@mosoo/contracts/public-api";

const WORKSPACE_RUN_SOURCE_SCHEMA = {
  description: "Immutable source snapshot selected for this Run.",
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        agentId: { description: "Published Agent selected as the Run source.", type: "string" },
        agentVersionId: {
          description: "Frozen Agent version identifier, when published.",
          type: ["string", "null"],
        },
        agentVersionNumber: {
          description: "Frozen Agent version number, when published.",
          type: ["integer", "null"],
        },
        kind: { const: "agent", description: "Discriminator for an Agent-backed Run." },
      },
      required: ["agentId", "agentVersionId", "agentVersionNumber", "kind"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        harness: {
          description: "Curated Harness selected as the Run source.",
          enum: ["claude-code", "openai-codex", "opencode"],
        },
        kind: { const: "harness", description: "Discriminator for a Harness-backed Run." },
        version: { description: "Frozen Harness version used by the Run.", type: "string" },
      },
      required: ["harness", "kind", "version"],
      type: "object",
    },
  ],
};

const WORKSPACE_API_SCHEMAS = {
  HarnessCatalogEntry: {
    additionalProperties: false,
    description: "One curated coding-agent Harness available to a Workspace.",
    properties: {
      capabilities: {
        additionalProperties: false,
        description: "Normalized lifecycle capabilities exposed by this Harness.",
        properties: Object.fromEntries(
          ["approve", "artifacts", "cancel", "resume", "stream", "subagents"].map((name) => [
            name,
            {
              description: `Support level for the ${name} Run capability.`,
              enum: ["native", "normalized", "unsupported"],
            },
          ]),
        ),
        required: ["approve", "artifacts", "cancel", "resume", "stream", "subagents"],
        type: "object",
      },
      defaultModel: { description: "Default model selected for this Harness.", type: "string" },
      description: { description: "Short explanation of the Harness use case.", type: "string" },
      environment: {
        additionalProperties: false,
        description: "Default Environment behavior for new Harness Runs.",
        properties: {
          default: { const: "workspace", description: "Environment selection default." },
          repositoryRequired: {
            const: false,
            description: "Whether a repository is required to launch.",
          },
        },
        required: ["default", "repositoryRequired"],
        type: "object",
      },
      label: { description: "Human-readable Harness name.", type: "string" },
      quickstart: { description: "One-line command for starting this Harness.", type: "string" },
      requiredCredentials: {
        description: "Credential providers required before launch.",
        items: { type: "string" },
        type: "array",
      },
      runtimeId: { description: "Internal runtime implementation identifier.", type: "string" },
      slug: {
        description: "Stable Harness identifier accepted by the Run API.",
        enum: ["claude-code", "openai-codex", "opencode"],
      },
      status: {
        description: "Current launch availability for this Harness.",
        enum: ["available", "unavailable"],
      },
      supportedModels: {
        description: "Models currently offered by this Harness.",
        items: { type: "string" },
        type: "array",
      },
      version: { description: "Frozen Harness package version.", type: "string" },
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
    description: "Request to start a Run from exactly one supported source.",
    oneOf: [
      {
        additionalProperties: false,
        properties: {
          agent: {
            description: "Published Agent identifier or unambiguous Agent name.",
            minLength: 1,
            type: "string",
          },
          input: { description: "Task input delivered to the selected Agent." },
        },
        required: ["agent", "input"],
        type: "object",
      },
      {
        additionalProperties: false,
        properties: {
          environment: {
            description: "Optional Environment identifier or unambiguous name.",
            minLength: 1,
            type: "string",
          },
          harness: {
            description: "Curated Harness to launch for this Run.",
            enum: ["claude-code", "openai-codex", "opencode"],
          },
          input: { description: "Task input delivered to the selected Harness." },
          model: {
            description: "Optional supported model override for the Harness.",
            minLength: 1,
            type: "string",
          },
        },
        required: ["harness", "input"],
        type: "object",
      },
    ],
  },
  WorkspaceRunResponse: {
    additionalProperties: false,
    description: "Current state and immutable snapshots for one Workspace Run.",
    properties: {
      environment: {
        additionalProperties: false,
        description: "Frozen Environment revision used by this Run.",
        properties: {
          id: { description: "Environment identifier used by this Run.", type: "string" },
          name: { description: "Environment name captured for display.", type: "string" },
          revisionId: { description: "Frozen Environment revision identifier.", type: "string" },
        },
        required: ["id", "name", "revisionId"],
        type: "object",
      },
      id: { description: "Stable identifier for this Run.", type: "string" },
      links: {
        additionalProperties: false,
        description: "Run lifecycle and result endpoint links.",
        properties: Object.fromEntries(
          ["approve", "artifacts", "cancel", "events", "result", "stream"].map((name) => [
            name,
            { description: `Relative link for the Run ${name} endpoint.`, type: "string" },
          ]),
        ),
        required: ["approve", "artifacts", "cancel", "events", "result", "stream"],
        type: "object",
      },
      model: { description: "Frozen model selected for this Run.", type: "string" },
      source: WORKSPACE_RUN_SOURCE_SCHEMA,
      status: {
        description: "Current lifecycle status for this Run.",
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
      threadId: { description: "Backing Thread identifier for event history.", type: "string" },
      workspaceId: { description: "Workspace that owns this Run.", type: "string" },
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
    description: "Run state paired with its canonical final output.",
    properties: {
      output: {
        description: "Canonical final assistant output, or null while unavailable.",
        oneOf: [{ $ref: "#/components/schemas/RunFinalOutput" }, { type: "null" }],
      },
      run: {
        $ref: "#/components/schemas/WorkspaceRunResponse",
        description: "Latest lifecycle state for the requested Run.",
      },
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
