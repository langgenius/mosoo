import { PLATFORM_ID_INPUT_PATTERN } from "@mosoo/id";

import { AGENT_KIND_VALUES } from "../agent/agent.contract.ts";
import {
  PUBLIC_API_ERROR_CODES,
  PUBLIC_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
  PUBLIC_THREAD_EVENT_LOG_STATUSES,
  PUBLIC_THREAD_EVENT_LOG_TYPES,
  PUBLIC_THREAD_FILE_ID_MAX_LENGTH,
  PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH,
  PUBLIC_THREAD_RUN_TERMINAL_STATUSES,
} from "./public-api-core.contract";

export type PublicApiOpenApiSchema = Record<string, unknown>;

export interface PublicApiPlatformIdSchemaOptions {
  example?: string | undefined;
  maxLength?: number | undefined;
  minLength?: number | undefined;
}

export function createPublicApiPlatformIdSchema(
  options: PublicApiPlatformIdSchemaOptions = {},
): PublicApiOpenApiSchema {
  return {
    example: options.example ?? "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    format: "ulid",
    pattern: PLATFORM_ID_INPUT_PATTERN,
    type: "string",
    ...(options.maxLength === undefined ? {} : { maxLength: options.maxLength }),
    ...(options.minLength === undefined ? {} : { minLength: options.minLength }),
  };
}

const PLATFORM_ID_SCHEMA = createPublicApiPlatformIdSchema();

export const PUBLIC_API_OPENAPI_SCHEMAS = {
  ThreadEventInput: {
    description:
      "A single event posted to a Thread. Exactly one variant applies: send a user message, answer a pending permission request, or interrupt a running Run.",
    oneOf: [
      {
        additionalProperties: false,
        description: "Send a new user message into the Thread, optionally with file attachments.",
        properties: {
          resources: {
            description:
              "Files to attach to this message. Each file must be a ready draft file uploaded through the Agent file endpoint by the same Access Token caller.",
            items: { $ref: "#/components/schemas/FileResource" },
            type: "array",
          },
          clientRequestId: {
            description:
              "Optional caller-supplied correlation ID echoed back on the matching event result so you can pair responses with the message you sent.",
            type: ["string", "null"],
          },
          text: {
            description: "The user message text. Must not be empty.",
            minLength: 1,
            type: "string",
          },
          type: {
            const: "user_message",
            description: "Discriminator selecting the send-user-message variant.",
          },
        },
        required: ["type", "text"],
        type: "object",
      },
      {
        additionalProperties: false,
        description:
          "Answer a permission request the Agent raised while waiting for input (for example a tool confirmation).",
        properties: {
          decision: {
            description:
              "Whether to allow or reject the requested action for this single occurrence. `allow_once` permits it now; `reject_once` denies it now.",
            enum: ["allow_once", "reject_once"],
          },
          requestId: {
            description:
              "ID of the permission request being answered, taken from the corresponding `tool.confirmation.required` event.",
            minLength: 1,
            type: "string",
          },
          type: {
            const: "permission_decision",
            description: "Discriminator selecting the permission-decision variant.",
          },
        },
        required: ["type", "requestId", "decision"],
        type: "object",
      },
      {
        additionalProperties: false,
        description: "Interrupt a Run that is currently executing on the Thread.",
        properties: {
          runId: {
            description:
              "Run ID (bare ULID) to interrupt. Omit or send null to interrupt the Thread's current Run.",
            oneOf: [PLATFORM_ID_SCHEMA, { type: "null" }],
          },
          type: {
            const: "user_interrupt",
            description: "Discriminator selecting the interrupt variant.",
          },
        },
        required: ["type"],
        type: "object",
      },
    ],
  },
  SendEventsRequest: {
    additionalProperties: false,
    description: "Request body for posting a batch of events to a Thread.",
    properties: {
      events: {
        description: "Ordered list of events to apply to the Thread. At least one is required.",
        items: { $ref: "#/components/schemas/ThreadEventInput" },
        minItems: 1,
        type: "array",
      },
    },
    required: ["events"],
    type: "object",
  },
  FileResource: {
    additionalProperties: false,
    description: "A file resource to mount into a Thread or user message.",
    properties: {
      file_id: {
        ...createPublicApiPlatformIdSchema({
          maxLength: PUBLIC_THREAD_FILE_ID_MAX_LENGTH,
          minLength: 1,
        }),
        description: "ID of a ready draft file uploaded through the Agent file endpoint.",
      },
      type: {
        const: "file",
        description: "Resource discriminator. Only `file` is supported today.",
      },
    },
    required: ["type", "file_id"],
    type: "object",
  },
  PublicFile: {
    additionalProperties: false,
    description: "Public file metadata.",
    properties: {
      createdAt: {
        description: "Timestamp (RFC 3339) at which the file record was created.",
        format: "date-time",
        type: "string",
      },
      id: {
        ...createPublicApiPlatformIdSchema({
          maxLength: PUBLIC_THREAD_FILE_ID_MAX_LENGTH,
          minLength: 1,
        }),
        description: "File ID (bare ULID).",
      },
      mimeType: {
        description: "Detected MIME type of the file, or null when unknown.",
        type: ["string", "null"],
      },
      name: {
        description: "Original file name.",
        type: "string",
      },
      size: {
        description: "File size in bytes.",
        minimum: 0,
        type: "integer",
      },
    },
    required: ["createdAt", "id", "mimeType", "name", "size"],
    type: "object",
  },
  PublicFileResponse: {
    additionalProperties: false,
    description: "A single public file.",
    properties: {
      file: {
        $ref: "#/components/schemas/PublicFile",
        description: "Public file metadata.",
      },
    },
    required: ["file"],
    type: "object",
  },
  ErrorResponse: {
    description: "Standard error envelope returned for any non-2xx public API response.",
    properties: {
      error: {
        description: "Details about why the request failed.",
        properties: {
          code: {
            description: "Stable, machine-readable error code you can branch on.",
            enum: PUBLIC_API_ERROR_CODES,
          },
          message: {
            description: "Human-readable explanation of the error. Not intended for end users.",
            type: "string",
          },
        },
        required: ["code", "message"],
        type: "object",
      },
    },
    required: ["error"],
    type: "object",
  },
  SendEventsResponse: {
    additionalProperties: false,
    description: "Result of accepting a batch of events posted to a Thread.",
    properties: {
      acceptedAt: {
        description: "Timestamp (RFC 3339) at which the event batch was accepted for processing.",
        format: "date-time",
        type: "string",
      },
      events: {
        description: "Per-event outcomes, in the same order as the submitted events.",
        items: { $ref: "#/components/schemas/ThreadEventResult" },
        type: "array",
      },
      thread: {
        $ref: "#/components/schemas/ThreadSummary",
        description: "The Thread state after applying the batch.",
      },
      warnings: {
        description:
          "Non-fatal warnings raised while accepting the batch (for example a partially honored request). Empty when there are none.",
        items: { $ref: "#/components/schemas/UserWarning" },
        type: "array",
      },
    },
    required: ["acceptedAt", "events", "thread", "warnings"],
    type: "object",
  },
  ThreadEventLogEntry: {
    additionalProperties: false,
    description:
      "A single public event log entry for a Thread. This is the stable read surface and never exposes raw runtime payloads, transcripts, or diagnostics.",
    properties: {
      content: {
        description:
          "Public content of the event — typically a reference to the associated payload (such as a message ID) rather than the raw runtime data.",
        type: "string",
      },
      durationMs: {
        description:
          "Wall-clock duration of the event in milliseconds, when applicable (for example a completed Run). Null when not measured.",
        type: ["integer", "null"],
      },
      id: {
        ...PLATFORM_ID_SCHEMA,
        description:
          "Unique event ID (bare ULID), monotonically increasing in chronological order.",
      },
      occurredAt: {
        description: "Timestamp (RFC 3339) at which the event occurred.",
        format: "date-time",
        type: "string",
      },
      runId: {
        description:
          "Run ID (bare ULID) associated with this event, or null when the event is not run-scoped. Use this to reconstruct output for one current Run without mixing earlier Thread output.",
        oneOf: [PLATFORM_ID_SCHEMA, { type: "null" }],
      },
      status: {
        description:
          "Delivery status of the event: `available` when the event is fully populated, `error` when it failed, `unsupported` when this event type cannot be rendered on the public surface.",
        enum: PUBLIC_THREAD_EVENT_LOG_STATUSES,
      },
      tokens: {
        description:
          "Token count associated with the event when applicable (for example model usage). Null when not measured.",
        type: ["integer", "null"],
      },
      type: {
        description:
          "Event type, such as `run.started`, `run.completed`, `agent.message.delta`, or `tool.use.started`.",
        enum: PUBLIC_THREAD_EVENT_LOG_TYPES,
      },
    },
    required: ["content", "durationMs", "id", "occurredAt", "runId", "status", "tokens", "type"],
    type: "object",
  },
  ThreadEventListResponse: {
    additionalProperties: false,
    description: "A page of the latest Thread event log entries in chronological order.",
    properties: {
      events: {
        description: "The returned event log entries, oldest first within the requested window.",
        items: { $ref: "#/components/schemas/ThreadEventLogEntry" },
        type: "array",
      },
      truncated: {
        description:
          "True when older events exist beyond the returned window because the requested limit was reached.",
        type: "boolean",
      },
    },
    required: ["events", "truncated"],
    type: "object",
  },
  ThreadEventResult: {
    additionalProperties: false,
    description: "Outcome of a single submitted event.",
    properties: {
      clientRequestId: {
        description:
          "The `clientRequestId` echoed from the submitted user message, or null when none was provided or the event type does not carry one.",
        type: ["string", "null"],
      },
      run: {
        description:
          "The Run created or affected by this event, or null when the event did not start or change a Run.",
        oneOf: [{ $ref: "#/components/schemas/RunSummary" }, { type: "null" }],
      },
      type: {
        description: "The kind of event this result corresponds to.",
        enum: ["permission_decision", "user_interrupt", "user_message"],
      },
    },
    required: ["clientRequestId", "run", "type"],
    type: "object",
  },
  CreateThreadRequest: {
    additionalProperties: false,
    description:
      "Request body for creating a Thread. All fields are optional: omit `input` to create an empty IDLE Thread, or include it to queue the initial Run.",
    properties: {
      client_external_ref: {
        description:
          "Optional caller-owned reference (for example an external ticket key) stored on the Thread for correlation. Not unique and not validated by Mosoo.",
        maxLength: PUBLIC_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
        type: "string",
      },
      resources: {
        description:
          "Files uploaded through the Agent file endpoint and mounted into the first Run.",
        items: { $ref: "#/components/schemas/FileResource" },
        type: "array",
      },
      input: {
        additionalProperties: false,
        description:
          "Initial user message that seeds the Thread and queues the first Run. Omit to create an empty Thread with no run.",
        properties: {
          content: {
            description: "Ordered content parts that make up the initial message.",
            items: {
              additionalProperties: false,
              description: "A single content part of the initial message.",
              properties: {
                text: {
                  description: "The text of this content part. Must not be empty.",
                  maxLength: PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH,
                  minLength: 1,
                  type: "string",
                },
                type: {
                  const: "text",
                  description: "Content part discriminator. Only `text` is supported today.",
                },
              },
              required: ["type", "text"],
              type: "object",
            },
            minItems: 1,
            type: "array",
          },
          type: {
            const: "user.message",
            description: "Discriminator for the initial input. Always `user.message`.",
          },
        },
        required: ["type", "content"],
        type: "object",
      },
    },
    required: [],
    type: "object",
  },
  CreateThreadResponse: {
    additionalProperties: false,
    description: "Result of creating a Thread.",
    properties: {
      links: {
        $ref: "#/components/schemas/ThreadLinks",
        description: "Convenience links for the created Thread.",
      },
      run: {
        description:
          "The initial Run queued when `input` was provided, or null when an empty Thread was created.",
        oneOf: [{ $ref: "#/components/schemas/RunSummary" }, { type: "null" }],
      },
      thread: {
        $ref: "#/components/schemas/ThreadSummary",
        description: "The created Thread.",
      },
    },
    required: ["links", "run", "thread"],
    type: "object",
  },
  RetrieveThreadResponse: {
    additionalProperties: false,
    description: "Current state of a Thread.",
    properties: {
      links: {
        $ref: "#/components/schemas/ThreadLinks",
        description: "Convenience links for the Thread.",
      },
      run: {
        description: "The Thread's most recent Run, or null when no Run has been created yet.",
        oneOf: [{ $ref: "#/components/schemas/RunSummary" }, { type: "null" }],
      },
      thread: {
        $ref: "#/components/schemas/ThreadSummary",
        description: "The Thread summary.",
      },
    },
    required: ["links", "run", "thread"],
    type: "object",
  },
  ThreadFile: {
    additionalProperties: false,
    description: "A file associated with a Thread.",
    properties: {
      committed: {
        description:
          "True once the file is durably attached to the Thread; false while it is still a draft handle.",
        type: "boolean",
      },
      createdAt: {
        description: "Timestamp (RFC 3339) at which the file was created.",
        format: "date-time",
        type: "string",
      },
      id: {
        ...PLATFORM_ID_SCHEMA,
        description: "Unique file ID (bare ULID).",
      },
      kind: {
        description:
          "Files added through the public API are attachments; artifacts are files produced by the Agent.",
        enum: ["attachment", "artifact"],
      },
      mimeType: {
        description: "Detected MIME type of the file, or null when unknown.",
        type: ["string", "null"],
      },
      name: {
        description: "Original file name.",
        type: "string",
      },
      size: {
        description: "File size in bytes.",
        minimum: 0,
        type: "integer",
      },
    },
    required: ["committed", "createdAt", "id", "kind", "mimeType", "name", "size"],
    type: "object",
  },
  ThreadFileListResponse: {
    additionalProperties: false,
    description: "List of files attached to a Thread.",
    properties: {
      files: {
        description: "The Thread's files.",
        items: { $ref: "#/components/schemas/ThreadFile" },
        type: "array",
      },
    },
    required: ["files"],
    type: "object",
  },
  ThreadFileResponse: {
    additionalProperties: false,
    description: "A single Thread file.",
    properties: {
      file: {
        $ref: "#/components/schemas/ThreadFile",
        description:
          "The Thread file metadata, including its identifier, name, MIME type, and origin.",
      },
    },
    required: ["file"],
    type: "object",
  },
  ThreadAttributedUser: {
    additionalProperties: false,
    description: "The account a Thread is attributed to (the Access Token owner).",
    properties: {
      id: {
        ...PLATFORM_ID_SCHEMA,
        description: "Account ID (bare ULID) the Thread is attributed to.",
      },
    },
    required: ["id"],
    type: "object",
  },
  ThreadCaller: {
    additionalProperties: false,
    description: "The credential that created the Thread.",
    properties: {
      id: {
        ...PLATFORM_ID_SCHEMA,
        description: "ID (bare ULID) of the caller that created the Thread.",
      },
      kind: {
        description: "Caller credential type. `access_token` identifies an Access Token caller.",
        enum: ["access_token"],
      },
    },
    required: ["id", "kind"],
    type: "object",
  },
  ThreadLinks: {
    additionalProperties: false,
    description: "Convenience links for a Thread.",
    properties: {
      thread: {
        description: "Absolute API URL of the Thread resource.",
        type: "string",
      },
    },
    required: ["thread"],
    type: "object",
  },
  ThreadSummary: {
    additionalProperties: false,
    description: "Summary of a Thread on a Agent API Endpoint.",
    properties: {
      agent_id: {
        ...PLATFORM_ID_SCHEMA,
        description: "ID (bare ULID) of the Agent API Endpoint this Thread belongs to.",
      },
      attributed_user: {
        description:
          "The account the Thread is attributed to, or null when not attributed to an account.",
        oneOf: [{ $ref: "#/components/schemas/ThreadAttributedUser" }, { type: "null" }],
      },
      client_external_ref: {
        description:
          "The caller-owned reference supplied at creation, or null when none was provided.",
        type: ["string", "null"],
      },
      created_at: {
        description: "Timestamp (RFC 3339) at which the Thread was created.",
        format: "date-time",
        type: "string",
      },
      created_by: {
        $ref: "#/components/schemas/ThreadCaller",
        description: "The credential that created the Thread.",
      },
      id: {
        ...PLATFORM_ID_SCHEMA,
        description: "Unique Thread ID (bare ULID).",
      },
      kind: {
        description:
          "Agent kind backing this Thread (for example a persistent or one-off Agent API Endpoint).",
        enum: AGENT_KIND_VALUES,
      },
      last_run_id: {
        description: "ID (bare ULID) of the most recent Run, or null when no Run exists yet.",
        oneOf: [PLATFORM_ID_SCHEMA, { type: "null" }],
      },
      source: {
        const: "api",
        description: "Origin of the Thread. Always `api` for Threads created via this API.",
      },
      status: {
        description:
          "Lifecycle status of the Thread: `IDLE` (no active run), `RUNNING` (a Run is executing), `RESCHEDULING` (between runs), or `TERMINATED` (ended).",
        enum: ["IDLE", "RUNNING", "RESCHEDULING", "TERMINATED"],
      },
      title: {
        description: "Human-readable Thread title, or null when one has not been derived yet.",
        type: ["string", "null"],
      },
      updated_at: {
        description: "Timestamp (RFC 3339) of the most recent change to the Thread.",
        format: "date-time",
        type: "string",
      },
    },
    required: [
      "agent_id",
      "attributed_user",
      "client_external_ref",
      "created_at",
      "created_by",
      "id",
      "kind",
      "last_run_id",
      "source",
      "status",
      "title",
      "updated_at",
    ],
    type: "object",
  },
  RunSummary: {
    additionalProperties: false,
    description: "Summary of a single Agent Run on a Thread.",
    properties: {
      completedAt: {
        description:
          "Timestamp (RFC 3339) at which the Run reached a terminal state, or null while it has not finished.",
        format: "date-time",
        type: ["string", "null"],
      },
      createdAt: {
        description: "Timestamp (RFC 3339) at which the Run was created.",
        format: "date-time",
        type: "string",
      },
      error: {
        description:
          "Structured failure summary when status is `failed`; null for successful, active, cancelled, or expired Runs.",
        oneOf: [{ $ref: "#/components/schemas/RunError" }, { type: "null" }],
      },
      finalOutput: {
        description:
          "Canonical final assistant answer for a completed Run. This is the exact persisted final assistant message text, not a reconstruction of public `agent.message.delta` events. Null until that final message is persisted or when the Run has no final assistant answer.",
        oneOf: [{ $ref: "#/components/schemas/RunFinalOutput" }, { type: "null" }],
      },
      id: {
        ...PLATFORM_ID_SCHEMA,
        description: "Unique Run ID (bare ULID).",
      },
      startedAt: {
        description:
          "Timestamp (RFC 3339) at which the Run began executing, or null while it is still queued.",
        format: "date-time",
        type: ["string", "null"],
      },
      status: {
        description: `Current Run status. \`queued\` and \`booting\` precede execution; \`running\` and \`waiting_input\` are active; ${PUBLIC_THREAD_RUN_TERMINAL_STATUSES.map((status) => `\`${status}\``).join(", ")} are terminal.`,
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
      trigger: {
        description:
          "What started the Run: `user_prompt` (a user message), `retry`, `resume`, or `system`.",
        enum: ["user_prompt", "retry", "resume", "system"],
      },
      updatedAt: {
        description: "Timestamp (RFC 3339) of the most recent change to the Run.",
        format: "date-time",
        type: "string",
      },
    },
    required: [
      "completedAt",
      "createdAt",
      "error",
      "finalOutput",
      "id",
      "startedAt",
      "status",
      "trigger",
      "updatedAt",
    ],
    type: "object",
  },
  RunError: {
    additionalProperties: false,
    description: "Public-safe Run failure summary exposed on failed public Runs.",
    properties: {
      code: {
        description: "Stable, machine-readable failure code.",
        minLength: 1,
        type: "string",
      },
      message: {
        description: "Human-readable failure summary.",
        minLength: 1,
        type: "string",
      },
      retryable: {
        description: "Whether retrying the Run may succeed without changing input.",
        type: "boolean",
      },
    },
    required: ["code", "message", "retryable"],
    type: "object",
  },
  RunFinalOutput: {
    additionalProperties: false,
    description: "Final assistant answer for a completed public Thread Run.",
    properties: {
      text: {
        description:
          "Exact text of the Run's persisted final assistant message. Public event entries are not a substitute for this value.",
        type: "string",
      },
    },
    required: ["text"],
    type: "object",
  },
  UserWarning: {
    additionalProperties: false,
    description: "A non-fatal warning surfaced to the caller.",
    properties: {
      code: {
        description: "Stable, machine-readable warning code.",
        type: "string",
      },
      message: {
        description: "Human-readable explanation of the warning.",
        type: "string",
      },
    },
    required: ["code", "message"],
    type: "object",
  },
} satisfies Record<string, PublicApiOpenApiSchema>;
