import { describe, expect, test } from "bun:test";

import { PUBLIC_THREAD_API_THREADS_MAX_LIMIT } from "@mosoo/contracts/public-api";
import { sessionRunsTable, sessionsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { fileStore } from "../src/modules/files/application/file-store";
import {
  PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE,
  enforcePublicApiRateLimit,
} from "../src/modules/public-api/public-api-rate-limit.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PublicApiMemoryFileBucket,
  PUBLIC_API_TEST_IDS,
  TOKENS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/public-api-http-test-fixture";
import {
  OWNER_VIEWER,
  bearer,
  createPublicThreadApiTestApp,
  expectArray,
  expectRecord,
  expectString,
  insertRuntimeEvent,
  readJson,
  requestPublicApi,
  withProviderProbeMock,
} from "./public-thread-api-fixtures";

const PUBLIC_THREAD_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

type PublicHttpTestDatabase = Awaited<ReturnType<typeof createPublicHttpContractDatabase>>;

async function createReadyAppDraftFile(input: {
  body: string;
  bucket: PublicApiMemoryFileBucket;
  database: PublicHttpTestDatabase;
  name: string;
}): Promise<string> {
  const bindings = createPublicHttpTestBindings(input.database, {
    fileBucket: input.bucket as unknown as R2Bucket,
  }) as ApiBindings;
  const fileBytes = new TextEncoder().encode(input.body);
  const upload = await fileStore.createUpload(bindings, OWNER_VIEWER, {
    file: {
      contentType: "text/plain",
      name: input.name,
      size: fileBytes.byteLength,
    },
    purpose: "app_draft",
    target: {
      id: PUBLIC_API_TEST_IDS.app,
      kind: "app_draft",
      name: input.name,
    },
  });
  const uploadBody = new Request("https://api.example.com/upload", {
    body: input.body,
    method: "POST",
  }).body;

  await fileStore.putContent(bindings, OWNER_VIEWER, upload.fileId, uploadBody);
  await fileStore.completeUpload({
    bindings,
    fileId: upload.fileId,
    input: {},
    viewer: OWNER_VIEWER,
  });

  return upload.fileId;
}

async function createPendingAppDraftFile(input: {
  body: string;
  bucket: PublicApiMemoryFileBucket;
  database: PublicHttpTestDatabase;
  name: string;
}): Promise<string> {
  const bindings = createPublicHttpTestBindings(input.database, {
    fileBucket: input.bucket as unknown as R2Bucket,
  }) as ApiBindings;
  const fileBytes = new TextEncoder().encode(input.body);
  const upload = await fileStore.createUpload(bindings, OWNER_VIEWER, {
    file: {
      contentType: "text/plain",
      name: input.name,
      size: fileBytes.byteLength,
    },
    purpose: "app_draft",
    target: {
      id: PUBLIC_API_TEST_IDS.app,
      kind: "app_draft",
      name: input.name,
    },
  });

  return upload.fileId;
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function expectNoProperties(value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    expect(hasOwnProperty(value, key)).toBe(false);
  }
}

function generatedPublicThreadId(index: number): string {
  const high = Math.floor(
    index / (PUBLIC_THREAD_ID_ALPHABET.length * PUBLIC_THREAD_ID_ALPHABET.length),
  );
  const middle =
    Math.floor(index / PUBLIC_THREAD_ID_ALPHABET.length) % PUBLIC_THREAD_ID_ALPHABET.length;
  const low = index % PUBLIC_THREAD_ID_ALPHABET.length;

  if (high >= PUBLIC_THREAD_ID_ALPHABET.length) {
    throw new Error("Public Thread fixture exhausted generated Thread IDs.");
  }

  const highDigit = PUBLIC_THREAD_ID_ALPHABET[high];
  const middleDigit = PUBLIC_THREAD_ID_ALPHABET[middle];
  const lowDigit = PUBLIC_THREAD_ID_ALPHABET[low];

  return `01J00000000000000000020${highDigit}${middleDigit}${lowDigit}`;
}

async function countPublicApiRateLimitRequests(
  database: PublicHttpTestDatabase,
  tokenId: string,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COALESCE(SUM(request_count), 0) AS request_count
         FROM public_api_rate_limit_window
        WHERE bucket_key = ?`,
    )
    .bind(`public_api:${tokenId}`)
    .first<{ request_count: number }>();

  return row?.request_count ?? 0;
}

async function countPublicApiIdempotencyRows(
  database: PublicHttpTestDatabase,
  tokenId: string,
  idempotencyKey: string,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS row_count
         FROM public_api_idempotency_key
        WHERE token_id = ?
          AND idempotency_key = ?`,
    )
    .bind(tokenId, idempotencyKey)
    .first<{ row_count: number }>();

  return row?.row_count ?? 0;
}

async function insertPublicThread(
  database: PublicHttpTestDatabase,
  input: {
    id: string;
    title: string;
    updatedAt: number;
  },
): Promise<void> {
  await database
    .app()
    .insert(sessionsTable)
    .values({
      agentId: PUBLIC_API_TEST_IDS.agent,
      archivedAt: null,
      attributedUserId: null,
      createdAt: input.updatedAt,
      creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      id: input.id,
      kind: "pet",
      lastMessageAt: null,
      lastRunId: null,
      metadataJson: JSON.stringify({
        public_api: {
          client_external_ref: null,
          created_by: {
            account_id: PUBLIC_API_TEST_IDS.ownerAccount,
            id: PUBLIC_API_TEST_IDS.ownerAccount,
            kind: "human_pat",
            token_id: PUBLIC_API_TEST_IDS.patOwner,
            token_label: PUBLIC_API_TEST_IDS.patOwner,
          },
          source: "public_api",
        },
      }),
      model: "gpt-5.4",
      appId: PUBLIC_API_TEST_IDS.app,
      provider: "openai",
      renamed: false,
      runtimeId: "openai-runtime",
      status: "IDLE",
      title: input.title,
      type: "api_channel",
      updatedAt: input.updatedAt,
    })
    .run();
}

async function expectCreateThreadFileClaimRejected(input: {
  fileId: string;
  message: string;
  requestThreadApi: (request: Request) => Promise<Response>;
  threadId: string;
}): Promise<void> {
  const response = await input.requestThreadApi(
    new Request(`https://api.example.com/api/v1/threads/${input.threadId}/events`, {
      body: JSON.stringify({
        events: [
          {
            resources: [{ file_id: input.fileId, type: "file" }],
            text: "Read the file.",
            type: "user_message",
          },
        ],
      }),
      headers: {
        Authorization: bearer(TOKENS.owner),
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
  expect(response.status).toBe(400);
  expect(expectRecord(await readJson(response))["error"]).toMatchObject({
    code: "invalid_request",
    message: input.message,
  });
}

describe("Public Thread API e2e", () => {
  test("creates, retrieves, and lists a Thread without a Task wrapper", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();

    await withProviderProbeMock(async () => {
      const response = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            client_external_ref: "linear-ENG-123",
            input: {
              content: [{ text: "Summarize the launch plan.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
            "Idempotency-Key": "thread-create-1",
          },
          method: "POST",
        }),
      );
      expect(response.status).toBe(201);

      const body = await readJson(response);
      const thread = expectRecord(body["thread"]);
      const run = expectRecord(body["run"]);
      const links = expectRecord(body["links"]);
      const threadId = expectString(thread["id"]);
      expect(thread).toMatchObject({
        agent_id: PUBLIC_API_TEST_IDS.agent,
        attributed_user: { id: PUBLIC_API_TEST_IDS.ownerAccount },
        client_external_ref: "linear-ENG-123",
        created_by: { id: PUBLIC_API_TEST_IDS.ownerAccount, kind: "access_token" },
        id: threadId,
        source: "api",
      });
      expect(threadId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(run["id"]).toBeString();
      expect(run["trigger"]).toBe("user_prompt");
      expect(run["error"]).toBeNull();
      expect(run["finalOutput"]).toBeNull();
      expectNoProperties(run, [
        "deploymentVersionId",
        "deploymentVersionNumber",
        "model",
        "provider",
        "traceId",
      ]);
      expect(links).toEqual({ thread: `/api/v1/threads/${threadId}` });

      const sessionRow = await database
        .prepare(
          `SELECT attributed_user_id, last_run_id, metadata_json
             FROM session
            WHERE id = ?`,
        )
        .bind(threadId)
        .first<{
          attributed_user_id: string | null;
          last_run_id: string | null;
          metadata_json: string;
        }>();
      expect(sessionRow).not.toBeNull();
      expect(sessionRow).toMatchObject({
        attributed_user_id: PUBLIC_API_TEST_IDS.ownerAccount,
        last_run_id: run["id"],
      });
      const metadata = expectRecord(JSON.parse(expectString(sessionRow?.metadata_json)));
      expect(metadata["public_api"]).toMatchObject({
        client_external_ref: "linear-ENG-123",
        created_by: { id: PUBLIC_API_TEST_IDS.ownerAccount, kind: "access_token" },
        source: "public_api",
      });

      const retrieveResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(retrieveResponse.status).toBe(200);
      expect(expectRecord((await readJson(retrieveResponse))["thread"])["id"]).toBe(threadId);

      await database.prepare("DELETE FROM session_event WHERE session_id = ?").bind(threadId).run();

      const emptyEventsResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(emptyEventsResponse.status).toBe(200);
      expect(await readJson(emptyEventsResponse)).toEqual({
        events: [],
        truncated: false,
      });

      const runId = expectString(run["id"]);
      await insertRuntimeEvent(database, {
        kind: "run.started",
        occurredAt: 1_000,
        payload: {
          startedAt: "1970-01-01T00:00:01.000Z",
        },
        runId,
        seq: 1,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 1_050,
        payload: {
          content: "Hello from runtime",
          messageId: "assistant-1",
          role: "agent",
        },
        runId,
        seq: 2,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "run.completed",
        occurredAt: 1_125,
        payload: { stopReason: "debug" },
        runId,
        seq: 3,
        sessionId: threadId,
        visibility: "owner_debug",
      });
      await insertRuntimeEvent(database, {
        kind: "run.completed",
        occurredAt: 1_150,
        payload: { stopReason: "end_turn" },
        runId,
        seq: 4,
        sessionId: threadId,
      });

      const eventsResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events?limit=2`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(eventsResponse.status).toBe(200);
      const eventsBody = await readJson(eventsResponse);
      expect(eventsBody["truncated"]).toBe(true);
      const events = expectArray(eventsBody["events"]);
      expect(events).toHaveLength(2);
      expect(events.map((event) => expectRecord(event)["type"])).toEqual([
        "agent.message.delta",
        "run.completed",
      ]);
      expect(events.map((event) => expectRecord(event)["content"])).toEqual([
        "Hello from runtime",
        runId,
      ]);
      expect(events.map((event) => expectRecord(event)["runId"])).toEqual([runId, runId]);

      await database
        .app()
        .update(sessionRunsTable)
        .set({
          completedAt: 1_150,
          status: "completed",
          updatedAt: 1_150,
        })
        .where(eq(sessionRunsTable.id, runId))
        .run();

      const completedRetrieveResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(completedRetrieveResponse.status).toBe(200);
      const completedRun = expectRecord(
        expectRecord(await readJson(completedRetrieveResponse))["run"],
      );
      expect(completedRun).toMatchObject({
        error: null,
        finalOutput: { text: "Hello from runtime" },
        id: runId,
        status: "completed",
      });

      const repeatedRetrieveResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      const repeatedRun = expectRecord(
        expectRecord(await readJson(repeatedRetrieveResponse))["run"],
      );
      expect(repeatedRun["finalOutput"]).toEqual({ text: "Hello from runtime" });

      const listResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(listResponse.status).toBe(200);
      expect(expectArray(expectRecord(await readJson(listResponse))["threads"]).length).toBe(1);

      const taskRouteResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/tasks/${threadId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(taskRouteResponse.status).toBe(404);

      const taskCreateRouteResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/tasks`, {
          body: JSON.stringify({
            input: {
              content: [{ text: "This legacy route must not exist.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(taskCreateRouteResponse.status).toBe(404);

      const ownerEventsResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(ownerEventsResponse.status).toBe(200);

      const nonOwnerCreateResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            input: {
              content: [{ text: "Non-owner callers must not get API access.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.nonOwner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(nonOwnerCreateResponse.status).toBe(403);
      expect(expectRecord(await readJson(nonOwnerCreateResponse))["error"]).toMatchObject({
        code: "forbidden",
        message: "Caller is not the App owner for this Agent.",
      });

      const staleAclCreateResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            input: {
              content: [{ text: "Legacy grants must not get API access.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.legacyGrant),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(staleAclCreateResponse.status).toBe(403);
      expect(expectRecord(await readJson(staleAclCreateResponse))["error"]).toMatchObject({
        code: "forbidden",
        message: "Caller is not the App owner for this Agent.",
      });
    });
  });

  test("exposes failed run status without internal error details", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();

    await withProviderProbeMock(async () => {
      const response = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            input: {
              content: [{ text: "Trigger a failed public run.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(response.status).toBe(201);
      const body = await readJson(response);
      const threadId = expectString(expectRecord(body["thread"])["id"]);
      const runId = expectString(expectRecord(body["run"])["id"]);

      await database
        .app()
        .update(sessionRunsTable)
        .set({
          completedAt: 2_000,
          errorCode: "provider_unavailable",
          errorDetailsJson: JSON.stringify({
            provider: "openai",
            raw: "debug response",
            runtime: "driver",
            tool: "search",
            traceId: "trace-123",
          }),
          errorMessage: "Provider is temporarily unavailable.",
          status: "failed",
          updatedAt: 2_000,
        })
        .where(eq(sessionRunsTable.id, runId))
        .run();

      const retrieveResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(retrieveResponse.status).toBe(200);
      const run = expectRecord(expectRecord(await readJson(retrieveResponse))["run"]);
      const error = expectRecord(run["error"]);

      expect(run).toMatchObject({
        error: {
          code: "provider_unavailable",
          message: "Provider is temporarily unavailable.",
          retryable: false,
        },
        finalOutput: null,
        id: runId,
        status: "failed",
      });
      expectNoProperties(run, [
        "deploymentVersionId",
        "deploymentVersionNumber",
        "model",
        "provider",
        "traceId",
      ]);
      expectNoProperties(error, ["details", "provider", "raw", "runtime", "tool", "traceId"]);
    });
  });

  test("creates an empty Thread and starts its first run from a user message event", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const createEmptyThreadRequest = () =>
      new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
        body: JSON.stringify({
          client_external_ref: "draft-empty-thread",
        }),
        headers: {
          Authorization: bearer(TOKENS.owner),
          "Content-Type": "application/json",
          "Idempotency-Key": "empty-thread-create-1",
        },
        method: "POST",
      });

    await withProviderProbeMock(async () => {
      const response = await requestPublicApi(app, database, createEmptyThreadRequest());
      expect(response.status).toBe(201);

      const body = await readJson(response);
      expect(body["run"]).toBeNull();
      const thread = expectRecord(body["thread"]);
      const threadId = expectString(thread["id"]);
      expect(thread).toMatchObject({
        client_external_ref: "draft-empty-thread",
        last_run_id: null,
        status: "IDLE",
        title: null,
      });

      const sessionRow = await database
        .prepare(
          `SELECT last_message_at, last_run_id, status, title
             FROM session
            WHERE id = ?`,
        )
        .bind(threadId)
        .first<{
          last_message_at: number | null;
          last_run_id: string | null;
          status: string;
          title: string | null;
        }>();
      expect(sessionRow).toEqual({
        last_message_at: null,
        last_run_id: null,
        status: "IDLE",
        title: null,
      });

      const runCount = await database
        .prepare(
          `SELECT COUNT(*) AS row_count
             FROM session_run
            WHERE session_id = ?`,
        )
        .bind(threadId)
        .first<{ row_count: number }>();
      expect(runCount?.row_count).toBe(0);

      const replayResponse = await requestPublicApi(app, database, createEmptyThreadRequest());
      expect(replayResponse.status).toBe(201);
      expect(replayResponse.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await readJson(replayResponse)).toEqual(body);

      const retrieveResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(retrieveResponse.status).toBe(200);
      const retrieved = await readJson(retrieveResponse);
      expect(retrieved["run"]).toBeNull();
      expect(expectRecord(retrieved["thread"])).toMatchObject({
        id: threadId,
        last_run_id: null,
        status: "IDLE",
        title: null,
      });

      const firstMessageResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          body: JSON.stringify({
            events: [
              {
                clientRequestId: "first-message",
                text: "Start the work now.",
                type: "user_message",
              },
            ],
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(firstMessageResponse.status).toBe(200);
      const firstMessageBody = await readJson(firstMessageResponse);
      const firstEvent = expectRecord(expectArray(firstMessageBody["events"])[0]);
      expect(firstEvent["clientRequestId"]).toBe("first-message");
      expect(expectRecord(firstEvent["run"])["trigger"]).toBe("user_prompt");

      const zeroBodyResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          headers: { Authorization: bearer(TOKENS.owner) },
          method: "POST",
        }),
      );
      expect(zeroBodyResponse.status).toBe(201);
      const zeroBodyThread = expectRecord(expectRecord(await readJson(zeroBodyResponse))["thread"]);
      expect(zeroBodyThread).toMatchObject({
        last_run_id: null,
        status: "IDLE",
        title: null,
      });
    });
  });

  test("streams Thread events as public SSE entries", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();

    await withProviderProbeMock(async () => {
      const response = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            input: {
              content: [{ text: "Create a streamable Thread.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(response.status).toBe(201);
      const body = await readJson(response);
      const threadId = expectString(expectRecord(body["thread"])["id"]);
      const runId = expectString(expectRecord(body["run"])["id"]);

      await database.prepare("DELETE FROM session_event WHERE session_id = ?").bind(threadId).run();
      await insertRuntimeEvent(database, {
        kind: "run.started",
        occurredAt: 3_000,
        payload: {
          startedAt: "1970-01-01T00:00:03.000Z",
        },
        runId,
        seq: 1,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 3_050,
        payload: {
          content: "Initial stream history A",
          messageId: "assistant-stream-initial-1",
          role: "agent",
        },
        runId,
        seq: 2,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 3_100,
        payload: {
          content: "Initial stream history B",
          messageId: "assistant-stream-initial-2",
          role: "agent",
        },
        runId,
        seq: 3,
        sessionId: threadId,
      });

      const streamResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream?limit=1`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers.get("Content-Type")).toContain("text/event-stream");
      const reader = streamResponse.body?.getReader();
      if (!reader) {
        throw new Error("Expected stream response body.");
      }

      await reader.read();

      await insertRuntimeEvent(database, {
        kind: "run.completed",
        occurredAt: 3_150,
        payload: { stopReason: "private-diagnostic" },
        runId,
        seq: 4,
        sessionId: threadId,
        visibility: "owner_debug",
      });
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 3_200,
        payload: {
          content: "Live stream delta A",
          messageId: "assistant-stream-live-1",
          role: "agent",
        },
        runId,
        seq: 5,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "run.completed",
        occurredAt: 3_250,
        payload: { stopReason: "end_turn" },
        runId,
        seq: 6,
        sessionId: threadId,
      });

      let text = "";
      for (
        let index = 0;
        index < 8 && !text.includes("id: 01J00000000000000000000015");
        index += 1
      ) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        text += new TextDecoder().decode(chunk.value);
      }
      await reader.cancel();
      expect(text).toContain("event: thread.event");
      expect(text).toContain("id: 01J00000000000000000000012");
      expect(text).not.toContain("id: 01J00000000000000000000013");
      expect(text).toContain("id: 01J00000000000000000000014");
      expect(text).toContain("id: 01J00000000000000000000015");
      expect(text).toContain('"type":"agent.message.delta"');
      expect(text).toContain('"type":"run.completed"');
      expect(text).toContain(`"runId":"${runId}"`);
      expect(text).toContain('"content":"');
      expect(text).not.toContain("owner_debug");
      expect(text).not.toContain("payload");
      expect(text).not.toContain("private-diagnostic");
      expect(text).not.toContain("traceId");
    });
  });

  test("bounds public Thread lists on stable latest ordering", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();

    for (let index = 0; index < PUBLIC_THREAD_API_THREADS_MAX_LIMIT + 5; index += 1) {
      const suffix = String(index).padStart(3, "0");

      await insertPublicThread(database, {
        id: generatedPublicThreadId(index),
        title: `Public Thread ${suffix}`,
        updatedAt: 1000 + index,
      });
    }

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );

    expect(response.status).toBe(200);

    const threads = expectArray(expectRecord(await readJson(response))["threads"]);

    expect(threads).toHaveLength(PUBLIC_THREAD_API_THREADS_MAX_LIMIT);
    expect(expectRecord(threads[0])["id"]).toBe(
      generatedPublicThreadId(PUBLIC_THREAD_API_THREADS_MAX_LIMIT + 4),
    );
    expect(expectRecord(threads.at(-1))["id"]).toBe(generatedPublicThreadId(5));
  });

  test("archives, unarchives, and manages Thread files through the public routes", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const bucket = new PublicApiMemoryFileBucket();
    const requestThreadApi = (request: Request) =>
      requestPublicApi(app, database, request, { fileBucket: bucket as unknown as R2Bucket });

    await withProviderProbeMock(async () => {
      const createThreadResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            client_external_ref: "thread-files-lifecycle",
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(createThreadResponse.status).toBe(201);
      const threadId = expectString(
        expectRecord(expectRecord(await readJson(createThreadResponse))["thread"])["id"],
      );

      const emptyFilesResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/files`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(emptyFilesResponse.status).toBe(200);
      expect(await readJson(emptyFilesResponse)).toEqual({ files: [] });

      const formData = new FormData();
      formData.set(
        "file",
        new File([new TextEncoder().encode("Launch note.\n")], "launch-note.txt", {
          type: "text/plain",
        }),
      );
      const uploadFileResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/files`, {
          body: formData,
          headers: { Authorization: bearer(TOKENS.owner) },
          method: "POST",
        }),
      );
      expect(uploadFileResponse.status).toBe(201);
      const fileId = expectString(
        expectRecord(expectRecord(await readJson(uploadFileResponse))["file"])["id"],
      );
      const appDraftFileRow = await database
        .prepare("SELECT object_key FROM file_record WHERE id = ?")
        .bind(fileId)
        .first<{ object_key: string }>();
      if (!appDraftFileRow) {
        throw new Error("Expected Agent draft file row.");
      }

      const sendEventResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          body: JSON.stringify({
            events: [
              {
                resources: [{ file_id: fileId, type: "file" }],
                text: "Read the attached launch note.",
                type: "user_message",
              },
            ],
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(sendEventResponse.status).toBe(200);
      const sendEvent = expectRecord(
        expectArray(expectRecord(await readJson(sendEventResponse))["events"])[0],
      );
      expect(sendEvent["type"]).toBe("user_message");
      expect(["queued", "running"]).toContain(expectRecord(sendEvent["run"])["status"]);

      const readyFileRow = await database
        .prepare(
          `SELECT expires_at, object_key, owner_id, owner_kind, path, purpose, scope_id, scope_kind, session_kind, status
             FROM file_record
            WHERE id = ?`,
        )
        .bind(fileId)
        .first<{
          expires_at: number | null;
          object_key: string;
          owner_id: string;
          owner_kind: string;
          path: string;
          purpose: string;
          scope_id: string;
          scope_kind: string;
          session_kind: string;
          status: string;
        }>();
      expect(readyFileRow).toMatchObject({
        expires_at: null,
        owner_id: threadId,
        owner_kind: "session",
        purpose: "session_attachment",
        scope_id: threadId,
        scope_kind: "session",
        session_kind: "attachment",
        status: "ready",
      });
      if (!readyFileRow) {
        throw new Error("Expected ready public Thread file row.");
      }
      expectString(readyFileRow.object_key);
      expectString(readyFileRow.path);
      expect(bucket.objects.has(readyFileRow.object_key)).toBe(true);
      expect(bucket.objects.has(appDraftFileRow.object_key)).toBe(false);

      const artifactObjectKey = `session/${threadId}/artifact/${PUBLIC_API_TEST_IDS.fileAlt}/summary.md`;

      await database
        .prepare(
          `
            INSERT INTO file_record (
              id,
              scope_kind,
              scope_id,
              session_kind,
              status,
              name,
              path,
              parent_path,
              object_key,
              owner_id,
              owner_kind,
              purpose,
              expires_at,
              mime_type,
              size,
              etag,
              committed,
              version,
              created_by_account_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          PUBLIC_API_TEST_IDS.fileAlt,
          "session",
          threadId,
          "artifact",
          "ready",
          "summary.md",
          `artifact/${PUBLIC_API_TEST_IDS.fileAlt}/summary.md`,
          `artifact/${PUBLIC_API_TEST_IDS.fileAlt}`,
          artifactObjectKey,
          threadId,
          "session",
          "session_artifact",
          null,
          "text/markdown",
          23,
          null,
          1,
          1,
          PUBLIC_API_TEST_IDS.ownerAccount,
          2,
          2,
        )
        .run();
      await bucket.put(artifactObjectKey, "runtime summary", {
        httpMetadata: {
          contentType: "text/markdown",
        },
      });
      expect(bucket.objects.has(artifactObjectKey)).toBe(true);

      const listedFilesResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/files`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(listedFilesResponse.status).toBe(200);
      const listedFiles = expectArray(expectRecord(await readJson(listedFilesResponse))["files"]);
      expect(listedFiles).toHaveLength(2);
      const listedFilesById = new Map(
        listedFiles.map((listedFile) => {
          const listedFileRecord = expectRecord(listedFile);
          return [expectString(listedFileRecord["id"]), listedFileRecord];
        }),
      );
      expect(listedFilesById.get(fileId)).toMatchObject({
        id: fileId,
        kind: "attachment",
        name: "launch-note.txt",
        size: 13,
      });
      expect(listedFilesById.get(PUBLIC_API_TEST_IDS.fileAlt)).toMatchObject({
        id: PUBLIC_API_TEST_IDS.fileAlt,
        kind: "artifact",
        name: "summary.md",
        size: 23,
      });

      const downloadAttachmentResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/files/${fileId}/content`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(downloadAttachmentResponse.status).toBe(200);
      expect(downloadAttachmentResponse.headers.get("cache-control")).toBe("no-store");
      expect(downloadAttachmentResponse.headers.get("content-type")).toStartWith("text/plain");
      expect(downloadAttachmentResponse.headers.get("content-disposition")).toContain(
        'attachment; filename="launch-note.txt"',
      );
      expect(await downloadAttachmentResponse.text()).toBe("Launch note.\n");

      const downloadArtifactResponse = await requestThreadApi(
        new Request(
          `https://api.example.com/api/v1/files/${PUBLIC_API_TEST_IDS.fileAlt}/content?disposition=inline`,
          {
            headers: { Authorization: bearer(TOKENS.owner) },
          },
        ),
      );
      expect(downloadArtifactResponse.status).toBe(200);
      expect(downloadArtifactResponse.headers.get("cache-control")).toBe("no-store");
      expect(downloadArtifactResponse.headers.get("content-type")).toBe("text/markdown");
      expect(downloadArtifactResponse.headers.get("content-disposition")).toContain(
        'inline; filename="summary.md"',
      );
      expect(await downloadArtifactResponse.text()).toBe("runtime summary");

      const nonOwnerDownloadResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/files/${fileId}/content`, {
          headers: { Authorization: bearer(TOKENS.nonOwner) },
        }),
      );
      expect(nonOwnerDownloadResponse.status).toBe(404);
      expect(expectRecord(await readJson(nonOwnerDownloadResponse))["error"]).toMatchObject({
        code: "not_found",
      });

      const deleteFileResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/files/${fileId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
          method: "DELETE",
        }),
      );
      expect(deleteFileResponse.status).toBe(200);
      expect(await readJson(deleteFileResponse)).toEqual({ ok: true });
      expect(bucket.objects.has(readyFileRow.object_key)).toBe(false);

      const deleteArtifactResponse = await requestThreadApi(
        new Request(
          `https://api.example.com/api/v1/threads/${threadId}/files/${PUBLIC_API_TEST_IDS.fileAlt}`,
          {
            headers: { Authorization: bearer(TOKENS.owner) },
            method: "DELETE",
          },
        ),
      );
      expect(deleteArtifactResponse.status).toBe(200);
      expect(await readJson(deleteArtifactResponse)).toEqual({ ok: true });
      expect(bucket.objects.has(artifactObjectKey)).toBe(false);

      const archiveResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/archive`, {
          headers: { Authorization: bearer(TOKENS.owner) },
          method: "POST",
        }),
      );
      expect(archiveResponse.status).toBe(200);
      expect(await readJson(archiveResponse)).toEqual({ ok: true });

      const activeListResponse = await requestThreadApi(
        new Request(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads?archived=false`,
          {
            headers: { Authorization: bearer(TOKENS.owner) },
          },
        ),
      );
      expect(activeListResponse.status).toBe(200);
      expect(expectRecord(await readJson(activeListResponse))["threads"]).toEqual([]);

      const archivedListResponse = await requestThreadApi(
        new Request(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads?archived=true`,
          {
            headers: { Authorization: bearer(TOKENS.owner) },
          },
        ),
      );
      expect(archivedListResponse.status).toBe(200);
      expect(
        expectArray(expectRecord(await readJson(archivedListResponse))["threads"]).map(
          (thread) => expectRecord(thread)["id"],
        ),
      ).toEqual([threadId]);

      const unarchiveResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/unarchive`, {
          headers: { Authorization: bearer(TOKENS.owner) },
          method: "POST",
        }),
      );
      expect(unarchiveResponse.status).toBe(200);
      expect(await readJson(unarchiveResponse)).toEqual({ ok: true });

      const unarchivedRow = await database
        .prepare("SELECT archived_at FROM session WHERE id = ?")
        .bind(threadId)
        .first<{ archived_at: number | null }>();
      expect(unarchivedRow).toEqual({ archived_at: null });
    });
  });

  test("uploads an Agent file and attaches it to the first Thread message", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const bucket = new PublicApiMemoryFileBucket();
    const requestThreadApi = (request: Request) =>
      requestPublicApi(app, database, request, { fileBucket: bucket as unknown as R2Bucket });

    await withProviderProbeMock(async () => {
      const fileBody = "Launch note.\n";
      const fileBytes = new TextEncoder().encode(fileBody);
      const fileSize = fileBytes.byteLength;
      const formData = new FormData();
      formData.set("file", new File([fileBytes], "launch-note.txt", { type: "text/plain" }));

      const uploadFileResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/files`, {
          body: formData,
          headers: {
            Authorization: bearer(TOKENS.owner),
          },
          method: "POST",
        }),
      );
      expect(uploadFileResponse.status).toBe(201);
      const uploadedFile = expectRecord(expectRecord(await readJson(uploadFileResponse))["file"]);
      const fileId = expectString(uploadedFile["id"]);
      expect(uploadedFile).toMatchObject({
        name: "launch-note.txt",
        size: fileSize,
      });
      expectString(uploadedFile["createdAt"]);
      expect(expectString(uploadedFile["mimeType"])).toStartWith("text/plain");
      expectNoProperties(uploadedFile, [
        "committed",
        "createdBy",
        "etag",
        "objectKey",
        "path",
        "purpose",
        "scope",
        "status",
        "version",
      ]);

      const appDraftFileRow = await database
        .prepare(
          `SELECT committed, object_key, owner_id, owner_kind, purpose, scope_id, scope_kind, session_kind, status
             FROM file_record
            WHERE id = ?`,
        )
        .bind(fileId)
        .first<{
          committed: number;
          object_key: string;
          owner_id: string;
          owner_kind: string;
          purpose: string;
          scope_id: string;
          scope_kind: string;
          session_kind: string | null;
          status: string;
        }>();
      expect(appDraftFileRow).toMatchObject({
        committed: 0,
        owner_id: PUBLIC_API_TEST_IDS.app,
        owner_kind: "app",
        purpose: "app_draft",
        scope_id: PUBLIC_API_TEST_IDS.app,
        scope_kind: "app_draft",
        session_kind: "attachment",
        status: "ready",
      });
      if (!appDraftFileRow) {
        throw new Error("Expected ready Agent draft file row.");
      }
      expect(await bucket.get(appDraftFileRow.object_key).then((object) => object?.text())).toBe(
        fileBody,
      );

      const retrieveDraftResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/files/${fileId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(retrieveDraftResponse.status).toBe(200);
      const retrievedDraftFile = expectRecord(
        expectRecord(await readJson(retrieveDraftResponse))["file"],
      );
      expect(retrievedDraftFile).toMatchObject({
        id: fileId,
        name: "launch-note.txt",
        size: fileSize,
      });
      expect(expectString(retrievedDraftFile["mimeType"])).toStartWith("text/plain");

      const draftDownloadResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/files/${fileId}/content`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(draftDownloadResponse.status).toBe(404);
      expect(expectRecord(await readJson(draftDownloadResponse))["error"]).toMatchObject({
        code: "not_found",
      });

      const createThreadResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            client_external_ref: "thread-upload-first-message",
            input: {
              content: [{ text: "Read the attached launch note.", type: "text" }],
              type: "user.message",
            },
            resources: [{ file_id: fileId, type: "file" }],
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(createThreadResponse.status).toBe(201);
      const createThreadPayload = expectRecord(await readJson(createThreadResponse));
      const threadId = expectString(expectRecord(createThreadPayload["thread"])["id"]);
      expect(["queued", "running"]).toContain(expectRecord(createThreadPayload["run"])["status"]);

      const claimedFileRow = await database
        .prepare(
          `SELECT committed, expires_at, object_key, owner_id, owner_kind, path, purpose, scope_id, scope_kind, session_kind, status
             FROM file_record
            WHERE id = ?`,
        )
        .bind(fileId)
        .first<{
          committed: number;
          expires_at: number | null;
          object_key: string;
          owner_id: string;
          owner_kind: string;
          path: string;
          purpose: string;
          scope_id: string;
          scope_kind: string;
          session_kind: string;
          status: string;
        }>();
      expect(claimedFileRow).toMatchObject({
        committed: 1,
        expires_at: null,
        owner_id: threadId,
        owner_kind: "session",
        purpose: "session_attachment",
        scope_id: threadId,
        scope_kind: "session",
        session_kind: "attachment",
        status: "ready",
      });
      if (!claimedFileRow) {
        throw new Error("Expected claimed public Thread file row.");
      }
      expectString(claimedFileRow.object_key);
      expectString(claimedFileRow.path);
      expect(bucket.objects.has(appDraftFileRow.object_key)).toBe(false);
      expect(await bucket.get(claimedFileRow.object_key).then((object) => object?.text())).toBe(
        fileBody,
      );

      const downloadContentResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/files/${fileId}/content?disposition=inline`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(downloadContentResponse.status).toBe(200);
      expect(downloadContentResponse.headers.get("cache-control")).toBe("no-store");
      expect(downloadContentResponse.headers.get("content-length")).toBe(String(fileSize));
      expect(downloadContentResponse.headers.get("content-type")).toStartWith("text/plain");
      expect(downloadContentResponse.headers.get("content-disposition")).toContain(
        'inline; filename="launch-note.txt"',
      );
      expect(await downloadContentResponse.text()).toBe(fileBody);

      const invalidDispositionResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/files/${fileId}/content?disposition=download`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(invalidDispositionResponse.status).toBe(400);
      expect(expectRecord(await readJson(invalidDispositionResponse))["error"]).toMatchObject({
        code: "invalid_request",
        message: "File content disposition must be attachment or inline.",
      });

      const listedFilesResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/files`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(listedFilesResponse.status).toBe(200);
      expect(expectArray(expectRecord(await readJson(listedFilesResponse))["files"])).toEqual([
        expect.objectContaining({
          id: fileId,
          kind: "attachment",
          name: "launch-note.txt",
          size: fileSize,
        }),
      ]);

      const deleteFileResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/files/${fileId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
          method: "DELETE",
        }),
      );
      expect(deleteFileResponse.status).toBe(200);
      expect(await readJson(deleteFileResponse)).toEqual({ ok: true });
      expect(bucket.objects.has(claimedFileRow.object_key)).toBe(false);
    });
  });

  test("rejects public Thread file claims that are not claimable owner drafts", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const bucket = new PublicApiMemoryFileBucket();
    const requestThreadApi = (request: Request) =>
      requestPublicApi(app, database, request, { fileBucket: bucket as unknown as R2Bucket });
    const threadId = generatedPublicThreadId(130);

    await insertPublicThread(database, {
      id: threadId,
      title: "File claim guard public Thread",
      updatedAt: 2_100,
    });

    const wrongCreatorFileId = await createReadyAppDraftFile({
      body: "Wrong creator draft.\n",
      bucket,
      database,
      name: "wrong-creator.txt",
    });
    await database
      .prepare("UPDATE file_record SET created_by_account_id = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerAccount, wrongCreatorFileId)
      .run();
    await expectCreateThreadFileClaimRejected({
      fileId: wrongCreatorFileId,
      message: `Attachment ${wrongCreatorFileId} was not found.`,
      requestThreadApi,
      threadId,
    });

    const wrongAppFileId = await createReadyAppDraftFile({
      body: "Wrong app draft.\n",
      bucket,
      database,
      name: "wrong-app.txt",
    });
    const wrongAppId = "01J0000000000000000000BAD2";
    await database
      .prepare("UPDATE file_record SET owner_id = ?, scope_id = ? WHERE id = ?")
      .bind(wrongAppId, wrongAppId, wrongAppFileId)
      .run();
    await expectCreateThreadFileClaimRejected({
      fileId: wrongAppFileId,
      message: `Attachment ${wrongAppFileId} is not a draft attachment.`,
      requestThreadApi,
      threadId,
    });

    const nonDraftFileId = await createReadyAppDraftFile({
      body: "Claimed draft.\n",
      bucket,
      database,
      name: "claimed-draft.txt",
    });
    await database
      .prepare(
        `UPDATE file_record
            SET committed = 1,
                owner_id = ?,
                owner_kind = 'session',
                purpose = 'session_attachment',
                scope_id = ?,
                scope_kind = 'session',
                session_kind = 'attachment'
          WHERE id = ?`,
      )
      .bind(threadId, threadId, nonDraftFileId)
      .run();
    await expectCreateThreadFileClaimRejected({
      fileId: nonDraftFileId,
      message: `Attachment ${nonDraftFileId} is not a draft attachment.`,
      requestThreadApi,
      threadId,
    });

    const notReadyFileId = await createPendingAppDraftFile({
      body: "Pending draft.\n",
      bucket,
      database,
      name: "pending-draft.txt",
    });
    await expectCreateThreadFileClaimRejected({
      fileId: notReadyFileId,
      message: `Attachment ${notReadyFileId} is not ready.`,
      requestThreadApi,
      threadId,
    });

    const rejectedRows = await database
      .prepare(
        `SELECT id, scope_kind, status
           FROM file_record
          WHERE id IN (?, ?, ?)`,
      )
      .bind(wrongCreatorFileId, wrongAppFileId, notReadyFileId)
      .all<{ id: string; scope_kind: string; status: string }>();
    const rejectedRowsById = new Map(rejectedRows.results.map((row) => [row.id, row]));
    expect(rejectedRowsById.get(wrongCreatorFileId)).toMatchObject({
      scope_kind: "app_draft",
      status: "ready",
    });
    expect(rejectedRowsById.get(wrongAppFileId)).toMatchObject({
      scope_kind: "app_draft",
      status: "ready",
    });
    expect(rejectedRowsById.get(notReadyFileId)).toMatchObject({
      scope_kind: "app_draft",
      status: "pending",
    });
  });

  test("deletes a public Thread only after caller and App admission", async () => {
    const app = createPublicThreadApiTestApp();

    const successDatabase = await createPublicHttpContractDatabase();
    const deletableThreadId = generatedPublicThreadId(120);
    await insertPublicThread(successDatabase, {
      id: deletableThreadId,
      title: "Deletable public Thread",
      updatedAt: 2_000,
    });

    const deleteResponse = await requestPublicApi(
      app,
      successDatabase,
      new Request(`https://api.example.com/api/v1/threads/${deletableThreadId}`, {
        headers: { Authorization: bearer(TOKENS.owner) },
        method: "DELETE",
      }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(await readJson(deleteResponse)).toEqual({ ok: true });

    const deletedRow = await successDatabase
      .prepare("SELECT id FROM session WHERE id = ?")
      .bind(deletableThreadId)
      .first<{ id: string }>();
    expect(deletedRow).toBeNull();

    const ownerThreadDatabase = await createPublicHttpContractDatabase();
    const ownerThreadId = generatedPublicThreadId(121);
    await insertPublicThread(ownerThreadDatabase, {
      id: ownerThreadId,
      title: "Owner-only public Thread",
      updatedAt: 2_001,
    });

    const nonOwnerDeleteResponse = await requestPublicApi(
      app,
      ownerThreadDatabase,
      new Request(`https://api.example.com/api/v1/threads/${ownerThreadId}`, {
        headers: { Authorization: bearer(TOKENS.nonOwner) },
        method: "DELETE",
      }),
    );
    expect(nonOwnerDeleteResponse.status).toBe(404);
    expect(expectRecord(await readJson(nonOwnerDeleteResponse))["error"]).toMatchObject({
      code: "not_found",
      message: "Thread not found.",
    });

    const ownerThreadStillExists = await ownerThreadDatabase
      .prepare("SELECT id FROM session WHERE id = ?")
      .bind(ownerThreadId)
      .first<{ id: string }>();
    expect(ownerThreadStillExists).toEqual({ id: ownerThreadId });

    await ownerThreadDatabase
      .prepare("UPDATE session SET attributed_user_id = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerAccount, ownerThreadId)
      .run();
    const attributedNonOwnerDeleteResponse = await requestPublicApi(
      app,
      ownerThreadDatabase,
      new Request(`https://api.example.com/api/v1/threads/${ownerThreadId}`, {
        headers: { Authorization: bearer(TOKENS.nonOwner) },
        method: "DELETE",
      }),
    );
    expect(attributedNonOwnerDeleteResponse.status).toBe(403);
    expect(expectRecord(await readJson(attributedNonOwnerDeleteResponse))["error"]).toMatchObject({
      code: "forbidden",
      message: "Caller is not the App owner for this Agent.",
    });

    const attributedNonOwnerThreadStillExists = await ownerThreadDatabase
      .prepare("SELECT attributed_user_id, id FROM session WHERE id = ?")
      .bind(ownerThreadId)
      .first<{ attributed_user_id: string; id: string }>();
    expect(attributedNonOwnerThreadStillExists).toEqual({
      attributed_user_id: PUBLIC_API_TEST_IDS.nonOwnerAccount,
      id: ownerThreadId,
    });

    const mismatchedAppDatabase = await createPublicHttpContractDatabase();
    const mismatchedAppThreadId = generatedPublicThreadId(122);
    await insertPublicThread(mismatchedAppDatabase, {
      id: mismatchedAppThreadId,
      title: "Mismatched App public Thread",
      updatedAt: 2_002,
    });
    await mismatchedAppDatabase
      .prepare("UPDATE session SET app_id = ? WHERE id = ?")
      .bind("01J0000000000000000000BAD1", mismatchedAppThreadId)
      .run();

    const mismatchedAppDeleteResponse = await requestPublicApi(
      app,
      mismatchedAppDatabase,
      new Request(`https://api.example.com/api/v1/threads/${mismatchedAppThreadId}`, {
        headers: { Authorization: bearer(TOKENS.owner) },
        method: "DELETE",
      }),
    );
    expect(mismatchedAppDeleteResponse.status).toBe(404);
    expect(expectRecord(await readJson(mismatchedAppDeleteResponse))["error"]).toMatchObject({
      code: "not_found",
      message: "Thread not found.",
    });

    const mismatchedAppThreadStillExists = await mismatchedAppDatabase
      .prepare("SELECT id, app_id FROM session WHERE id = ?")
      .bind(mismatchedAppThreadId)
      .first<{ id: string; app_id: string }>();
    expect(mismatchedAppThreadStillExists).toEqual({
      id: mismatchedAppThreadId,
      app_id: "01J0000000000000000000BAD1",
    });
  });

  test("rejects invalid Thread event path inputs", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();

    const response = await requestPublicApi(
      app,
      database,
      new Request("https://api.example.com/api/v1/threads/missing/events?limit=0", {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );

    expect(response.status).toBe(400);
    expect(expectRecord(await readJson(response))["error"]).toMatchObject({
      code: "invalid_request",
    });

    const threadIdResponse = await requestPublicApi(
      app,
      database,
      new Request("https://api.example.com/api/v1/threads/not-a-ulid/events", {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );

    expect(threadIdResponse.status).toBe(400);
    expect(expectRecord(await readJson(threadIdResponse))["error"]).toMatchObject({
      code: "invalid_request",
    });
  });

  test("maps malformed public platform IDs to invalid request responses", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const invalidId = "not-a-ulid";
    const cases = [
      {
        message: "Agent ID must be a valid ULID.",
        request: new Request(`https://api.example.com/api/v1/agents/${invalidId}/threads`, {
          body: JSON.stringify({
            input: {
              content: [{ text: "Do the work.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      },
      {
        message: "Thread ID must be a valid ULID.",
        request: new Request(`https://api.example.com/api/v1/threads/${invalidId}`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      },
      {
        message: "File ID must be a valid ULID.",
        request: new Request(
          `https://api.example.com/api/v1/threads/${PUBLIC_API_TEST_IDS.nonOwnerSession}/files/${invalidId}`,
          {
            headers: { Authorization: bearer(TOKENS.owner) },
            method: "DELETE",
          },
        ),
      },
    ] as const;

    for (const testCase of cases) {
      const response = await requestPublicApi(app, database, testCase.request);
      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: {
          code: "invalid_request",
          message: testCase.message,
        },
      });
    }
  });

  test("replays create Thread responses by Idempotency-Key", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const createRequest = (clientExternalRef: string) => ({
      body: JSON.stringify({
        client_external_ref: clientExternalRef,
        input: {
          content: [{ text: "Retry-safe work.", type: "text" }],
          type: "user.message",
        },
      }),
      headers: {
        Authorization: bearer(TOKENS.owner),
        "Content-Type": "application/json",
        "Idempotency-Key": "thread-create-replay",
      },
      method: "POST",
    });

    await withProviderProbeMock(async () => {
      const first = await requestPublicApi(
        app,
        database,
        new Request(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
          createRequest("linear-ENG-1"),
        ),
      );
      expect(first.status).toBe(201);
      const firstBody = await readJson(first);

      const replay = await requestPublicApi(
        app,
        database,
        new Request(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
          createRequest("linear-ENG-1"),
        ),
      );
      expect(replay.status).toBe(201);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await readJson(replay)).toEqual(firstBody);
      await expect(
        countPublicApiRateLimitRequests(database, PUBLIC_API_TEST_IDS.patOwner),
      ).resolves.toBe(1);
    });
  });

  test("does not persist idempotency state for rate-limited create Thread attempts", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const idempotencyKey = "thread-create-rate-limited";
    const createRequest = {
      body: JSON.stringify({
        input: {
          content: [{ text: "Rate-limited work.", type: "text" }],
          type: "user.message",
        },
      }),
      headers: {
        Authorization: bearer(TOKENS.owner),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    };

    for (let index = 0; index < PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE; index += 1) {
      await enforcePublicApiRateLimit(database, PUBLIC_API_TEST_IDS.patOwner);
    }

    await withProviderProbeMock(async () => {
      const limited = await requestPublicApi(
        app,
        database,
        new Request(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
          createRequest,
        ),
      );

      expect(limited.status).toBe(429);
      await expect(
        countPublicApiIdempotencyRows(database, PUBLIC_API_TEST_IDS.patOwner, idempotencyKey),
      ).resolves.toBe(0);

      await database.prepare("DELETE FROM public_api_rate_limit_window").run();

      const retry = await requestPublicApi(
        app,
        database,
        new Request(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
          createRequest,
        ),
      );

      expect(retry.status).toBe(201);
      expect(retry.headers.get("Idempotency-Replayed")).toBeNull();
    });
  });

  test("treats client external refs as part of create Thread idempotency identity", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const createRequest = (clientExternalRef: string) => ({
      body: JSON.stringify({
        client_external_ref: clientExternalRef,
        input: {
          content: [{ text: "Retry-safe work.", type: "text" }],
          type: "user.message",
        },
      }),
      headers: {
        Authorization: bearer(TOKENS.owner),
        "Content-Type": "application/json",
        "Idempotency-Key": "thread-create-ref-conflict",
      },
      method: "POST",
    });

    await withProviderProbeMock(async () => {
      const first = await requestPublicApi(
        app,
        database,
        new Request(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
          createRequest("linear-ENG-1"),
        ),
      );
      expect(first.status).toBe(201);

      const conflict = await requestPublicApi(
        app,
        database,
        new Request(
          `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
          createRequest("linear-ENG-2"),
        ),
      );
      expect(conflict.status).toBe(409);
      expect(await readJson(conflict)).toEqual({
        error: {
          code: "idempotency_conflict",
          message: "Idempotency-Key was already used for a different request.",
        },
      });
    });
  });
});
