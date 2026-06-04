import { PLATFORM_ID_INPUT_PATTERN } from "@mosoo/id";

import { AGENT_KIND_VALUES } from "../agent/agent.contract.ts";
import {
  PUBLIC_API_ERROR_CODES,
  PUBLISHED_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
  PUBLISHED_THREAD_EVENT_LOG_STATUSES,
  PUBLISHED_THREAD_EVENT_LOG_TYPES,
  PUBLISHED_THREAD_FILE_ID_MAX_LENGTH,
  PUBLISHED_THREAD_INPUT_TEXT_MAX_LENGTH,
} from "./public-api-core.contract";

export type PublishedAgentOpenApiSchema = Record<string, unknown>;

export interface PublicApiPlatformIdSchemaOptions {
  example?: string | undefined;
  maxLength?: number | undefined;
  minLength?: number | undefined;
}

export function createPublicApiPlatformIdSchema(
  options: PublicApiPlatformIdSchemaOptions = {},
): PublishedAgentOpenApiSchema {
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

export const PUBLISHED_AGENT_OPENAPI_SCHEMAS = {
  ThreadEventInput: {
    oneOf: [
      {
        additionalProperties: false,
        properties: {
          attachmentIds: { items: PLATFORM_ID_SCHEMA, type: "array" },
          clientRequestId: { type: ["string", "null"] },
          text: { minLength: 1, type: "string" },
          type: { const: "user_message" },
        },
        required: ["type", "text"],
        type: "object",
      },
      {
        additionalProperties: false,
        properties: {
          decision: { enum: ["allow_once", "reject_once"] },
          requestId: { minLength: 1, type: "string" },
          type: { const: "permission_decision" },
        },
        required: ["type", "requestId", "decision"],
        type: "object",
      },
      {
        additionalProperties: false,
        properties: {
          runId: { oneOf: [PLATFORM_ID_SCHEMA, { type: "null" }] },
          type: { const: "user_interrupt" },
        },
        required: ["type"],
        type: "object",
      },
    ],
  },
  SendEventsRequest: {
    additionalProperties: false,
    properties: {
      events: {
        items: { $ref: "#/components/schemas/ThreadEventInput" },
        minItems: 1,
        type: "array",
      },
    },
    required: ["events"],
    type: "object",
  },
  CreateThreadFileRequest: {
    additionalProperties: false,
    properties: {
      fileId: {
        ...createPublicApiPlatformIdSchema({
          maxLength: PUBLISHED_THREAD_FILE_ID_MAX_LENGTH,
          minLength: 1,
        }),
      },
    },
    required: ["fileId"],
    type: "object",
  },
  ErrorResponse: {
    properties: {
      error: {
        properties: {
          code: { enum: PUBLIC_API_ERROR_CODES },
          message: { type: "string" },
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
    properties: {
      acceptedAt: { format: "date-time", type: "string" },
      events: {
        items: { $ref: "#/components/schemas/ThreadEventResult" },
        type: "array",
      },
      thread: { $ref: "#/components/schemas/ThreadSummary" },
      warnings: {
        items: { $ref: "#/components/schemas/UserWarning" },
        type: "array",
      },
    },
    required: ["acceptedAt", "events", "thread", "warnings"],
    type: "object",
  },
  ThreadEventLogEntry: {
    additionalProperties: false,
    properties: {
      content: { type: "string" },
      durationMs: { type: ["integer", "null"] },
      id: PLATFORM_ID_SCHEMA,
      occurredAt: { format: "date-time", type: "string" },
      status: { enum: PUBLISHED_THREAD_EVENT_LOG_STATUSES },
      tokens: { type: ["integer", "null"] },
      type: { enum: PUBLISHED_THREAD_EVENT_LOG_TYPES },
    },
    required: ["content", "durationMs", "id", "occurredAt", "status", "tokens", "type"],
    type: "object",
  },
  ThreadEventListResponse: {
    additionalProperties: false,
    properties: {
      events: {
        items: { $ref: "#/components/schemas/ThreadEventLogEntry" },
        type: "array",
      },
      truncated: { type: "boolean" },
    },
    required: ["events", "truncated"],
    type: "object",
  },
  ThreadEventResult: {
    additionalProperties: false,
    properties: {
      clientRequestId: { type: ["string", "null"] },
      run: {
        oneOf: [{ $ref: "#/components/schemas/RunSummary" }, { type: "null" }],
      },
      type: { enum: ["permission_decision", "user_interrupt", "user_message"] },
    },
    required: ["clientRequestId", "run", "type"],
    type: "object",
  },
  CreateThreadRequest: {
    additionalProperties: false,
    properties: {
      client_external_ref: {
        maxLength: PUBLISHED_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
        type: "string",
      },
      files: {
        description: "Draft file handles uploaded by the same Personal Access Token caller.",
        items: {
          additionalProperties: false,
          properties: {
            file_id: {
              ...createPublicApiPlatformIdSchema({
                maxLength: PUBLISHED_THREAD_FILE_ID_MAX_LENGTH,
                minLength: 1,
              }),
            },
          },
          required: ["file_id"],
          type: "object",
        },
        type: "array",
      },
      input: {
        additionalProperties: false,
        properties: {
          content: {
            items: {
              additionalProperties: false,
              properties: {
                text: {
                  maxLength: PUBLISHED_THREAD_INPUT_TEXT_MAX_LENGTH,
                  minLength: 1,
                  type: "string",
                },
                type: { const: "text" },
              },
              required: ["type", "text"],
              type: "object",
            },
            minItems: 1,
            type: "array",
          },
          type: { const: "user.message" },
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
    properties: {
      links: { $ref: "#/components/schemas/ThreadLinks" },
      run: {
        oneOf: [{ $ref: "#/components/schemas/RunSummary" }, { type: "null" }],
      },
      thread: { $ref: "#/components/schemas/ThreadSummary" },
    },
    required: ["links", "run", "thread"],
    type: "object",
  },
  RetrieveThreadResponse: {
    additionalProperties: false,
    properties: {
      links: { $ref: "#/components/schemas/ThreadLinks" },
      run: {
        oneOf: [{ $ref: "#/components/schemas/RunSummary" }, { type: "null" }],
      },
      thread: { $ref: "#/components/schemas/ThreadSummary" },
    },
    required: ["links", "run", "thread"],
    type: "object",
  },
  ThreadFile: {
    additionalProperties: false,
    properties: {
      committed: { type: "boolean" },
      createdAt: { format: "date-time", type: "string" },
      id: PLATFORM_ID_SCHEMA,
      kind: {
        description:
          "Files added through the public API are attachments; artifacts are files produced by the Agent.",
        enum: ["attachment", "artifact"],
      },
      mimeType: { type: ["string", "null"] },
      name: { type: "string" },
      size: { minimum: 0, type: "integer" },
    },
    required: ["committed", "createdAt", "id", "kind", "mimeType", "name", "size"],
    type: "object",
  },
  ThreadFileListResponse: {
    additionalProperties: false,
    properties: {
      files: {
        items: { $ref: "#/components/schemas/ThreadFile" },
        type: "array",
      },
    },
    required: ["files"],
    type: "object",
  },
  ThreadFileResponse: {
    additionalProperties: false,
    properties: {
      file: { $ref: "#/components/schemas/ThreadFile" },
    },
    required: ["file"],
    type: "object",
  },
  ThreadAttributedUser: {
    additionalProperties: false,
    properties: {
      id: PLATFORM_ID_SCHEMA,
    },
    required: ["id"],
    type: "object",
  },
  ThreadCaller: {
    additionalProperties: false,
    properties: {
      id: PLATFORM_ID_SCHEMA,
      kind: { enum: ["human_pat"] },
    },
    required: ["id", "kind"],
    type: "object",
  },
  ThreadLinks: {
    additionalProperties: false,
    properties: {
      thread: { type: "string" },
    },
    required: ["thread"],
    type: "object",
  },
  ThreadSummary: {
    additionalProperties: false,
    properties: {
      agent_id: PLATFORM_ID_SCHEMA,
      attributed_user: {
        oneOf: [{ $ref: "#/components/schemas/ThreadAttributedUser" }, { type: "null" }],
      },
      client_external_ref: { type: ["string", "null"] },
      created_at: { format: "date-time", type: "string" },
      created_by: { $ref: "#/components/schemas/ThreadCaller" },
      id: PLATFORM_ID_SCHEMA,
      kind: { enum: AGENT_KIND_VALUES },
      last_run_id: { oneOf: [PLATFORM_ID_SCHEMA, { type: "null" }] },
      source: { const: "api" },
      status: { enum: ["IDLE", "RUNNING", "RESCHEDULING", "TERMINATED"] },
      title: { type: ["string", "null"] },
      updated_at: { format: "date-time", type: "string" },
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
    properties: {
      completedAt: { format: "date-time", type: ["string", "null"] },
      createdAt: { format: "date-time", type: "string" },
      id: PLATFORM_ID_SCHEMA,
      startedAt: { format: "date-time", type: ["string", "null"] },
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
      trigger: { enum: ["user_prompt", "retry", "resume", "system"] },
      updatedAt: { format: "date-time", type: "string" },
    },
    required: ["completedAt", "createdAt", "id", "startedAt", "status", "trigger", "updatedAt"],
    type: "object",
  },
  UserWarning: {
    additionalProperties: false,
    properties: {
      code: { type: "string" },
      message: { type: "string" },
    },
    required: ["code", "message"],
    type: "object",
  },
} satisfies Record<string, PublishedAgentOpenApiSchema>;
