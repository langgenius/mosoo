import { describe, expect, test } from "bun:test";

import { isInputObjectType, isObjectType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { startAgentRun } from "../src/modules/sessions/application/agent-run-workflow.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

async function withProviderProbeMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: [{ id: "gpt-5.4" }],
    });

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("Agent run workflow", () => {
  test("keeps the GraphQL run workflow surface stable for generated clients", () => {
    const schema = createGraphQLSchema();
    const mutation = schema.getMutationType();
    const input = schema.getType("StartAgentRunInput");
    const workflow = schema.getType("AgentRunWorkflow");
    const eventSurface = schema.getType("AgentRunEventSurface");

    if (
      !mutation ||
      !isInputObjectType(input) ||
      !isObjectType(workflow) ||
      !isObjectType(eventSurface)
    ) {
      throw new Error("Expected Agent run workflow GraphQL types.");
    }

    const startAgentRunField = mutation.getFields().startAgentRun;

    expect(startAgentRunField).toBeDefined();
    expect(String(startAgentRunField.args.find((arg) => arg.name === "input")?.type)).toBe(
      "StartAgentRunInput!",
    );
    expect(String(input.getFields().appId.type)).toBe("ULID!");
    expect(String(input.getFields().agentId.type)).toBe("ULID");
    expect(String(input.getFields().sessionId.type)).toBe("ULID");
    expect(String(input.getFields().prompt.type)).toBe("String!");
    expect(String(workflow.getFields().eventBatch.type)).toBe("AgentSessionEventBatch!");
    expect(String(workflow.getFields().run.type)).toBe("SessionRun");
    expect(String(eventSurface.getFields().processEventsOperation.type)).toBe("String!");
    expect(String(eventSurface.getFields().streamUrl.type)).toBe("String");
  });

  test("creates a Thread and queues the first run from one workflow mutation", async () => {
    const database = await createPublicHttpContractDatabase();
    const response = await withProviderProbeMock(() =>
      startAgentRun({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        executionContext: createTestExecutionContext(),
        input: {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          clientRequestId: "cli-run-1",
          prompt: "Run the checklist.",
        },
        requestUrl: "https://api.example.com/api/graphql",
        viewer: OWNER_VIEWER,
      }),
    );

    expect(response.createdSession).toBe(true);
    expect(response.session.type).toBe("ui");
    expect(response.session.status).toBe("RUNNING");
    expect(response.run?.id).toBe(response.eventBatch.events[0]?.run?.id);
    expect(response.eventBatch.events[0]).toMatchObject({
      clientRequestId: "cli-run-1",
      type: "user_message",
    });
    expect(response.eventSurface).toMatchObject({
      appId: PUBLIC_API_TEST_IDS.app,
      graphqlUrl: "https://api.example.com/api/graphql",
      messagesOperation: "threadSessionMessages",
      processEventsOperation: "threadSessionProcessEvents",
      retrieveOperation: "threadAgentSessionRetrieve",
      sessionId: response.session.id,
      streamUrl: null,
      suggestedPollIntervalMs: 1000,
    });

    const rows = await database
      .prepare(
        `
          SELECT
            (SELECT count(*) FROM "session") AS session_count,
            (SELECT count(*) FROM session_run) AS run_count,
            (SELECT count(*) FROM session_message) AS message_count
        `,
      )
      .first<{ message_count: number; run_count: number; session_count: number }>();

    expect(rows).toEqual({
      message_count: 1,
      run_count: 1,
      session_count: 1,
    });
  });

  test("continues an existing Thread without creating a second session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);

    const response = await startAgentRun({
      bindings: createPublicHttpTestBindings(database) as ApiBindings,
      executionContext: createTestExecutionContext(),
      input: {
        appId: PUBLIC_API_TEST_IDS.app,
        prompt: "Continue the existing work.",
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      },
      requestUrl: "https://api.example.com/api/graphql",
      viewer: OWNER_VIEWER,
    });

    expect(response.createdSession).toBe(false);
    expect(response.session.id).toBe(PUBLIC_API_TEST_IDS.ownerSession);
    expect(response.run).not.toBeNull();
    expect(response.eventSurface.sessionId).toBe(PUBLIC_API_TEST_IDS.ownerSession);

    const rows = await database
      .prepare(
        `
          SELECT
            (SELECT count(*) FROM "session") AS session_count,
            (SELECT count(*) FROM session_run) AS run_count
        `,
      )
      .first<{ run_count: number; session_count: number }>();

    expect(rows).toEqual({
      run_count: 1,
      session_count: 1,
    });
  });

  test("rejects Agent mismatch before queuing a run on an existing Thread", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);

    await expect(
      startAgentRun({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        executionContext: createTestExecutionContext(),
        input: {
          agentId: PUBLIC_API_TEST_IDS.file,
          appId: PUBLIC_API_TEST_IDS.app,
          prompt: "This should not queue.",
          sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        },
        requestUrl: "https://api.example.com/api/graphql",
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });

    const row = await database
      .prepare("SELECT count(*) AS count FROM session_run")
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});
