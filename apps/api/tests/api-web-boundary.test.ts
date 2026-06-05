import { describe, expect, test } from "bun:test";

import { PUBLIC_API_ERROR_CODES } from "@mosoo/contracts/public-api";
import type { AgentSessionEventBatch } from "@mosoo/contracts/session";
import { PLATFORM_ID_INPUT_PATTERN } from "@mosoo/id";
import { isInputObjectType, isObjectType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import {
  parseOptionalBoolean,
  readCreateThreadRequest,
  readCreateThreadFileRequest,
  readSendEventsRequest,
} from "../src/adapters/http/routes/published-agent-api-request";
import { createPublishedAgentOpenApiDocument } from "../src/adapters/http/routes/published-agent-openapi";
import { PublishedAgentApiError } from "../src/modules/public-api/published-agent-api-errors";
import { toPublishedEventBatch } from "../src/modules/public-api/published-agent-api-presenter";
import {
  createChunkedJsonRequest,
  createRunSummary,
  createSessionFile,
  createSessionSummary,
  createThreadSummary,
  openApiJsonRequestExample,
  openApiJsonResponseExample,
  openApiSchemaProperties,
  publishedThreadRequestExamples,
} from "./api-web-boundary-fixtures";
import { PUBLIC_API_TEST_IDS } from "./helpers/published-agent-http-test-fixture";

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

describe("API to web boundary", () => {
  test("keeps preview runtime readiness wait scoped to GraphQL create-session input", () => {
    const schema = createGraphQLSchema();
    const createSessionInput = schema.getType("CreateAgentSessionInput");

    if (!isInputObjectType(createSessionInput)) {
      throw new Error("Expected CreateAgentSessionInput to be a GraphQL input object.");
    }

    expect(createSessionInput.getFields().waitForRuntimeReady).toBeDefined();

    const publicDocument = createPublishedAgentOpenApiDocument("https://api.example.com");
    expect(publicDocument.paths["/agents/{agentId}/sessions"]).toBeUndefined();
    expect(openApiSchemaProperties("CreateThreadRequest")["waitForRuntimeReady"]).toBeUndefined();
  });

  test("keeps platform ID fields on the GraphQL ULID scalar", () => {
    const schema = createGraphQLSchema();
    const collaborator = schema.getType("Collaborator");
    const mutation = schema.getMutationType();

    if (!isObjectType(collaborator) || !mutation) {
      throw new Error("Expected Collaborator and Mutation in the GraphQL schema.");
    }

    expect(String(collaborator.getFields().assignedBy?.type)).toBe("ULID");
    expect(String(mutation.getFields().prewarmAgentSession?.args[0]?.type)).toBe("ULID!");
  });

  test("keeps the published HTTP contract aligned with the shared public API schema", () => {
    const document = createPublishedAgentOpenApiDocument("https://api.example.com");

    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "https://api.example.com/api/v1" }]);
    expectProperties(document.paths, [
      "/agents/{agentId}/threads",
      "/threads/{threadId}",
      "/threads/{threadId}/archive",
      "/threads/{threadId}/events",
      "/threads/{threadId}/events/stream",
      "/threads/{threadId}/files",
      "/threads/{threadId}/files/{fileId}",
      "/threads/{threadId}/unarchive",
    ]);

    const createThreadSchema = document.components.schemas.CreateThreadRequest;
    expect(createThreadSchema.required).not.toContain("input");
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
    expect(
      Object.keys(document.components.schemas).filter((name) => name.includes("Task")),
    ).toEqual([]);
    expect(document.paths["/agents/{agentId}/tasks"]).toBeUndefined();
    expect(document.paths["/tasks/{taskId}"]).toBeUndefined();
  });

  test("documents bare ULID public IDs in OpenAPI", () => {
    const document = createPublishedAgentOpenApiDocument("https://api.example.com");
    const agentIdParameter = document.paths["/agents/{agentId}/threads"]?.post?.parameters?.find(
      (parameter) => parameter.name === "agentId",
    );
    const threadIdParameter = document.paths["/threads/{threadId}"]?.get?.parameters?.find(
      (parameter) => parameter.name === "threadId",
    );
    const fileIdParameter = document.paths[
      "/threads/{threadId}/files/{fileId}"
    ]?.delete?.parameters?.find((parameter) => parameter.name === "fileId");

    expect(document.info.description).toContain("v1 resource identifiers are bare ULIDs");
    for (const parameter of [agentIdParameter, threadIdParameter, fileIdParameter]) {
      expect(parameter?.description).toContain("v1 IDs are bare ULIDs");
      expect(parameter?.schema).toMatchObject({
        format: "ulid",
        pattern: PLATFORM_ID_INPUT_PATTERN,
        type: "string",
      });
      expect(parameter?.example).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    }
  });

  test("documents public response essentials without internal runtime fields", () => {
    const threadProperties = openApiSchemaProperties("ThreadSummary");
    expectProperties(threadProperties, [
      "agent_id",
      "attributed_user",
      "created_by",
      "id",
      "last_run_id",
      "source",
      "status",
    ]);
    expectNoProperties(threadProperties, [
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
    expectProperties(runProperties, ["completedAt", "createdAt", "id", "status", "trigger"]);
    expectNoProperties(runProperties, [
      "deploymentVersionId",
      "deploymentVersionNumber",
      "error",
      "model",
      "provider",
      "traceId",
    ]);

    const sendEventsProperties = openApiSchemaProperties("SendEventsResponse");
    expectProperties(sendEventsProperties, ["acceptedAt", "events", "thread", "warnings"]);

    const fileProperties = openApiSchemaProperties("ThreadFile");
    expectProperties(fileProperties, ["committed", "createdAt", "id", "kind", "name", "size"]);
    expectNoProperties(fileProperties, ["objectKey", "path", "scopeId", "scopeKind"]);
  });

  test("parses the Public Thread API create-work body shape", async () => {
    await expect(
      readCreateThreadRequest({
        req: {
          raw: new Request(
            `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
            {
              body: JSON.stringify({
                client_external_ref: "empty-thread-draft",
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            },
          ),
        },
      }),
    ).resolves.toEqual({
      clientExternalRef: "empty-thread-draft",
      fileIds: [],
    });

    await expect(
      readCreateThreadRequest({
        req: {
          raw: new Request(
            `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
            {
              body: JSON.stringify({
                client_external_ref: "linear-ENG-123",
                files: [{ file_id: PUBLIC_API_TEST_IDS.file }],
                input: {
                  content: [{ text: "Summarize the launch plan.", type: "text" }],
                  type: "user.message",
                },
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            },
          ),
        },
      }),
    ).resolves.toEqual({
      clientExternalRef: "linear-ENG-123",
      fileIds: [PUBLIC_API_TEST_IDS.file],
      inputText: "Summarize the launch plan.",
    });

    await expect(
      readCreateThreadRequest({
        req: {
          raw: new Request(
            `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
            {
              body: JSON.stringify({
                attributed_user_id: PUBLIC_API_TEST_IDS.memberAccount,
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
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });

    await expect(
      readCreateThreadRequest({
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
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });

  test("parses chunked Public Thread API create-work bodies", async () => {
    const parsed = await readCreateThreadRequest({
      req: {
        raw: createChunkedJsonRequest(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
          {
            files: [
              { file_id: PUBLIC_API_TEST_IDS.file },
              { file_id: PUBLIC_API_TEST_IDS.fileAlt },
            ],
            input: {
              content: [
                { text: "Summarize the launch plan.", type: "text" },
                { text: "List two follow-ups.", type: "text" },
              ],
              type: "user.message",
            },
          },
          7,
        ),
      },
    });

    expect(parsed).toEqual({
      fileIds: [PUBLIC_API_TEST_IDS.file, PUBLIC_API_TEST_IDS.fileAlt],
      inputText: "Summarize the launch plan.\nList two follow-ups.",
    });
  });

  test("keeps published thread OpenAPI request examples parseable by the public reader", async () => {
    const examples = publishedThreadRequestExamples();
    let hasFileExample = false;

    expect(examples.length).toBeGreaterThanOrEqual(3);

    for (const [name, value] of examples) {
      const parsed = await readCreateThreadRequest({
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
      });

      if (name === "emptyThread") {
        expect(parsed.inputText).toBeUndefined();
      } else {
        expect(parsed.inputText?.length).toBeGreaterThan(0);
      }
      expect(Array.isArray(parsed.fileIds)).toBe(true);
      hasFileExample ||= (parsed.fileIds?.length ?? 0) > 0;
    }

    expect(hasFileExample).toBe(true);
  });

  test("keeps published session file OpenAPI examples aligned with public readers and responses", async () => {
    const requestExample = openApiJsonRequestExample("/threads/{threadId}/files", "post");
    const sessionFile = createSessionFile();

    await expect(
      readCreateThreadFileRequest({
        req: {
          raw: new Request(
            `https://api.example.com/api/v1/threads/${PUBLIC_API_TEST_IDS.memberSession}/files`,
            {
              body: JSON.stringify(requestExample),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            },
          ),
        },
      }),
    ).resolves.toEqual({
      fileId: PUBLIC_API_TEST_IDS.file,
    });

    expect(openApiJsonResponseExample("/threads/{threadId}/files", "get", "200")).toEqual({
      files: [sessionFile],
    });
    expect(openApiJsonResponseExample("/threads/{threadId}/files", "post", "201")).toEqual({
      file: sessionFile,
    });
  });

  test("accepts the three public thread event input shapes", async () => {
    await expect(
      readSendEventsRequest({
        req: {
          json: async () => ({
            events: [
              {
                attachmentIds: [PUBLIC_API_TEST_IDS.file],
                clientRequestId: "client-1",
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
          attachmentIds: [PUBLIC_API_TEST_IDS.file],
          clientRequestId: "client-1",
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

  test("rejects unsupported Published Agent public request fields", async () => {
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
      readCreateThreadFileRequest({
        req: {
          raw: new Request(
            `https://api.example.com/api/v1/threads/${PUBLIC_API_TEST_IDS.memberSession}/files`,
            {
              body: JSON.stringify({
                contentBase64: "SGVsbG8=",
                contentType: "text/plain",
                mountPath: "/workspace/brief.txt",
                name: "brief.txt",
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            },
          ),
        },
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });

  test("uses stable public errors for invalid public API inputs", async () => {
    expect(parseOptionalBoolean(undefined)).toBeNull();
    expect(parseOptionalBoolean("true")).toBe(true);
    expect(parseOptionalBoolean("false")).toBe(false);

    try {
      parseOptionalBoolean("yes");
      throw new Error("Expected parseOptionalBoolean to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(PublishedAgentApiError);
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

    const published = toPublishedEventBatch({
      batch,
      thread: createThreadSummary(),
    });

    expect(published.thread).toMatchObject({
      agent_id: PUBLIC_API_TEST_IDS.agent,
      id: PUBLIC_API_TEST_IDS.memberSession,
      source: "api",
    });
    expectNoProperties(published.thread, [
      "deploymentVersionId",
      "deploymentVersionNumber",
      "lastMessageAt",
      "model",
      "organizationId",
      "provider",
      "runtimeId",
      "type",
    ]);

    const eventRun = published.events[0]?.run;
    if (!eventRun) {
      throw new Error("Expected published event run.");
    }

    expect(eventRun).toMatchObject({
      id: PUBLIC_API_TEST_IDS.run,
      status: "running",
      trigger: "user_prompt",
    });
    expectNoProperties(eventRun, [
      "deploymentVersionId",
      "deploymentVersionNumber",
      "error",
      "model",
      "provider",
      "traceId",
    ]);
  });
});
