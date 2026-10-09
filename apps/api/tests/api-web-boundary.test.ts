import { describe, expect, test } from "bun:test";

import {
  PUBLIC_API_ERROR_CODES,
  PUBLIC_API_OPENAPI_SCHEMAS,
  PUBLIC_API_OPENAPI_V2_SCHEMAS,
} from "@mosoo/contracts/public-api";
import type { AgentSessionEventBatch } from "@mosoo/contracts/session";
import { PLATFORM_ID_INPUT_PATTERN } from "@mosoo/id";
import { isInputObjectType, isObjectType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import { createPublicApiOpenApiDocument } from "../src/adapters/http/routes/public-api-openapi";
import {
  parseFileContentDisposition,
  parseOptionalBoolean,
  readCreateThreadRequest,
  readSendEventsRequest,
} from "../src/adapters/http/routes/public-thread-api-request";
import { PublicApiError } from "../src/modules/public-api/public-api-errors";
import { toPublicThreadEventBatch } from "../src/modules/public-api/public-thread-presenter";
import {
  createChunkedJsonRequest,
  createPublicFile,
  createRunSummary,
  createSessionFile,
  createSessionSummary,
  createThreadSummary,
  openApiJsonResponseExample,
  openApiSchemaProperties,
  publicThreadRequestExamples,
} from "./api-web-boundary-fixtures";
import { PUBLIC_API_TEST_IDS } from "./helpers/public-api-http-test-fixture";

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function expectProperties(value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    expect(hasOwnProperty(value, key)).toBe(true);
  }
}

function expectNoProperties(value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    expect(hasOwnProperty(value, key)).toBe(false);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasReadableDescription(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const description = value["description"];

  return typeof description === "string" && /[A-Za-z]/.test(description) && description.length > 16;
}

function collectOpenApiSchemaDescriptionGaps(value: unknown, path: string, gaps: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectOpenApiSchemaDescriptionGaps(item, `${path}[${index}]`, gaps),
    );
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const properties = value["properties"];

  if (isRecord(properties)) {
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      const propertyPath = `${path}.properties.${propertyName}`;

      if (!hasReadableDescription(propertySchema)) {
        gaps.push(propertyPath);
      }

      collectOpenApiSchemaDescriptionGaps(propertySchema, propertyPath, gaps);
    }
  }

  for (const key of ["items", "oneOf", "anyOf", "allOf", "additionalProperties"] as const) {
    collectOpenApiSchemaDescriptionGaps(value[key], `${path}.${key}`, gaps);
  }
}

describe("API to web boundary", () => {
  test("keeps console credential, cost and file access explicitly Project-scoped", () => {
    const schema = createGraphQLSchema();
    const projectScopedInputs = [
      "UpdateVendorCredentialInput",
      "DeleteVendorCredentialInput",
      "FileListInput",
    ].map((name) => schema.getType(name));
    const agentCostCard = schema.getQueryType()?.getFields()["agentCostCard"];

    for (const input of projectScopedInputs) {
      if (!isInputObjectType(input)) {
        throw new Error("Expected Project-scoped GraphQL inputs.");
      }

      expect(String(input.getFields()["projectId"]?.type)).toBe("ULID!");
    }
    expect(String(agentCostCard?.args.find((arg) => arg.name === "projectId")?.type)).toBe("ULID!");
  });

  test("keeps the public HTTP contract aligned with the shared public API schema", () => {
    const document = createPublicApiOpenApiDocument("https://api.example.com", "v1");

    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "https://api.example.com/api/v1" }]);
    expect(Object.keys(document.components.securitySchemes)).toEqual(["accessToken"]);
    expect(document.security).toEqual([{ accessToken: [] }]);
    for (const pathItem of Object.values(document.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (operation?.security !== undefined) {
          expect(operation.security).toEqual([{ accessToken: [] }]);
        }
      }
    }
    expectProperties(document.paths, [
      "/agents/{agentId}/files",
      "/files/{fileId}/content",
      "/files/{fileId}",
      "/agents/{agentId}/threads",
      "/threads/{threadId}",
      "/threads/{threadId}/archive",
      "/threads/{threadId}/events",
      "/threads/{threadId}/events/stream",
      "/threads/{threadId}/files",
      "/threads/{threadId}/files/{fileId}",
      "/threads/{threadId}/unarchive",
    ]);
    expect(document.paths["/files/{fileId}/complete"]).toBeUndefined();
    expect(document.paths["/threads/{threadId}/files/uploads"]).toBeUndefined();
    expect(document.paths["/threads/{threadId}/files"]?.post).toBeUndefined();

    const agentFileUploadOperation = document.paths["/agents/{agentId}/files"]?.post;
    expect(agentFileUploadOperation?.parameters?.map((parameter) => parameter.name)).toEqual([
      "agentId",
    ]);
    expect(agentFileUploadOperation?.requestBody).toMatchObject({
      content: {
        "multipart/form-data": {
          schema: {
            properties: {
              file: {
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
    });
    expect(agentFileUploadOperation?.responses["201"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/PublicFileResponse",
          },
        },
      },
    });

    const downloadContentOperation = document.paths["/files/{fileId}/content"]?.get;
    expect(downloadContentOperation?.parameters?.map((parameter) => parameter.name)).toEqual([
      "fileId",
      "disposition",
    ]);
    const dispositionParameter = downloadContentOperation?.parameters?.find(
      (parameter) => parameter.name === "disposition",
    );
    expect(dispositionParameter).toMatchObject({
      in: "query",
      schema: {
        default: "attachment",
        enum: ["attachment", "inline"],
        type: "string",
      },
    });
    expect(downloadContentOperation?.requestBody).toBeUndefined();
    expect(downloadContentOperation?.responses["200"]).toMatchObject({
      content: {
        "application/octet-stream": {
          schema: {
            format: "binary",
            type: "string",
          },
        },
      },
      headers: {
        "Cache-Control": {},
        "Content-Disposition": {},
        "Content-Length": {},
        ETag: {},
      },
    });

    const fileMetadataOperation = document.paths["/files/{fileId}"]?.get;
    expect(fileMetadataOperation?.parameters?.map((parameter) => parameter.name)).toEqual([
      "fileId",
    ]);
    expect(fileMetadataOperation?.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/PublicFileResponse",
          },
        },
      },
    });

    const deleteFileOperation = document.paths["/files/{fileId}"]?.delete;
    expect(deleteFileOperation?.parameters?.map((parameter) => parameter.name)).toEqual(["fileId"]);
    expect(deleteFileOperation?.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            properties: {
              ok: { const: true },
            },
            required: ["ok"],
            type: "object",
          },
        },
      },
    });

    const createThreadSchema = document.components.schemas.CreateThreadRequest;
    expect(Object.keys(createThreadSchema.properties).toSorted()).toEqual([
      "input",
      "resources",
      "userId",
    ]);
    expect(createThreadSchema.required).toEqual(["userId"]);
    expect(document.paths["/agents/{agentId}/threads"]?.post?.requestBody?.required).toBe(true);
    const createThreadResponseProperties = openApiSchemaProperties("CreateThreadResponse");
    expect(createThreadResponseProperties["run"]).toMatchObject({
      oneOf: [{ $ref: "#/components/schemas/RunSummary" }, { type: "null" }],
    });

    const eventStreamResponse =
      document.paths["/threads/{threadId}/events/stream"]?.get?.responses["200"];
    expect(eventStreamResponse).toMatchObject({
      content: {
        "text/event-stream": {
          schema: { type: "string" },
        },
      },
    });

    const errorCodeSchema =
      document.components.schemas.ErrorResponse.properties.error.properties.code;
    expect(errorCodeSchema).toMatchObject({ enum: PUBLIC_API_ERROR_CODES });
  });

  test("documents bare ULID public IDs in OpenAPI", () => {
    const document = createPublicApiOpenApiDocument("https://api.example.com", "v1");
    const agentIdParameter = document.paths["/agents/{agentId}/threads"]?.post?.parameters?.find(
      (parameter) => parameter.name === "agentId",
    );
    const threadIdParameter = document.paths["/threads/{threadId}"]?.get?.parameters?.find(
      (parameter) => parameter.name === "threadId",
    );
    const fileIdParameter = document.paths[
      "/threads/{threadId}/files/{fileId}"
    ]?.delete?.parameters?.find((parameter) => parameter.name === "fileId");
    const downloadContentFileIdParameter = document.paths[
      "/files/{fileId}/content"
    ]?.get?.parameters?.find((parameter) => parameter.name === "fileId");
    const metadataFileIdParameter = document.paths["/files/{fileId}"]?.get?.parameters?.find(
      (parameter) => parameter.name === "fileId",
    );

    expect(document.info.description).toContain("v1 resource identifiers are bare ULIDs");
    for (const parameter of [
      agentIdParameter,
      threadIdParameter,
      fileIdParameter,
      downloadContentFileIdParameter,
      metadataFileIdParameter,
    ]) {
      expect(parameter?.description).toContain("v1 IDs are bare ULIDs");
      expect(parameter?.schema).toMatchObject({
        format: "ulid",
        pattern: PLATFORM_ID_INPUT_PATTERN,
        type: "string",
      });
      expect(parameter?.example).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    }
  });

  test("documents every visible Agent API Endpoint OpenAPI field", () => {
    const document = createPublicApiOpenApiDocument("https://api.example.com", "v1");
    const gaps: string[] = [];

    for (const [path, pathItem] of Object.entries(document.paths)) {
      for (const [method, routeOperation] of Object.entries(pathItem)) {
        if (!isRecord(routeOperation)) {
          continue;
        }

        const operationPath = `${method.toUpperCase()} ${path}`;

        if (!hasReadableDescription(routeOperation)) {
          gaps.push(`${operationPath}.description`);
        }

        const parameters = routeOperation["parameters"];

        if (Array.isArray(parameters)) {
          parameters.forEach((parameter, index) => {
            if (!hasReadableDescription(parameter)) {
              gaps.push(`${operationPath}.parameters[${index}]`);
            }
          });
        }
      }
    }

    for (const [schemaName, schema] of Object.entries(document.components.schemas)) {
      const schemaPath = `components.schemas.${schemaName}`;

      if (!hasReadableDescription(schema)) {
        gaps.push(schemaPath);
      }

      collectOpenApiSchemaDescriptionGaps(schema, schemaPath, gaps);
    }

    expect(gaps).toEqual([]);
  });

  test("allows absent Agent provenance only in v2 responses", () => {
    expect(PUBLIC_API_OPENAPI_SCHEMAS.ThreadSummary.properties.agent_id.type).toBe("string");
    expect(PUBLIC_API_OPENAPI_V2_SCHEMAS.ThreadSummary.properties.agent_id.type).toEqual([
      "string",
      "null",
    ]);
    const sessionType = createGraphQLSchema().getType("Session");
    expect(isObjectType(sessionType)).toBe(true);
    if (!isObjectType(sessionType)) throw new Error("Session GraphQL type is missing.");
    expect(sessionType.getFields()["agentId"]?.type.toString()).toBe("ULID");
  });

  test("documents public response essentials without internal runtime fields", () => {
    const threadProperties = openApiSchemaProperties("ThreadSummary");
    expectProperties(threadProperties, [
      "agent_id",
      "id",
      "last_run_id",
      "source",
      "status",
      "userId",
    ]);
    expectNoProperties(threadProperties, [
      "attributed_user",
      "created_by",
      "deploymentVersionId",
      "deploymentVersionNumber",
      "lastMessageAt",
      "model",
      "organizationId",
      "provider",
      "runtimeId",
      "type",
    ]);

    const runProperties = openApiSchemaProperties("RunSummary");
    expectProperties(runProperties, [
      "completedAt",
      "createdAt",
      "error",
      "finalOutput",
      "id",
      "status",
      "trigger",
    ]);
    expectNoProperties(runProperties, [
      "deploymentVersionId",
      "deploymentVersionNumber",
      "model",
      "provider",
      "traceId",
    ]);

    const runErrorProperties = openApiSchemaProperties("RunError");
    expectProperties(runErrorProperties, ["code", "message", "retryable"]);
    expectNoProperties(runErrorProperties, [
      "details",
      "provider",
      "raw",
      "runtime",
      "tool",
      "traceId",
    ]);

    const eventProperties = openApiSchemaProperties("ThreadEventLogEntry");
    expectProperties(eventProperties, ["content", "id", "occurredAt", "runId", "status", "type"]);

    const sendEventsProperties = openApiSchemaProperties("SendEventsResponse");
    expectProperties(sendEventsProperties, ["acceptedAt", "events", "thread", "warnings"]);

    const fileProperties = openApiSchemaProperties("ThreadFile");
    expectProperties(fileProperties, ["committed", "createdAt", "id", "kind", "name", "size"]);
    expectNoProperties(fileProperties, ["objectKey", "path", "scopeId", "scopeKind"]);

    const publicFileProperties = openApiSchemaProperties("PublicFile");
    expectProperties(publicFileProperties, ["createdAt", "id", "mimeType", "name", "size"]);
    expectNoProperties(publicFileProperties, [
      "committed",
      "createdBy",
      "etag",
      "expiresAt",
      "objectKey",
      "owner",
      "path",
      "purpose",
      "scope",
      "scopeId",
      "scopeKind",
      "sessionKind",
      "status",
      "updatedAt",
      "version",
    ]);

    const fileResourceProperties = openApiSchemaProperties("FileResource");
    expectProperties(fileResourceProperties, ["file_id", "type"]);
    expectNoProperties(fileResourceProperties, ["mountPath", "purpose", "scopeKind"]);
  });

  test("parses the Public Thread API create-work body shape", async () => {
    await expect(
      readCreateThreadRequest(
        {
          req: {
            raw: new Request(
              `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
              {
                body: JSON.stringify({
                  userId: "customer-123",
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
              },
            ),
          },
        },
        "v1",
      ),
    ).resolves.toEqual({
      fileIds: [],
      userId: "customer-123",
    });

    await expect(
      readCreateThreadRequest(
        {
          req: {
            raw: new Request(
              `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
              {
                body: JSON.stringify({
                  input: {
                    content: [{ text: "Summarize the launch plan.", type: "text" }],
                    type: "user.message",
                  },
                  resources: [{ file_id: PUBLIC_API_TEST_IDS.file, type: "file" }],
                  userId: "customer-123",
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
              },
            ),
          },
        },
        "v1",
      ),
    ).resolves.toEqual({
      fileIds: [PUBLIC_API_TEST_IDS.file],
      inputText: "Summarize the launch plan.",
      userId: "customer-123",
    });

    await expect(
      readCreateThreadRequest(
        {
          req: {
            raw: new Request(
              `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
              {
                body: JSON.stringify({
                  userId: "   ",
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
              },
            ),
          },
        },
        "v1",
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });

    await expect(
      readCreateThreadRequest(
        {
          req: {
            raw: new Request(
              `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
              {
                body: JSON.stringify({
                  input: {
                    content: [{ text: "Do the work.", type: "text" }],
                    type: "user.message",
                  },
                  repo: "https://example.com/repo.git",
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
              },
            ),
          },
        },
        "v1",
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });

  test("parses chunked Public Thread API create-work bodies", async () => {
    const parsed = await readCreateThreadRequest(
      {
        req: {
          raw: createChunkedJsonRequest(
            `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
            {
              resources: [
                { file_id: PUBLIC_API_TEST_IDS.file, type: "file" },
                { file_id: PUBLIC_API_TEST_IDS.fileAlt, type: "file" },
              ],
              input: {
                content: [
                  { text: "Summarize the launch plan.", type: "text" },
                  { text: "List two follow-ups.", type: "text" },
                ],
                type: "user.message",
              },
              userId: "customer-123",
            },
            7,
          ),
        },
      },
      "v1",
    );

    expect(parsed).toEqual({
      fileIds: [PUBLIC_API_TEST_IDS.file, PUBLIC_API_TEST_IDS.fileAlt],
      inputText: "Summarize the launch plan.\nList two follow-ups.",
      userId: "customer-123",
    });
  });

  test("keeps Public Thread API request examples parseable by the public reader", async () => {
    const examples = publicThreadRequestExamples();
    let hasFileExample = false;

    expect(examples.length).toBeGreaterThanOrEqual(3);

    for (const [name, value] of examples) {
      const parsed = await readCreateThreadRequest(
        {
          req: {
            raw: new Request(
              `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads#${name}`,
              {
                body: JSON.stringify(value),
                headers: { "Content-Type": "application/json" },
                method: "POST",
              },
            ),
          },
        },
        "v1",
      );

      if (name === "emptyThread") {
        expect(parsed.inputText).toBeUndefined();
      } else {
        expect(parsed.inputText?.length).toBeGreaterThan(0);
      }
      expect(parsed.userId.length).toBeGreaterThan(0);
      expect(Array.isArray(parsed.fileIds)).toBe(true);
      hasFileExample ||= (parsed.fileIds?.length ?? 0) > 0;
    }

    expect(hasFileExample).toBe(true);
  });

  test("keeps Public Thread file OpenAPI examples aligned with public responses", () => {
    const publicFile = createPublicFile();
    const sessionFile = createSessionFile();

    expect(openApiJsonResponseExample("/agents/{agentId}/files", "post", "201")).toEqual({
      file: publicFile,
    });
    expect(openApiJsonResponseExample("/files/{fileId}", "get", "200")).toEqual({
      file: publicFile,
    });
    expect(openApiJsonResponseExample("/threads/{threadId}/files", "get", "200")).toEqual({
      files: [sessionFile],
    });
  });

  test("accepts the three public thread event input shapes", async () => {
    await expect(
      readSendEventsRequest({
        req: {
          json: async () => ({
            events: [
              {
                requestId: "client-1",
                resources: [{ file_id: PUBLIC_API_TEST_IDS.file, type: "file" }],
                text: "hello",
                type: "user_message",
              },
              {
                decision: "allow_once",
                requestId: "permission-1",
                type: "permission_decision",
              },
              {
                runId: null,
                type: "user_interrupt",
              },
            ],
          }),
        },
      }),
    ).resolves.toEqual({
      events: [
        {
          requestId: "client-1",
          resources: [{ file_id: PUBLIC_API_TEST_IDS.file, type: "file" }],
          text: "hello",
          type: "user_message",
        },
        {
          decision: "allow_once",
          requestId: "permission-1",
          type: "permission_decision",
        },
        {
          runId: null,
          type: "user_interrupt",
        },
      ],
    });
  });

  test("rejects unsupported Public API request fields", async () => {
    await expect(
      readSendEventsRequest({
        req: {
          json: async () => ({
            events: [
              {
                text: "hello",
                type: "user_message",
              },
            ],
            metadata: { source: "external" },
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });

    await expect(
      readSendEventsRequest({
        req: {
          json: async () => ({
            events: [
              {
                attachmentIds: [PUBLIC_API_TEST_IDS.file],
                text: "hello",
                type: "user_message",
              },
            ],
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });

    await expect(
      readSendEventsRequest({
        req: {
          json: async () => ({
            events: [
              {
                mountPath: "/workspace/brief.txt",
                text: "hello",
                type: "user_message",
              },
            ],
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });

    await expect(
      readCreateThreadRequest(
        {
          req: {
            raw: new Request(
              `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
              {
                body: JSON.stringify({
                  files: [{ file_id: PUBLIC_API_TEST_IDS.file }],
                  input: {
                    content: [{ text: "Do the work.", type: "text" }],
                    type: "user.message",
                  },
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
              },
            ),
          },
        },
        "v1",
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });

    await expect(
      readCreateThreadRequest(
        {
          req: {
            raw: new Request(
              `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
              {
                body: JSON.stringify({
                  resources: [{ file_id: PUBLIC_API_TEST_IDS.file, type: "mount" }],
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
              },
            ),
          },
        },
        "v1",
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });

  test("uses stable public errors for invalid public API inputs", async () => {
    expect(parseOptionalBoolean(undefined)).toBeNull();
    expect(parseOptionalBoolean("true")).toBe(true);
    expect(parseOptionalBoolean("false")).toBe(false);
    expect(parseFileContentDisposition(undefined)).toBe("attachment");
    expect(parseFileContentDisposition("attachment")).toBe("attachment");
    expect(parseFileContentDisposition("inline")).toBe("inline");

    try {
      parseOptionalBoolean("yes");
      throw new Error("Expected parseOptionalBoolean to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicApiError);
      expect(error).toMatchObject({
        code: "invalid_request",
        status: 400,
      });
    }

    try {
      parseFileContentDisposition("download");
      throw new Error("Expected parseFileContentDisposition to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicApiError);
      expect(error).toMatchObject({
        code: "invalid_request",
        status: 400,
      });
    }

    await expect(
      readSendEventsRequest({
        req: {
          json: async () => ({
            events: [],
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });

  test("presents public thread responses without leaking internal runtime fields", () => {
    const batch = {
      acceptedAt: "2026-05-19T00:00:02.000Z",
      events: [
        {
          clientRequestId: "client-1",
          run: createRunSummary(),
          type: "user_message",
        },
      ],
      session: createSessionSummary(),
      warnings: [],
    } satisfies AgentSessionEventBatch;

    const publicBatch = toPublicThreadEventBatch({
      batch,
      thread: createThreadSummary(),
    });

    expect(publicBatch.thread).toMatchObject({
      agent_id: PUBLIC_API_TEST_IDS.agent,
      id: PUBLIC_API_TEST_IDS.nonOwnerSession,
      source: "api",
    });
    expectNoProperties(publicBatch.thread, [
      "deploymentVersionId",
      "deploymentVersionNumber",
      "lastMessageAt",
      "model",
      "organizationId",
      "provider",
      "runtimeId",
      "type",
    ]);

    const eventRun = publicBatch.events[0]?.run;
    if (!eventRun) {
      throw new Error("Expected public event run.");
    }

    expect(eventRun).toMatchObject({
      error: null,
      finalOutput: null,
      id: PUBLIC_API_TEST_IDS.run,
      status: "running",
      trigger: "user_prompt",
    });
    expectNoProperties(eventRun, [
      "deploymentVersionId",
      "deploymentVersionNumber",
      "model",
      "provider",
      "traceId",
    ]);
  });
});
