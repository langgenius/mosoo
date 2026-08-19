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
          enum: ["claude-code", "openai-codex", "opencode", "deepseek-harness"],
        },
        kind: { const: "harness", description: "Discriminator for a Harness-backed Run." },
        profile: {
          additionalProperties: false,
          description: "Frozen Harness Profile Version identity and immutable source revision.",
          properties: {
            id: { description: "Stable Profile identifier.", type: "string" },
            revision: { description: "Immutable provenance revision.", type: "string" },
            version: { description: "Frozen Profile version.", type: "string" },
          },
          required: ["id", "revision", "version"],
          type: "object",
        },
        version: { description: "Frozen Harness version used by the Run.", type: "string" },
      },
      required: ["harness", "kind", "profile", "version"],
      type: "object",
    },
  ],
};

const WORKSPACE_API_SCHEMAS = {
  HarnessProfileVersion: {
    additionalProperties: false,
    description:
      "One locked, complete Harness composition. Status states whether it is independently runnable; individual plugins are not catalog units.",
    properties: {
      benchmark: {
        additionalProperties: false,
        description: "Comparable benchmark identity and measured evidence, when available.",
        properties: {
          model: { description: "Exact model fixed by the benchmark case.", type: "string" },
          result: {
            description:
              "Measured token, latency, approval, side-effect, and safety evidence; null until a live benchmark is recorded.",
            oneOf: [
              { type: "null" },
              {
                additionalProperties: false,
                properties: {
                  approvals: {
                    description: "Number of approval prompts raised by the measured Runs.",
                    minimum: 0,
                    type: "integer",
                  },
                  environmentRevision: {
                    description: "Exact Environment revision used by the measured Runs.",
                    type: "string",
                  },
                  inputTokens: {
                    description: "Measured input-token count.",
                    minimum: 0,
                    type: "integer",
                  },
                  latencyMs: {
                    description: "Measured end-to-end latency in milliseconds.",
                    minimum: 0,
                    type: "integer",
                  },
                  outcome: {
                    description: "Whether the benchmark's task-specific assertion passed.",
                    enum: ["failed", "passed"],
                  },
                  outputTokens: {
                    description: "Measured output-token count.",
                    minimum: 0,
                    type: "integer",
                  },
                  recordedAt: {
                    description: "Time at which the benchmark evidence was recorded.",
                    format: "date-time",
                    type: "string",
                  },
                  runIds: {
                    description: "Run identifiers that provide the benchmark evidence.",
                    items: { type: "string" },
                    type: "array",
                  },
                  safetyFindings: {
                    description: "Safety findings observed during the measured Runs.",
                    items: { type: "string" },
                    type: "array",
                  },
                  sideEffects: {
                    description: "Filesystem or network side effects observed during the Runs.",
                    items: { type: "string" },
                    type: "array",
                  },
                },
                required: [
                  "approvals",
                  "environmentRevision",
                  "inputTokens",
                  "latencyMs",
                  "outcome",
                  "outputTokens",
                  "recordedAt",
                  "runIds",
                  "safetyFindings",
                  "sideEffects",
                ],
                type: "object",
              },
            ],
          },
          status: {
            description: "Evidence level; contract smoke is not a measured model benchmark.",
            enum: ["not_run", "contract_smoke", "measured"],
          },
          suiteId: { description: "Stable comparable benchmark-suite identifier.", type: "string" },
          taskDigest: { description: "Digest of the exact benchmark task.", type: "string" },
          taskId: { description: "Stable benchmark-task identifier.", type: "string" },
        },
        required: ["model", "result", "status", "suiteId", "taskDigest", "taskId"],
        type: "object",
      },
      defaultModel: { description: "Default model locked by this Profile.", type: "string" },
      description: {
        description: "Short explanation of the complete composition.",
        type: "string",
      },
      environmentRequirements: {
        description: "Runtime, isolation, credential, and Environment prerequisites.",
        items: { type: "string" },
        type: "array",
      },
      id: { description: "Stable Profile identifier without its version.", type: "string" },
      label: { description: "Human-readable Profile name.", type: "string" },
      provenance: {
        additionalProperties: false,
        description: "Immutable origin of the Profile's executable composition.",
        properties: {
          revision: { description: "Immutable source revision.", type: "string" },
          source: { description: "Source repository or distribution.", type: "string" },
        },
        required: ["revision", "source"],
        type: "object",
      },
      reference: {
        description: "Exact id@version selector accepted by the Run API.",
        type: "string",
      },
      runtimeId: { description: "Runtime adapter selected by the Profile.", type: "string" },
      status: {
        description: "Whether this exact Profile Version can currently launch.",
        enum: ["available", "unavailable"],
      },
      trust: {
        additionalProperties: false,
        description: "Execution privilege, composition lock, and isolation boundary.",
        properties: {
          composition: {
            const: "locked",
            description: "The effective composition cannot move after admission.",
          },
          execution: {
            const: "shell-equivalent",
            description: "The composition is trusted like code with shell access.",
          },
          isolation: {
            const: "cattle",
            description: "Every Run uses disposable Cattle isolation.",
          },
        },
        required: ["composition", "execution", "isolation"],
        type: "object",
      },
      version: { description: "Immutable Profile version.", type: "string" },
    },
    required: [
      "benchmark",
      "defaultModel",
      "description",
      "environmentRequirements",
      "id",
      "label",
      "provenance",
      "reference",
      "runtimeId",
      "status",
      "trust",
      "version",
    ],
    type: "object",
  },
  HarnessCatalogEntry: {
    additionalProperties: false,
    description: "One curated coding-agent Harness known to a Workspace.",
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
      defaultProfile: {
        description: "Exact id@version Profile selected when a Run omits profile.",
        type: "string",
      },
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
      profiles: {
        description: "Curated complete Profile Versions; never individual plugins.",
        items: { $ref: "#/components/schemas/HarnessProfileVersion" },
        type: "array",
      },
      quickstart: { description: "One-line command for starting this Harness.", type: "string" },
      requiredCredentials: {
        description: "Credential providers required before launch.",
        items: { type: "string" },
        type: "array",
      },
      runtimeId: { description: "Internal runtime implementation identifier.", type: "string" },
      slug: {
        description: "Stable Harness identifier accepted by the Run API.",
        enum: ["claude-code", "openai-codex", "opencode", "deepseek-harness"],
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
      unavailableReason: {
        description: "Why the Harness cannot launch, or null when available.",
        type: ["string", "null"],
      },
      version: { description: "Frozen Harness package version.", type: "string" },
    },
    required: [
      "capabilities",
      "defaultModel",
      "defaultProfile",
      "description",
      "environment",
      "label",
      "profiles",
      "quickstart",
      "requiredCredentials",
      "runtimeId",
      "slug",
      "status",
      "supportedModels",
      "unavailableReason",
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
            enum: ["claude-code", "openai-codex", "opencode", "deepseek-harness"],
          },
          input: { description: "Task input delivered to the selected Harness." },
          model: {
            description: "Optional supported model override for the Harness.",
            minLength: 1,
            type: "string",
          },
          profile: {
            description: "Optional exact id@version Profile selector from the Harness catalog.",
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
