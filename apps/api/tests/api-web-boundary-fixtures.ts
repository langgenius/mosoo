import type { PublicThreadSummary } from "@mosoo/contracts/public-api";
import type { SessionFile, SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";

import { createPublicApiOpenApiDocument } from "../src/adapters/http/routes/public-api-openapi";
import { PUBLIC_API_TEST_IDS } from "./helpers/public-api-http-test-fixture";

export function createSessionSummary(): SessionSummary {
  return {
    agentId: PUBLIC_API_TEST_IDS.agent,
    archivedAt: null,
    createdAt: "2026-05-19T00:00:00.000Z",
    deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
    deploymentVersionNumber: 4,
    id: PUBLIC_API_TEST_IDS.memberSession,
    kind: "cattle",
    lastMessageAt: "2026-05-19T00:01:00.000Z",
    lastRun: createRunSummary(),
    model: "gpt-5.1",
    provider: "openai",
    appId: PUBLIC_API_TEST_IDS.app,
    runtimeId: "openai-runtime",
    status: "RUNNING",
    title: "Customer triage",
    type: "api_channel",
    updatedAt: "2026-05-19T00:01:00.000Z",
  };
}

export function createRunSummary(): SessionRunSummary {
  return {
    completedAt: null,
    createdAt: "2026-05-19T00:00:00.000Z",
    deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
    deploymentVersionNumber: 4,
    error: null,
    id: PUBLIC_API_TEST_IDS.run,
    model: "gpt-5.1",
    provider: "openai",
    startedAt: "2026-05-19T00:00:01.000Z",
    status: "running",
    traceId: "trace-1",
    trigger: "user_prompt",
    updatedAt: "2026-05-19T00:00:01.000Z",
  };
}

export function createChunkedJsonRequest(url: string, value: unknown, chunkSize: number): Request {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;

  return new Request(url, {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= encoded.byteLength) {
          controller.close();
          return;
        }

        const nextOffset = Math.min(offset + chunkSize, encoded.byteLength);
        controller.enqueue(encoded.slice(offset, nextOffset));
        offset = nextOffset;
      },
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export function createThreadSummary(): PublicThreadSummary {
  return {
    agent_id: PUBLIC_API_TEST_IDS.agent,
    attributed_user: { id: PUBLIC_API_TEST_IDS.memberAccount },
    client_external_ref: "linear-ENG-123",
    created_at: "2026-05-19T00:00:00.000Z",
    created_by: {
      id: "pat-1",
      kind: "access_token",
    },
    id: PUBLIC_API_TEST_IDS.memberSession,
    kind: "cattle",
    last_run_id: PUBLIC_API_TEST_IDS.run,
    source: "api",
    status: "RUNNING",
    title: "Customer triage",
    updated_at: "2026-05-19T00:01:00.000Z",
  };
}

function objectSchemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema["properties"];

  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error("Expected object schema with properties.");
  }

  return properties as Record<string, unknown>;
}

export function openApiSchemaProperties(schemaName: string): Record<string, unknown> {
  const document = createPublicApiOpenApiDocument("https://api.example.com");
  const schema = document.components.schemas[schemaName];

  if (!schema) {
    throw new Error(`Expected OpenAPI schema ${schemaName}.`);
  }

  return objectSchemaProperties(schema);
}

export function openApiJsonRequestExample(path: string, method: "post"): unknown {
  const document = createPublicApiOpenApiDocument("https://api.example.com");
  const operation = document.paths[path]?.[method];

  if (!operation) {
    throw new Error(`Expected ${method.toUpperCase()} ${path} OpenAPI operation.`);
  }

  const requestBody = requireRecord(operation.requestBody, `${method} ${path} request body`);
  const content = requireRecord(requestBody["content"], `${method} ${path} request content`);
  const jsonContent = requireRecord(content["application/json"], `${method} ${path} JSON content`);

  return jsonContent["example"];
}

function openApiJsonResponseContent(
  path: string,
  method: "get" | "post",
  status: string,
): Record<string, unknown> {
  const document = createPublicApiOpenApiDocument("https://api.example.com");
  const operation = document.paths[path]?.[method];

  if (!operation) {
    throw new Error(`Expected ${method.toUpperCase()} ${path} OpenAPI operation.`);
  }

  const response = requireRecord(
    operation.responses[status],
    `${method} ${path} ${status} response`,
  );
  const content = requireRecord(response["content"], `${method} ${path} ${status} content`);

  return requireRecord(content["application/json"], `${method} ${path} ${status} JSON content`);
}

export function openApiJsonResponseExample(path: string, method: "get" | "post", status: string) {
  return openApiJsonResponseContent(path, method, status)["example"];
}

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${description} to be an object.`);
  }

  return value as Record<string, unknown>;
}

export function publicThreadRequestExamples(): Array<[string, unknown]> {
  const document = createPublicApiOpenApiDocument("https://api.example.com");
  const threadOperation = document.paths["/agents/{agentId}/threads"]?.post;

  if (!threadOperation) {
    throw new Error("Expected create-thread OpenAPI operation.");
  }

  const requestBody = requireRecord(threadOperation.requestBody, "create-thread request body");
  const content = requireRecord(requestBody["content"], "create-thread request content");
  const jsonContent = requireRecord(content["application/json"], "create-thread JSON content");
  const examples = requireRecord(jsonContent["examples"], "create-thread request examples");

  return Object.entries(examples).map(([name, example]) => [
    name,
    requireRecord(example, `create-thread request example ${name}`)["value"],
  ]);
}

export function createSessionFile(): SessionFile {
  return {
    committed: true,
    createdAt: "2026-05-19T00:02:00.000Z",
    id: PUBLIC_API_TEST_IDS.file,
    kind: "attachment",
    mimeType: "text/plain",
    name: "brief.txt",
    size: 19,
  };
}
