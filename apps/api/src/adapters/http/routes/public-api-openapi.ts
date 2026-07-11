import {
  createPublicApiPlatformIdSchema,
  PUBLIC_API_PREFIX,
  PUBLIC_API_VERSION_PREFIX,
  PUBLIC_THREAD_API_THREADS_MAX_LIMIT,
  PUBLIC_THREAD_EVENTS_DEFAULT_LIMIT,
  PUBLIC_THREAD_EVENTS_MAX_LIMIT,
  PUBLIC_API_VERSION,
} from "@mosoo/contracts/public-api";

import { createPublicApiOpenApiComponents } from "./public-api-openapi-components";

type HttpMethod = "delete" | "get" | "post" | "put";
type AccessTokenSecurity = { accessToken: [] };

interface OpenApiParameter {
  description?: string;
  example?: unknown;
  in: "header" | "path" | "query";
  name: string;
  required?: boolean;
  schema: Record<string, unknown>;
}

interface OpenApiOperation {
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: Record<string, unknown>;
  responses: Record<string, unknown>;
  security?: AccessTokenSecurity[];
  summary: string;
}

type OpenApiPaths = Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;

interface PublicApiOpenApiDocument {
  components: ReturnType<typeof createPublicApiOpenApiComponents>;
  info: {
    description: string;
    title: string;
    version: typeof PUBLIC_API_VERSION;
  };
  openapi: "3.1.0";
  paths: OpenApiPaths;
  security: AccessTokenSecurity[];
  servers: { url: string }[];
}

const EXAMPLE_AGENT_ID = "01J00000000000000000000001";
const EXAMPLE_THREAD_ID = "01J00000000000000000000009";
const EXAMPLE_FILE_ID = "01J0000000000000000000000J";
const ACCESS_TOKEN_SECURITY: AccessTokenSecurity[] = [{ accessToken: [] }];

const EXAMPLE_SESSION_FILE = {
  committed: true,
  createdAt: "2026-05-19T00:02:00.000Z",
  id: EXAMPLE_FILE_ID,
  kind: "attachment",
  mimeType: "text/plain",
  name: "brief.txt",
  size: 19,
};

const EXAMPLE_PUBLIC_FILE = {
  createdAt: "2026-05-19T00:02:00.000Z",
  id: EXAMPLE_FILE_ID,
  mimeType: "text/plain",
  name: "brief.txt",
  size: 19,
};

function platformIdPathParameter(input: {
  description: string;
  example: string;
  name: string;
}): OpenApiParameter {
  return {
    description: input.description,
    example: input.example,
    in: "path",
    name: input.name,
    required: true,
    schema: {
      ...createPublicApiPlatformIdSchema({ example: input.example }),
      "x-default": input.example,
    },
  };
}

const exampleAgentIdParameter = platformIdPathParameter({
  description: "Agent API Endpoint ID from the Agent's API Access panel. v1 IDs are bare ULIDs.",
  example: EXAMPLE_AGENT_ID,
  name: "agentId",
});

const threadIdParameter = platformIdPathParameter({
  description: "Thread ID returned by create thread. v1 IDs are bare ULIDs.",
  example: EXAMPLE_THREAD_ID,
  name: "threadId",
});

const fileIdParameter = platformIdPathParameter({
  description: "File ID returned by add or list Thread files. v1 IDs are bare ULIDs.",
  example: EXAMPLE_FILE_ID,
  name: "fileId",
});

const idempotencyKeyParameter = {
  description:
    "Optional key for retry-safe create-thread and send-events calls. Reusing the same key with the same request returns the original response. Reusing the key while the original request is still processing returns 409.",
  example: "thread-20260528-linear-eng-123",
  in: "header",
  name: "Idempotency-Key",
  schema: { maxLength: 128, type: "string" },
} satisfies OpenApiParameter;

const threadEventsLimitParameter = {
  description: "Maximum number of latest Thread events to return.",
  example: PUBLIC_THREAD_EVENTS_DEFAULT_LIMIT,
  in: "query",
  name: "limit",
  schema: {
    default: PUBLIC_THREAD_EVENTS_DEFAULT_LIMIT,
    maximum: PUBLIC_THREAD_EVENTS_MAX_LIMIT,
    minimum: 1,
    type: "integer",
  },
} satisfies OpenApiParameter;

const fileContentDispositionParameter = {
  description:
    "Controls the Content-Disposition response header. Use attachment for downloads or inline for previewable content.",
  example: "attachment",
  in: "query",
  name: "disposition",
  schema: {
    default: "attachment",
    enum: ["attachment", "inline"],
    type: "string",
  },
} satisfies OpenApiParameter;

const standardResponses = {
  "400": {
    $ref: "#/components/responses/InvalidRequest",
  },
  "401": {
    $ref: "#/components/responses/Unauthenticated",
  },
  "403": {
    $ref: "#/components/responses/Forbidden",
  },
  "404": {
    $ref: "#/components/responses/NotFound",
  },
  "409": {
    $ref: "#/components/responses/Conflict",
  },
  "429": {
    $ref: "#/components/responses/RateLimited",
  },
  "500": {
    $ref: "#/components/responses/InternalError",
  },
};

function jsonRequestBody(schema: Record<string, unknown>, example?: unknown) {
  return {
    content: {
      "application/json": {
        schema,
        ...(example === undefined ? {} : { example }),
      },
    },
    required: true,
  };
}

function jsonRequestBodyExamples(
  schema: Record<string, unknown>,
  examples: Record<string, { summary: string; value: unknown }>,
  options: { required?: boolean } = {},
) {
  return {
    content: {
      "application/json": {
        examples,
        schema,
      },
    },
    required: options.required ?? true,
  };
}

function multipartFileRequestBody() {
  return {
    content: {
      "multipart/form-data": {
        schema: {
          additionalProperties: false,
          properties: {
            file: {
              description: "File bytes to upload before attaching them to a Thread.",
              format: "binary",
              type: "string",
            },
          },
          required: ["file"],
          type: "object",
        },
      },
    },
    required: true,
  };
}

function binaryResponse(description: string) {
  return {
    content: {
      "application/octet-stream": {
        schema: {
          format: "binary",
          type: "string",
        },
      },
    },
    description,
    headers: {
      "Cache-Control": {
        description: "Set to no-store for public API file downloads.",
        schema: { type: "string" },
      },
      "Content-Disposition": {
        description: "Download or inline content disposition for the returned file.",
        schema: { type: "string" },
      },
      "Content-Length": {
        description: "File size in bytes.",
        schema: { minimum: 0, type: "integer" },
      },
      ETag: {
        description: "Storage ETag for the returned object.",
        schema: { type: "string" },
      },
    },
  };
}

function jsonResponse(description: string, schema: Record<string, unknown>, example?: unknown) {
  return {
    content: {
      "application/json": {
        ...(example === undefined ? {} : { example }),
        schema,
      },
    },
    description,
  };
}

function idempotentJsonResponse(description: string, schema: Record<string, unknown>) {
  return {
    ...jsonResponse(description, schema),
    headers: {
      "Idempotency-Replayed": {
        description:
          "Present as true when this response is replayed from a previous completed request.",
        schema: { const: "true", type: "string" },
      },
    },
  };
}

function textEventStreamResponse(description: string) {
  return {
    content: {
      "text/event-stream": {
        example:
          ': connected\n\nevent: thread.event\nid: 01J00000000000000000000010\ndata: {"id":"01J00000000000000000000010","runId":"01J0000000000000000000000A","type":"run.started","status":"available","content":"01J0000000000000000000000A","occurredAt":"2026-05-19T00:00:01.000Z","durationMs":null,"tokens":null}\n\n',
        schema: { type: "string" },
      },
    },
    description,
  };
}

function okResponse(description: string) {
  return jsonResponse(description, {
    properties: {
      ok: { const: true },
    },
    required: ["ok"],
    type: "object",
  });
}

function operation(
  input: Omit<OpenApiOperation, "responses"> & {
    success: Record<string, unknown>;
    responses?: Record<string, unknown>;
  },
): OpenApiOperation {
  const { responses, success, ...operationInput } = input;

  return {
    ...operationInput,
    responses: {
      ...success,
      ...standardResponses,
      ...responses,
    },
  };
}

export function createPublicApiOpenApiDocument(origin: string): PublicApiOpenApiDocument {
  const paths = {
    "/agents/{agentId}/files": {
      post: operation({
        description:
          "Uploads a file into the Agent API Endpoint's App draft scope before a Thread exists. Use the returned file ID in create-thread or send-events resources.",
        parameters: [exampleAgentIdParameter],
        requestBody: multipartFileRequestBody(),
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "201": jsonResponse(
            "Uploaded file.",
            { $ref: "#/components/schemas/PublicFileResponse" },
            { file: EXAMPLE_PUBLIC_FILE },
          ),
        },
        summary: "Upload an Agent file",
      }),
    },
    "/files/{fileId}/content": {
      get: operation({
        description:
          "Downloads bytes for a ready Thread attachment or Agent artifact. The file must belong to a public Thread visible to the Access Token caller.",
        parameters: [fileIdParameter, fileContentDispositionParameter],
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "200": binaryResponse("Thread file content."),
        },
        summary: "Download Thread file content",
      }),
    },
    "/files/{fileId}": {
      delete: operation({
        description:
          "Deletes a pre-Thread uploaded file or a file attached to a public Thread visible to the Access Token caller.",
        parameters: [fileIdParameter],
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "200": okResponse("Deleted."),
        },
        summary: "Delete a file",
      }),
      get: operation({
        description:
          "Returns public file metadata for a pre-Thread uploaded file or a file attached to a public Thread visible to the Access Token caller.",
        parameters: [fileIdParameter],
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "200": jsonResponse(
            "File metadata.",
            { $ref: "#/components/schemas/PublicFileResponse" },
            { file: EXAMPLE_PUBLIC_FILE },
          ),
        },
        summary: "Retrieve file metadata",
      }),
    },
    "/agents/{agentId}/threads": {
      get: operation({
        description: "Returns Threads created by the authenticated Access Token caller.",
        parameters: [
          exampleAgentIdParameter,
          {
            description:
              "Filter by archived state: true returns only archived Threads, false only active ones. Omit to return all Threads.",
            in: "query",
            name: "archived",
            schema: { type: "boolean" },
          },
        ],
        success: {
          "200": jsonResponse("Thread list.", {
            properties: {
              threads: {
                items: { $ref: "#/components/schemas/ThreadSummary" },
                maxItems: PUBLIC_THREAD_API_THREADS_MAX_LIMIT,
                type: "array",
              },
            },
            required: ["threads"],
            type: "object",
          }),
        },
        security: ACCESS_TOKEN_SECURITY,
        summary: "List Threads for an Agent API Endpoint",
      }),
      post: operation({
        description:
          "Creates a Thread and the backing AgentSession. If input is present, Mosoo also queues the initial Run. If input is omitted, the Thread is immediately visible with IDLE status and no run. Access Token callers are attributed to the token owner.",
        parameters: [exampleAgentIdParameter, idempotencyKeyParameter],
        requestBody: jsonRequestBodyExamples(
          { $ref: "#/components/schemas/CreateThreadRequest" },
          {
            emptyThread: {
              summary: "Create an empty Thread",
              value: {
                client_external_ref: "draft-empty-thread",
              },
            },
            accessTokenWithFile: {
              summary: "Access Token with an uploaded file",
              value: {
                client_external_ref: "linear-ENG-123",
                input: {
                  content: [
                    {
                      text: "Summarize the attached launch plan and list follow-ups.",
                      type: "text",
                    },
                  ],
                  type: "user.message",
                },
                resources: [{ file_id: EXAMPLE_FILE_ID, type: "file" }],
              },
            },
            accessTokenBasic: {
              summary: "Access Token",
              value: {
                client_external_ref: "demo-thread-001",
                input: {
                  content: [{ text: "Say hello from the API.", type: "text" }],
                  type: "user.message",
                },
              },
            },
            cattleAgentSameShape: {
              summary: "Cattle Agent using the same request shape",
              value: {
                input: {
                  content: [{ text: "Run this one-off Public Thread API request.", type: "text" }],
                  type: "user.message",
                },
              },
            },
          },
          { required: false },
        ),
        success: {
          "201": idempotentJsonResponse("Created Thread.", {
            $ref: "#/components/schemas/CreateThreadResponse",
          }),
        },
        summary: "Create a Thread for an Agent API Endpoint",
      }),
    },
    "/threads/{threadId}": {
      delete: operation({
        description: "Permanently deletes the Thread and its backing AgentSession.",
        parameters: [threadIdParameter],
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "200": okResponse("Deleted."),
        },
        summary: "Delete a Thread",
      }),
      get: operation({
        description: "Returns the current Thread summary, its most recent Run, and links.",
        parameters: [threadIdParameter],
        success: {
          "200": jsonResponse("Thread summary.", {
            $ref: "#/components/schemas/RetrieveThreadResponse",
          }),
        },
        summary: "Retrieve Thread summary",
      }),
    },
    "/threads/{threadId}/archive": {
      post: operation({
        description: "Archives the Thread so it is hidden from default Thread lists.",
        parameters: [threadIdParameter],
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "200": okResponse("Archived."),
        },
        summary: "Archive a Thread",
      }),
    },
    "/threads/{threadId}/events": {
      get: operation({
        description:
          "Returns the latest public event log entries for this Thread in chronological order. If older public entries are omitted because the limit was reached, `truncated` is true. Event IDs are stable, so callers can retry or poll without treating the same ID as a new event. This is the stable snapshot read surface for CLI and API consumers; it does not expose raw runtime payloads, transcript, or diagnostics.",
        parameters: [threadIdParameter, threadEventsLimitParameter],
        success: {
          "200": jsonResponse("Thread event list.", {
            $ref: "#/components/schemas/ThreadEventListResponse",
          }),
        },
        summary: "List Thread events",
      }),
      post: operation({
        description:
          "Applies a batch of events to the Thread: send user messages, answer pending permission requests, or interrupt the current Run. A user message queues a new Run when the Thread is idle.",
        parameters: [threadIdParameter, idempotencyKeyParameter],
        requestBody: jsonRequestBody(
          {
            $ref: "#/components/schemas/SendEventsRequest",
          },
          {
            events: [
              {
                text: "Say hello from the API.",
                type: "user_message",
              },
            ],
          },
        ),
        success: {
          "200": idempotentJsonResponse("Accepted event batch.", {
            $ref: "#/components/schemas/SendEventsResponse",
          }),
        },
        security: ACCESS_TOKEN_SECURITY,
        summary: "Send user messages, permission decisions, or interrupts to a Thread",
      }),
    },
    "/threads/{threadId}/events/stream": {
      get: operation({
        description:
          "Streams public Thread event log entries as Server-Sent Events. Each `thread.event` data payload uses the same ThreadEventLogEntry shape as GET /threads/{threadId}/events. Events are emitted by stable event ID and the stream suppresses duplicate IDs observed during polling. The stream is for long-running consumer UX and does not expose raw runtime payloads, internal diagnostics, or private transcripts.",
        parameters: [threadIdParameter, threadEventsLimitParameter],
        success: {
          "200": textEventStreamResponse("Thread event stream."),
        },
        summary: "Stream Thread events",
      }),
    },
    "/threads/{threadId}/files": {
      get: operation({
        description:
          "Lists files attached to the Thread, including caller attachments and Agent artifacts.",
        parameters: [threadIdParameter],
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "200": jsonResponse(
            "Thread file list.",
            { $ref: "#/components/schemas/ThreadFileListResponse" },
            { files: [EXAMPLE_SESSION_FILE] },
          ),
        },
        summary: "List Thread files",
      }),
    },
    "/threads/{threadId}/files/{fileId}": {
      delete: operation({
        description: "Detaches a file from the Thread.",
        parameters: [threadIdParameter, fileIdParameter],
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "200": okResponse("Removed."),
        },
        summary: "Remove a Thread file",
      }),
    },
    "/threads/{threadId}/unarchive": {
      post: operation({
        description: "Restores a previously archived Thread to active Thread lists.",
        parameters: [threadIdParameter],
        security: ACCESS_TOKEN_SECURITY,
        success: {
          "200": okResponse("Unarchived."),
        },
        summary: "Unarchive a Thread",
      }),
    },
  } satisfies OpenApiPaths;

  return {
    components: createPublicApiOpenApiComponents(),
    info: {
      description:
        "Public HTTPS API for creating and retrieving Threads on Mosoo Agent API Endpoints. v1 resource identifiers are bare ULIDs, not prefixed IDs. Access Tokens identify the account caller. Runtime execution resolves the Agent API Endpoint owner's capabilities while the Thread is attributed to the token owner.",
      title: "Mosoo Public Thread API",
      version: PUBLIC_API_VERSION,
    },
    openapi: "3.1.0",
    paths,
    security: ACCESS_TOKEN_SECURITY,
    servers: [{ url: `${origin}${PUBLIC_API_PREFIX}${PUBLIC_API_VERSION_PREFIX}` }],
  };
}
