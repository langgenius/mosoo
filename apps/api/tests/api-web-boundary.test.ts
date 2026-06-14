import { describe, expect, test } from "bun:test";

import { PUBLIC_API_ERROR_CODES } from "@mosoo/contracts/public-api";
import type { AgentSessionEventBatch } from "@mosoo/contracts/session";
import { PLATFORM_ID_INPUT_PATTERN } from "@mosoo/id";
import { isEnumType, isInputObjectType, isObjectType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import { createPublicApiOpenApiDocument } from "../src/adapters/http/routes/public-api-openapi";
import {
  parseOptionalBoolean,
  readCreateThreadRequest,
  readCreateThreadFileRequest,
  readSendEventsRequest,
} from "../src/adapters/http/routes/public-thread-api-request";
import { PublicApiError } from "../src/modules/public-api/public-api-errors";
import { toPublicThreadEventBatch } from "../src/modules/public-api/public-thread-api-presenter";
import {
  createChunkedJsonRequest,
  createRunSummary,
  createSessionFile,
  createSessionSummary,
  createThreadSummary,
  openApiJsonRequestExample,
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
  test("keeps preview runtime readiness wait scoped to GraphQL create-session input", () => {
    const schema = createGraphQLSchema();
    const createSessionInput = schema.getType("CreateAgentSessionInput");

    if (!isInputObjectType(createSessionInput)) {
      throw new Error("Expected CreateAgentSessionInput to be a GraphQL input object.");
    }

    expect(createSessionInput.getFields().waitForRuntimeReady).toBeDefined();

    const publicDocument = createPublicApiOpenApiDocument("https://api.example.com");
    expect(publicDocument.paths["/agents/{agentId}/sessions"]).toBeUndefined();
    expect(openApiSchemaProperties("CreateThreadRequest")["waitForRuntimeReady"]).toBeUndefined();
  });

  test("keeps platform ID fields on the GraphQL ULID scalar", () => {
    const schema = createGraphQLSchema();
    const session = schema.getType("Session");
    const mutation = schema.getMutationType();

    if (!isObjectType(session) || !mutation) {
      throw new Error("Expected Session and Mutation in the GraphQL schema.");
    }

    expect(String(session.getFields().appId?.type)).toBe("ULID!");
    expect(String(mutation.getFields().prewarmAgentSession?.args[0]?.type)).toBe("ULID!");
    expect(String(mutation.getFields().archiveAgentSession?.args[0]?.type)).toBe("ULID!");
  });

  test("keeps Provider credential mutations explicitly App-scoped", () => {
    const schema = createGraphQLSchema();
    const updateInput = schema.getType("UpdateVendorCredentialInput");
    const deleteInput = schema.getType("DeleteVendorCredentialInput");

    if (!isInputObjectType(updateInput) || !isInputObjectType(deleteInput)) {
      throw new Error("Expected Provider credential mutation inputs in the GraphQL schema.");
    }

    expect(String(updateInput.getFields().appId?.type)).toBe("ULID!");
    expect(String(deleteInput.getFields().appId?.type)).toBe("ULID!");
  });

  test("keeps cost GraphQL App-scoped and Organization billing-only", () => {
    const schema = createGraphQLSchema();
    const query = schema.getQueryType();

    if (!query) {
      throw new Error("Expected Query in the GraphQL schema.");
    }

    const fields = query.getFields();
    const agentCostCard = fields.agentCostCard;

    expect(fields.appCostCard).toBeDefined();
    expect(fields.organizationBillingCostCard).toBeDefined();
    expect(String(agentCostCard?.args.find((arg) => arg.name === "appId")?.type)).toBe("ULID!");
    expect(fields.memberCostCard).toBeUndefined();
    expect(fields.organizationCostCard).toBeUndefined();
    expect(fields.ownerCostCard).toBeUndefined();
  });

  test("keeps Channel GraphQL setup App-scoped with Agent-owned delivery", () => {
    const schema = createGraphQLSchema();

    for (const typeName of [
      "CreateSlackAgentChannelBindingInput",
      "CreateLarkAgentChannelBindingInput",
      "StartLarkAgentChannelRegistrationInput",
      "PollLarkAgentChannelRegistrationInput",
      "CreateTelegramAgentChannelBindingInput",
      "CreateDiscordAgentChannelBindingInput",
      "StartWeChatAgentChannelPairingInput",
      "PollWeChatAgentChannelPairingInput",
    ] as const) {
      const input = schema.getType(typeName);

      if (!isInputObjectType(input)) {
        throw new Error(`Expected ${typeName} to be a GraphQL input object.`);
      }

      expect(String(input.getFields().appId?.type)).toBe("ULID!");
      expect(String(input.getFields().agentId?.type)).toBe("ULID!");
      expect(input.getFields().organizationId).toBeUndefined();
    }

    const deleteInput = schema.getType("DeleteAgentChannelBindingInput");

    if (!isInputObjectType(deleteInput)) {
      throw new Error("Expected DeleteAgentChannelBindingInput to be a GraphQL input object.");
    }

    expect(String(deleteInput.getFields().appId?.type)).toBe("ULID!");
    expect(String(deleteInput.getFields().bindingId?.type)).toBe("ULID!");
    expect(deleteInput.getFields().agentId).toBeUndefined();
    expect(deleteInput.getFields().organizationId).toBeUndefined();
  });

  test("keeps file draft GraphQL enums App-scoped", () => {
    const schema = createGraphQLSchema();
    const scopeKind = schema.getType("FileScopeKind");
    const purpose = schema.getType("FilePurpose");

    if (!isEnumType(scopeKind) || !isEnumType(purpose)) {
      throw new Error("Expected file GraphQL enums.");
    }

    const scopeValues = scopeKind.getValues().map((value) => value.name);
    const purposeValues = purpose.getValues().map((value) => value.name);

    expect(scopeValues).toContain("app_draft");
    expect(scopeValues).not.toContain("organization_draft");
    expect(purposeValues).toContain("app_draft");
    expect(purposeValues).not.toContain("organization_draft");
  });

  test("keeps V1 GraphQL free of Organization collaboration surfaces", () => {
    const schema = createGraphQLSchema();
    const query = schema.getQueryType();
    const mutation = schema.getMutationType();
    const agentVisibility = schema.getType("AgentVisibility");
    const agentViewerRole = schema.getType("AgentViewerRole");

    if (!query || !mutation || !isEnumType(agentVisibility) || !isEnumType(agentViewerRole)) {
      throw new Error("Expected Query, Mutation, AgentVisibility, and AgentViewerRole.");
    }

    const queryFields = query.getFields();
    const mutationFields = mutation.getFields();
    const visibilityValues = agentVisibility.getValues().map((value) => value.name);
    const viewerRoleValues = agentViewerRole.getValues().map((value) => value.name);

    expect(visibilityValues).toEqual(["private"]);
    expect(viewerRoleValues).toEqual(["owner", "none"]);

    for (const fieldName of [
      "agentCollaboratorList",
      "onboardingDiscovery",
      "sessionThreadUiStateList",
    ] as const) {
      expect(queryFields[fieldName]).toBeUndefined();
    }

    for (const fieldName of [
      "addAgentCollaborator",
      "removeAgentCollaborator",
      "updateAgentPackageSharing",
      "updateAgentCollaborator",
      "updateSessionThreadUiState",
    ] as const) {
      expect(mutationFields[fieldName]).toBeUndefined();
    }

    for (const typeName of [
      "AgentCollaborator",
      "AgentCollaboratorRole",
      "AddAgentCollaboratorInput",
      "RemoveAgentCollaboratorInput",
      "UpdateAgentCollaboratorInput",
      "UpdateAgentPackageSharingInput",
      "SessionThreadUiState",
      "UpdateSessionThreadUiStateInput",
    ] as const) {
      expect(schema.getType(typeName)).toBeUndefined();
    }
  });

  test("keeps the public HTTP contract aligned with the shared public API schema", () => {
    const document = createPublicApiOpenApiDocument("https://api.example.com");

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
    const document = createPublicApiOpenApiDocument("https://api.example.com");
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

  test("documents every visible Agent API Endpoint OpenAPI field", () => {
    const document = createPublicApiOpenApiDocument("https://api.example.com");
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

  test("keeps Public Thread API request examples parseable by the public reader", async () => {
    const examples = publicThreadRequestExamples();
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

  test("keeps Public Thread file OpenAPI examples aligned with public readers and responses", async () => {
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
      id: PUBLIC_API_TEST_IDS.memberSession,
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
