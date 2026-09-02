import { describe, expect, test } from "bun:test";

import { PUBLIC_THREAD_API_THREADS_MAX_LIMIT } from "@mosoo/contracts/public-api";
import {
  sessionExecutionSnapshotsTable,
  sessionMessagesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { eq } from "drizzle-orm";

import { fileStore } from "../src/modules/files/application/file-store";
import {
  PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE,
  enforcePublicApiRateLimit,
} from "../src/modules/public-api/public-api-rate-limit.service";
import { createSessionProcessEventsFromSessionEventRows } from "../src/modules/sessions/application/session-process-events.service";
import type { SessionEventProcessRow } from "../src/modules/sessions/application/session-process-events.service";
import { insertSessionMessage } from "../src/modules/sessions/infrastructure/session-message-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PublicApiMemoryFileBucket,
  PUBLIC_API_TEST_IDS,
  TOKENS,
  createPre0015PublicHttpContractDatabase,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  migratePre0015PublicHttpContractDatabase,
} from "./helpers/public-api-http-test-fixture";
import {
  OWNER_VIEWER,
  bearer,
  createPublicEventSessionNamespace,
  createPublicThreadApiTestApp,
  expectArray,
  expectRecord,
  expectString,
  insertRuntimeEvent,
  readJson,
  requestPublicApi,
  requestPublicApiWithBindings,
  withProviderProbeMock,
} from "./public-thread-api-fixtures";

const PUBLIC_THREAD_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const FINAL_OUTPUT_CANARY_LINE_COUNT = 160;
const FINAL_OUTPUT_CANARY_LINES = Array.from(
  { length: FINAL_OUTPUT_CANARY_LINE_COUNT },
  (_, index) => {
    const lineNumber = String(index + 1).padStart(3, "0");
    return `${lineNumber}|中文长文本校验-Aa${index % 10}-表格字符|END${lineNumber}`;
  },
);
const FINAL_OUTPUT_TEXT = [
  "CANARY-FINAL-START：中文与 ASCII 最终回答必须逐字保留。",
  "",
  "| 校验项 | 结果 |",
  "| --- | --- |",
  "| 多字节 | ✅ 中文😀 |",
  "",
  "链接：https://example.com/final-output",
  "",
  "```text",
  "CANARY-CODE-START|中文😀|END",
  "```",
  ...FINAL_OUTPUT_CANARY_LINES,
  "CANARY-FINAL-END",
].join("\n");
const FINAL_OUTPUT_TEXT_BYTES = new TextEncoder().encode(FINAL_OUTPUT_TEXT);
const PROGRESS_OUTPUT_TEXTS = [
  "进度 1：正在读取上游报告，不能进入最终回答。",
  "进度 2：已调用工具校验表格，不能进入最终回答。",
  "进度 3：artifact 已创建，不能进入最终回答。",
] as const;
const FINAL_MESSAGE_ID = "01J0000000000000000000001M";

type PublicHttpTestDatabase = Awaited<ReturnType<typeof createPublicHttpContractDatabase>>;

async function waitForBackgroundProvisionFailure(
  database: PublicHttpTestDatabase,
  runId: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  for (;;) {
    const row = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(runId)
      .first<{ status: string }>();

    if (row?.status === "failed") {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for background provisioning failure for Run ${runId}.`);
    }

    await Bun.sleep(5);
  }
}

async function createReadyProjectDraftFile(input: {
  body: string;
  bucket: PublicApiMemoryFileBucket;
  database: PublicHttpTestDatabase;
  name: string;
}): Promise<string> {
  const bindings = createPublicHttpTestBindings(input.database, {
    fileBucket: input.bucket,
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
      id: PUBLIC_API_TEST_IDS.project,
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

async function createPendingProjectDraftFile(input: {
  body: string;
  bucket: PublicApiMemoryFileBucket;
  database: PublicHttpTestDatabase;
  name: string;
}): Promise<string> {
  const bindings = createPublicHttpTestBindings(input.database, {
    fileBucket: input.bucket,
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
      id: PUBLIC_API_TEST_IDS.project,
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

async function countPublicThreadsForAgent(database: PublicHttpTestDatabase): Promise<number> {
  const row = await database
    .prepare("SELECT COUNT(*) AS row_count FROM session WHERE agent_id = ?")
    .bind(PUBLIC_API_TEST_IDS.agent)
    .first<{ row_count: number }>();

  return row?.row_count ?? 0;
}

async function countSessionRows(
  database: PublicHttpTestDatabase,
  table: "session_message" | "session_run",
  sessionId: string,
): Promise<number> {
  const row = await database
    .prepare(`SELECT COUNT(*) AS row_count FROM ${table} WHERE session_id = ?`)
    .bind(sessionId)
    .first<{ row_count: number }>();

  return row?.row_count ?? 0;
}

function failFirstPublicApiIdempotencyCompletion(database: D1Database): D1Database {
  let shouldFail = true;

  const wrapStatement = (
    statement: D1PreparedStatement,
    failCompletion: boolean,
  ): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), failCompletion);
        }

        if (property === "run" && failCompletion) {
          return async () => {
            if (shouldFail) {
              shouldFail = false;
              throw new Error("Injected public API idempotency completion failure.");
            }

            return target.run();
          };
        }

        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          const isCompletionUpdate =
            query.startsWith('update "public_api_idempotency_key"') &&
            query.includes('set "response_json"');

          return wrapStatement(statement, isCompletionUpdate);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function insertPublicThread(
  database: PublicHttpTestDatabase,
  input: {
    createdBy?: Record<string, unknown>;
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
      createdAt: input.updatedAt,
      creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      id: input.id,
      kind: "pet",
      endUserId: "customer-123",
      lastMessageAt: null,
      lastRunId: null,
      metadataJson: JSON.stringify({
        public_api: {
          created_by: input.createdBy ?? {
            token_id: PUBLIC_API_TEST_IDS.patOwner,
            token_label: PUBLIC_API_TEST_IDS.patOwner,
          },
          idempotency_key: null,
          source: "public_api",
        },
      }),
      model: "gpt-5.4",
      projectId: PUBLIC_API_TEST_IDS.project,
      provider: "openai",
      renamed: false,
      runtimeId: "openai-runtime",
      status: "IDLE",
      title: input.title,
      type: "ui",
      updatedAt: input.updatedAt,
    })
    .run();

  await database
    .app()
    .insert(sessionExecutionSnapshotsTable)
    .values({
      createdAt: input.updatedAt,
      planJson: JSON.stringify({
        binding: {
          agentId: PUBLIC_API_TEST_IDS.agent,
          deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
          deploymentVersionNumber: 1,
          kind: "pet",
          model: "gpt-5.4",
          prompt: "Help.",
          provider: "openai",
          runtimeId: "openai-runtime",
        },
        environment: {
          allowMcpServers: true,
          allowPackageManagers: true,
          allowedHostsJson: "[]",
          envVarsJson: "[]",
          environmentId: PUBLIC_API_TEST_IDS.environment,
          environmentName: "Default",
          networkPolicy: "full",
          packagesJson: "[]",
          revisionId: PUBLIC_API_TEST_IDS.environmentRevision,
          setupScript: "",
        },
        skills: [],
        tools: [],
      }),
      sessionId: input.id,
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
            input: {
              content: [{ text: "Summarize the launch plan.", type: "text" }],
              type: "user.message",
            },
            userId: "customer-123",
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
        id: threadId,
        source: "api",
        userId: "customer-123",
      });
      expect(threadId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      const runId = expectString(run["id"]);
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
          `SELECT attributed_user_id, end_user_id, last_run_id, metadata_json
             FROM session
            WHERE id = ?`,
        )
        .bind(threadId)
        .first<{
          attributed_user_id: string | null;
          end_user_id: string;
          last_run_id: string | null;
          metadata_json: string;
        }>();
      expect(sessionRow).not.toBeNull();
      expect(sessionRow).toMatchObject({
        attributed_user_id: null,
        end_user_id: "customer-123",
        last_run_id: run["id"],
      });
      const metadata = expectRecord(JSON.parse(expectString(sessionRow?.metadata_json)));
      expect(metadata["public_api"]).toMatchObject({
        created_by: { token_id: PUBLIC_API_TEST_IDS.patOwner },
        idempotency_key: "thread-create-1",
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
      expect(expectRecord((await readJson(retrieveResponse))["thread"])).toMatchObject({
        id: threadId,
        userId: "customer-123",
      });

      // This fixture has no Cloudflare Sandbox binding, so inline provisioning
      // fails in waitUntil. Let that expected terminal write settle before the
      // test replaces the runtime history with its simulated completed output.
      await waitForBackgroundProvisionFailure(database, runId);
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

      await insertRuntimeEvent(database, {
        kind: "tool.call.updated",
        occurredAt: 900,
        payload: {
          rawInput: '{"calories":420,"mealId":"meal-1"}',
          status: "running",
          title: "record_meal",
          toolCallId: "tool-call-1",
        },
        runId,
        seq: 1,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "tool.call.updated",
        occurredAt: 950,
        payload: {
          rawInput: '{"calories":420,"mealId":"meal-1"}',
          rawOutput: '{"ok":true}',
          status: "completed",
          toolCallId: "tool-call-1",
        },
        runId,
        seq: 2,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "tool.call.updated",
        occurredAt: 975,
        payload: {
          status: "cancelled",
          title: "record_meal",
          toolCallId: "tool-call-2",
        },
        runId,
        seq: 3,
        sessionId: threadId,
      });

      const toolEventsResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(toolEventsResponse.status).toBe(200);
      const toolEvents = expectArray((await readJson(toolEventsResponse))["events"]).map(
        expectRecord,
      );
      expect(toolEvents.map((event) => event["toolCallId"])).toEqual([
        "tool-call-1",
        "tool-call-1",
        "tool-call-2",
      ]);
      expect(toolEvents[0]).toMatchObject({
        toolInput: { calories: 420, mealId: "meal-1" },
        toolName: "record_meal",
        type: "tool.use.started",
      });
      expect(toolEvents[1]).toMatchObject({
        toolInput: { calories: 420, mealId: "meal-1" },
        type: "tool.use.completed",
      });
      expect(toolEvents[2]).toMatchObject({
        content: "record_meal",
        toolName: "record_meal",
        type: "tool.use.completed",
      });
      expectNoProperties(toolEvents[2], ["toolInput"]);

      await database.prepare("DELETE FROM session_event WHERE session_id = ?").bind(threadId).run();

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
      for (const [index, progressText] of PROGRESS_OUTPUT_TEXTS.entries()) {
        await insertRuntimeEvent(database, {
          kind: "message.added",
          occurredAt: 1_050 + index * 10,
          payload: {
            content: progressText,
            messageId: `assistant-progress-${index + 1}`,
            role: "agent",
          },
          runId,
          seq: index + 2,
          sessionId: threadId,
        });
      }
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 1_085,
        payload: {
          content: FINAL_OUTPUT_TEXT,
          messageId: FINAL_MESSAGE_ID,
          role: "agent",
        },
        runId,
        seq: 5,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.completed",
        occurredAt: 1_100,
        payload: { messageId: FINAL_MESSAGE_ID, role: "agent" },
        runId,
        seq: 6,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "run.started",
        occurredAt: 1_125,
        payload: { startedAt: "1970-01-01T00:00:01.125Z" },
        runId,
        seq: 7,
        sessionId: threadId,
        visibility: "owner_debug",
      });
      await insertRuntimeEvent(database, {
        kind: "run.completed",
        occurredAt: 1_150,
        payload: { finalMessageId: FINAL_MESSAGE_ID, stopReason: "end_turn" },
        runId,
        seq: 8,
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
        FINAL_OUTPUT_TEXT,
        runId,
      ]);
      expect(events.map((event) => expectRecord(event)["runId"])).toEqual([runId, runId]);

      for (const progressText of PROGRESS_OUTPUT_TEXTS) {
        await insertSessionMessage(database, {
          content: progressText,
          createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
          role: "assistant",
          segments: [{ kind: "text", text: progressText }],
          sessionId: threadId,
          sessionRunId: runId,
        });
      }
      await insertSessionMessage(database, {
        content: "",
        createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
        id: FINAL_MESSAGE_ID,
        role: "assistant",
        sessionId: threadId,
        sessionRunId: runId,
      });
      await database
        .app()
        .update(sessionMessagesTable)
        .set({ projectionFormat: "event_stream_v3" })
        .where(eq(sessionMessagesTable.id, FINAL_MESSAGE_ID))
        .run();

      await database
        .app()
        .update(sessionRunsTable)
        .set({
          completedAt: 1_150,
          // The background inline dispatch always fails in this environment
          // (the sandbox module cannot load under bun) and may finalize the
          // run with a provisioning error before this simulated completion
          // runs. Clear the error fields so the simulated outcome is
          // authoritative regardless of that ordering.
          errorCode: null,
          errorDetailsJson: null,
          errorMessage: null,
          errorRetryable: null,
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
        finalOutput: { text: FINAL_OUTPUT_TEXT },
        id: runId,
        status: "completed",
      });
      const finalOutput = expectRecord(completedRun["finalOutput"]);
      const finalOutputText = expectString(finalOutput["text"]);
      expect(finalOutputText).toBe(FINAL_OUTPUT_TEXT);
      expect(new TextEncoder().encode(finalOutputText)).toEqual(FINAL_OUTPUT_TEXT_BYTES);
      expect(finalOutputText.split("\n")).toContain(
        `${String(FINAL_OUTPUT_CANARY_LINE_COUNT).padStart(3, "0")}|中文长文本校验-Aa9-表格字符|END${String(
          FINAL_OUTPUT_CANARY_LINE_COUNT,
        ).padStart(3, "0")}`,
      );
      for (const progressText of PROGRESS_OUTPUT_TEXTS) {
        expect(finalOutputText).not.toContain(progressText);
      }

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
      expect(repeatedRun["finalOutput"]).toEqual({ text: FINAL_OUTPUT_TEXT });

      const listResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(listResponse.status).toBe(200);
      const listedThreads = expectArray(expectRecord(await readJson(listResponse))["threads"]);
      expect(listedThreads).toHaveLength(1);
      expect(expectRecord(listedThreads[0])["userId"]).toBe("customer-123");

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
            userId: "customer-123",
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
        message: "Caller is not the Project owner for this Agent.",
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
            userId: "customer-123",
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
        message: "Caller is not the Project owner for this Agent.",
      });
    });
  });

  test("keeps owner-visible Thread history readable with an opaque retired creator", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const threadId = generatedPublicThreadId(0);

    await insertPublicThread(database, {
      createdBy: {
        historical_caller_id: "01J0000000000000000000000H",
        historical_caller_kind: "retired",
      },
      id: threadId,
      title: "Historical Thread",
      updatedAt: 1,
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

    const listResponse = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    expect(listResponse.status).toBe(200);
    expect(expectArray(expectRecord(await readJson(listResponse))["threads"])).toEqual([
      expect.objectContaining({ id: threadId }),
    ]);
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
            userId: "customer-123",
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
          userId: "customer-123",
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
        last_run_id: null,
        status: "IDLE",
        title: null,
        userId: "customer-123",
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
                requestId: "first-message",
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
      expect(firstEvent["requestId"]).toBe("first-message");
      expect(expectRecord(firstEvent["run"])["trigger"]).toBe("user_prompt");

      const missingUserResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          headers: { Authorization: bearer(TOKENS.owner) },
          method: "POST",
        }),
      );
      expect(missingUserResponse.status).toBe(400);
      expect(expectRecord(await readJson(missingUserResponse))["error"]).toMatchObject({
        code: "invalid_request",
        message: "userId is required.",
      });
    });
  });

  test("streams Thread events as public SSE entries", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();

    await withProviderProbeMock(async () => {
      const response = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({ userId: "customer-123" }),
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
      const runId = null;

      await database.prepare("DELETE FROM session_event WHERE session_id = ?").bind(threadId).run();
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 3_000,
        payload: {
          content: "Initial stream history A",
          messageId: "assistant-stream-initial-1",
          role: "agent",
        },
        runId,
        seq: 1,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "tool.call.updated",
        occurredAt: 3_050,
        payload: {
          rawInput: '{"calories":420,"mealId":"meal-1"}',
          status: "running",
          title: "record_meal",
          toolCallId: "tool-call-stream-1",
        },
        runId,
        seq: 2,
        sessionId: threadId,
      });

      const streamResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream?limit=1`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
        { sessionNamespace: liveEvents.binding },
      );
      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers.get("Content-Type")).toContain("text/event-stream");
      const reader = streamResponse.body?.getReader();
      if (!reader) {
        throw new Error("Expected stream response body.");
      }

      await reader.read();

      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 3_100,
        payload: {
          content: "private-diagnostic",
          messageId: "private-message",
          role: "agent",
        },
        runId,
        seq: 3,
        sessionId: threadId,
        visibility: "owner_debug",
      });
      await insertRuntimeEvent(database, {
        kind: "message.delta",
        occurredAt: 3_150,
        payload: {
          contentDelta: "Live stream \uE200ci",
          messageId: "assistant-stream-live-1",
          role: "agent",
        },
        runId,
        seq: 4,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.delta",
        occurredAt: 3_200,
        payload: {
          contentDelta: "te\uE202hidden\uE201delta A",
          messageId: "assistant-stream-live-1",
          role: "agent",
        },
        runId,
        seq: 5,
        sessionId: threadId,
      });

      const readUntil = async (marker: string): Promise<string> => {
        let text = "";

        while (!text.includes(marker)) {
          const chunk = await Promise.race([
            reader.read(),
            Bun.sleep(3_000).then(() => {
              throw new Error(`Timed out waiting for ${marker}.`);
            }),
          ]);

          if (chunk.done) {
            throw new Error(`SSE closed before ${marker}.`);
          }

          text += new TextDecoder().decode(chunk.value);
        }

        return text;
      };

      const deltaCommittedAt = performance.now();
      liveEvents.emit();
      const openDeltaText = await readUntil("id: 01J00000000000000000000014");
      const openDeltaMs = performance.now() - deltaCommittedAt;

      expect(openDeltaMs).toBeLessThan(500);
      expect(openDeltaText).toContain("Live stream ");
      expect(openDeltaText).toContain("delta A");
      expect(openDeltaText).not.toContain("hidden");
      expect(openDeltaText).not.toContain("\uE200");

      liveEvents.close();

      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 3_250,
        payload: {
          content: "Live stream \uE200cite\uE202hidden\uE201delta A",
          messageId: "assistant-stream-live-1",
          role: "agent",
        },
        runId,
        seq: 6,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.completed",
        occurredAt: 3_300,
        payload: { messageId: "assistant-stream-live-1", role: "agent" },
        runId,
        seq: 7,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.delta",
        occurredAt: 3_350,
        payload: {
          contentDelta: "Same poll ",
          messageId: "assistant-stream-same-poll",
          role: "agent",
        },
        runId,
        seq: 8,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 3_400,
        payload: {
          content: "Same poll suffix",
          messageId: "assistant-stream-same-poll",
          role: "agent",
        },
        runId,
        seq: 9,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.completed",
        occurredAt: 3_450,
        payload: { messageId: "assistant-stream-same-poll", role: "agent" },
        runId,
        seq: 10,
        sessionId: threadId,
      });
      const noDeltaTerminals = [
        ["message.completed", { messageId: "no-delta-completed", role: "agent" }],
        ["message.cancelled", { messageId: "no-delta-cancelled", role: "agent" }],
        [
          "message.failed",
          {
            error: { code: "runtime.failed", message: "Runtime failed." },
            messageId: "no-delta-failed",
            role: "agent",
          },
        ],
      ] as const;

      for (const [index, [kind, payload]] of noDeltaTerminals.entries()) {
        await insertRuntimeEvent(database, {
          kind,
          occurredAt: 3_550 + index * 50,
          payload,
          runId,
          seq: 12 + index,
          sessionId: threadId,
        });
      }
      const streamedTerminals = [
        [
          "message.cancelled",
          "Cancelled stream \uE200cite\uE202hidden-cancelled\uE201",
          { messageId: "assistant-stream-cancelled", role: "agent" },
        ],
        [
          "message.failed",
          "Failed stream \uE200cite\uE202hidden-failed\uE201",
          {
            error: { code: "runtime.failed", message: "Runtime failed." },
            messageId: "assistant-stream-failed",
            role: "agent",
          },
        ],
      ] as const;

      for (const [index, [kind, contentDelta, payload]] of streamedTerminals.entries()) {
        const seq = 15 + index * 2;
        await insertRuntimeEvent(database, {
          kind: "message.delta",
          occurredAt: 3_700 + index * 100,
          payload: { contentDelta, messageId: payload.messageId, role: "agent" },
          runId,
          seq,
          sessionId: threadId,
        });
        await insertRuntimeEvent(database, {
          kind,
          occurredAt: 3_750 + index * 100,
          payload,
          runId,
          seq: seq + 1,
          sessionId: threadId,
        });
      }
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 3_900,
        payload: {
          content: "Tail marker",
          messageId: "tail-message",
          role: "agent",
        },
        runId,
        seq: 19,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.completed",
        occurredAt: 3_950,
        payload: { messageId: "tail-message", role: "agent" },
        runId,
        seq: 20,
        sessionId: threadId,
      });

      const text = `${openDeltaText}${await readUntil("id: 01J0000000000000000000001K")}`;
      await reader.cancel();
      expect(text).toContain("event: thread.event");
      expect(text).toContain("id: 01J00000000000000000000011");
      expect(text).not.toContain("id: 01J00000000000000000000012");
      expect(text).not.toContain("id: 01J00000000000000000000013");
      expect(text).toContain("id: 01J00000000000000000000014");
      expect(text).not.toContain("id: 01J00000000000000000000015");
      expect(text).toContain("id: 01J00000000000000000000016");
      expect(text).toContain("id: 01J00000000000000000000017");
      expect(text).not.toContain("id: 01J00000000000000000000018");
      expect(text).toContain("id: 01J00000000000000000000019");
      expect(text).not.toContain("id: 01J0000000000000000000001A");
      expect(text).toContain("id: 01J0000000000000000000001B");
      expect(text).toContain("id: 01J0000000000000000000001C");
      expect(text).toContain("id: 01J0000000000000000000001D");
      expect(text).not.toContain("id: 01J0000000000000000000001E");
      expect(text).toContain("id: 01J0000000000000000000001F");
      expect(text).not.toContain("id: 01J0000000000000000000001G");
      expect(text).toContain("id: 01J0000000000000000000001H");
      expect(text).not.toContain("id: 01J0000000000000000000001J");
      expect(text).toContain("id: 01J0000000000000000000001K");
      expect(text.match(/Live stream /gu)).toHaveLength(1);
      expect(text.match(/delta A/gu)).toHaveLength(1);
      expect(text.match(/Same poll /gu)).toHaveLength(1);
      expect(text.match(/suffix/gu)).toHaveLength(1);
      expect(text.match(/Cancelled stream /gu)).toHaveLength(1);
      expect(text.match(/Failed stream /gu)).toHaveLength(1);
      expect(text).not.toContain("hidden-cancelled");
      expect(text).not.toContain("hidden-failed");
      expect(text).not.toContain("Message updated.");
      expect(text).not.toContain("Runtime failed.");
      expect(text).toContain('"type":"agent.message.delta"');
      expect(text).toContain('"status":"error"');
      expect(text).toMatch(/id: 01J0000000000000000000001H\ndata: [^\n]*"status":"error"/u);
      expect(text).toContain('"toolCallId":"tool-call-stream-1"');
      expect(text).toContain('"toolInput":{"calories":420,"mealId":"meal-1"}');
      expect(text).toContain('"toolName":"record_meal"');
      expect(text).toContain('"runId":null');
      expect(text).toContain('"content":"');
      expect(text).not.toContain("owner_debug");
      expect(text).not.toContain("payload");
      expect(text).not.toContain("private-diagnostic");
      expect(text).not.toContain("traceId");
      expect(text).not.toContain("event: thread.error");

      const replayResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events?limit=100`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      const replayEvents = expectArray((await readJson(replayResponse))["events"]).map(
        expectRecord,
      );

      for (const id of [
        "01J00000000000000000000016",
        "01J00000000000000000000019",
        "01J0000000000000000000001B",
        "01J0000000000000000000001C",
        "01J0000000000000000000001D",
        "01J0000000000000000000001F",
        "01J0000000000000000000001H",
        "01J0000000000000000000001K",
      ]) {
        expect(replayEvents.some((event) => event["id"] === id)).toBe(true);
      }
      for (const id of ["01J0000000000000000000001D", "01J0000000000000000000001H"]) {
        expect(replayEvents.find((event) => event["id"] === id)).toMatchObject({
          status: "error",
        });
      }
    });
  }, 10_000);

  test.each([
    {
      canonicalText: "Hello world",
      liveText: "Hello ",
      provider: "OpenAI",
      snapshotContent: "Hello ",
      threadIndex: 250,
    },
    {
      canonicalText: "Hello world",
      liveText: "Hello ",
      provider: "ACP",
      snapshotContent: "Hello ",
      threadIndex: 251,
    },
    {
      canonicalText: "Hello world",
      liveText: "Hello ",
      provider: "Claude",
      snapshotContent: [{ text: "Hello ", type: "text" }],
      threadIndex: 252,
    },
    {
      canonicalText: "Final world",
      liveText: "Draft ",
      provider: "divergent",
      snapshotContent: "Final ",
      threadIndex: 253,
    },
  ] as const)(
    "projects $provider snapshot-before-terminal order without replaying live text",
    async ({ canonicalText, liveText, provider, snapshotContent, threadIndex }) => {
      const database = await createPublicHttpContractDatabase();
      const app = createPublicThreadApiTestApp();
      const liveEvents = createPublicEventSessionNamespace();
      const threadId = generatedPublicThreadId(threadIndex);
      const messageId = `snapshot-before-terminal-${provider.toLowerCase()}`;

      await insertPublicThread(database, {
        id: threadId,
        title: `${provider} snapshot order`,
        updatedAt: 1_000,
      });
      await insertRuntimeEvent(database, {
        kind: "message.started",
        occurredAt: 1_100,
        payload: { messageId, role: "agent" },
        seq: 1,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.delta",
        occurredAt: 1_200,
        payload: { contentDelta: liveText, messageId, role: "agent" },
        seq: 2,
        sessionId: threadId,
      });

      const response = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
        { sessionNamespace: liveEvents.binding },
      );
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Expected stream response body.");
      }

      const decoder = new TextDecoder();
      let sseText = "";
      const readUntil = async (marker: string): Promise<void> => {
        while (!sseText.includes(marker)) {
          const chunk = await Promise.race([
            reader.read(),
            Bun.sleep(3_000).then(() => {
              throw new Error(`Timed out waiting for ${marker}.`);
            }),
          ]);

          if (chunk.done) {
            throw new Error(`SSE closed before ${marker}.`);
          }
          sseText += decoder.decode(chunk.value, { stream: true });
        }
      };

      await readUntil("id: 01J00000000000000000000011");
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 1_300,
        payload: { content: snapshotContent, messageId, role: "agent" },
        seq: 3,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.delta",
        occurredAt: 1_400,
        payload: { contentDelta: "world", messageId, role: "agent" },
        seq: 4,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.completed",
        occurredAt: 1_500,
        payload: { messageId, role: "agent" },
        seq: 5,
        sessionId: threadId,
      });
      liveEvents.emit();
      await readUntil("id: 01J00000000000000000000014");
      await reader.cancel();
      liveEvents.close();

      const liveContent = sseText
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => expectRecord(JSON.parse(line.slice("data: ".length)))["content"])
        .filter((content): content is string => typeof content === "string")
        .join("");
      const replayResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      const replayContent = expectArray((await readJson(replayResponse))["events"])
        .map((event) => expectRecord(event)["content"])
        .filter((content): content is string => typeof content === "string")
        .join("");

      expect(replayContent).toBe(canonicalText);
      expect(liveContent).toBe(provider === "divergent" ? liveText : canonicalText);
    },
    10_000,
  );

  test("reconciles a paginated authoritative snapshot above the former payload limit", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(270);
    const messageId = "paginated-authoritative-snapshot";
    const eventId = (seq: number) => generatedPublicThreadId(18_000 + seq);
    const fragments = Array.from({ length: 1_001 }, (_, index) =>
      index === 1_000 ? "🙂终" : "x".repeat(400),
    );

    await insertPublicThread(database, {
      id: threadId,
      title: "Paginated authoritative snapshot",
      updatedAt: 1_000,
    });
    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }
    await reader.read();

    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_000,
      payload: { messageId, role: "agent" },
      seq: 1,
      sessionId: threadId,
    });
    for (const [index, content] of fragments.entries()) {
      const seq = index + 2;
      await insertRuntimeEvent(database, {
        eventId: eventId(seq),
        kind: index === 0 ? "message.added" : "message.delta",
        occurredAt: seq * 1_000,
        payload:
          index === 0
            ? { content, messageId, role: "agent" }
            : { contentDelta: content, messageId, role: "agent" },
        seq,
        sessionId: threadId,
      });
    }
    const terminalSeq = fragments.length + 2;
    const terminalEventId = eventId(terminalSeq);
    await insertRuntimeEvent(database, {
      eventId: terminalEventId,
      kind: "message.completed",
      occurredAt: terminalSeq * 1_000,
      payload: { messageId, role: "agent" },
      seq: terminalSeq,
      sessionId: threadId,
    });
    liveEvents.emit();

    const decoder = new TextDecoder();
    let sseText = "";
    while (!sseText.includes(`id: ${terminalEventId}`)) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(8_000).then(() => {
          throw new Error("Timed out waiting for the paginated authoritative snapshot.");
        }),
      ]);
      if (chunk.done) {
        throw new Error("SSE closed before the paginated authoritative snapshot.");
      }
      sseText += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();
    liveEvents.close();

    const liveMessages = sseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => expectRecord(JSON.parse(line.slice("data: ".length))))
      .filter((event) => event["type"] === "agent.message.delta");
    const replayResponse = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    const replayMessages = expectArray((await readJson(replayResponse))["events"])
      .map(expectRecord)
      .filter((event) => event["type"] === "agent.message.delta");

    expect(fragments.join("").length).toBeGreaterThan(384 * 1024);
    expect(liveMessages).toEqual(replayMessages);
    expect(liveMessages).toEqual([
      expect.objectContaining({ content: fragments.join(""), id: terminalEventId }),
    ]);
  }, 15_000);

  test("retains exact prefix metadata for more than one public event page of messages", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(271);
    const runId = PUBLIC_API_TEST_IDS.run;
    const messageId = "message-before-full-state-page";
    const eventId = (seq: number) => generatedPublicThreadId(20_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Unbounded active message metadata",
      updatedAt: 1_000,
    });
    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }
    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(5_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(": connected");
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "run.started",
      occurredAt: 1_000,
      payload: { startedAt: "1970-01-01T00:00:01.000Z" },
      runId,
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.started",
      occurredAt: 2_000,
      payload: { messageId, role: "agent" },
      runId,
      seq: 2,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "message.delta",
      occurredAt: 3_000,
      payload: { contentDelta: "prefix", messageId, role: "agent" },
      runId,
      seq: 3,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(3)}`);

    for (let seq = 4; seq <= 1_004; seq += 1) {
      await insertRuntimeEvent(database, {
        eventId: eventId(seq),
        kind: "message.started",
        occurredAt: seq * 1_000,
        payload: { messageId: `parallel-message-${seq}`, role: "agent" },
        runId,
        seq,
        sessionId: threadId,
      });
    }
    await insertRuntimeEvent(database, {
      eventId: eventId(1_005),
      kind: "tool.call.updated",
      occurredAt: 1_005_000,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "state_page_marker",
        toolCallId: "state-page-marker",
      },
      runId,
      seq: 1_005,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(1_005)}`);

    await insertRuntimeEvent(database, {
      eventId: eventId(1_006),
      kind: "message.added",
      occurredAt: 1_006_000,
      payload: { content: "prefix", messageId, role: "agent" },
      runId,
      seq: 1_006,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1_007),
      kind: "message.delta",
      occurredAt: 1_007_000,
      payload: { contentDelta: " suffix", messageId, role: "agent" },
      runId,
      seq: 1_007,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1_008),
      kind: "message.completed",
      occurredAt: 1_008_000,
      payload: { messageId, role: "agent" },
      runId,
      seq: 1_008,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(1_008)}`);
    await reader.cancel();
    liveEvents.close();

    const liveContent = sseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => expectRecord(JSON.parse(line.slice("data: ".length))))
      .filter((event) => event["type"] === "agent.message.delta")
      .map((event) => event["content"])
      .filter((content): content is string => typeof content === "string")
      .join("");

    expect(liveContent).toBe("prefix suffix");
  }, 15_000);

  test("replaces standalone assistant snapshots before publishing the terminal text", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(258);
    const messageId = "standalone-authoritative-snapshot";
    const eventId = (seq: number) => generatedPublicThreadId(9_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Standalone authoritative snapshot",
      updatedAt: 1_000,
    });

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }

    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.added",
      occurredAt: 1_100,
      payload: { content: "Obsolete snapshot", messageId, role: "agent" },
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.added",
      occurredAt: 1_200,
      payload: { content: "Final \uE200ci", messageId, role: "agent" },
      seq: 2,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "message.delta",
      occurredAt: 1_300,
      payload: { contentDelta: "te\uE202private\uE201world", messageId, role: "agent" },
      seq: 3,
      sessionId: threadId,
    });
    const terminalEventId = eventId(4);
    await insertRuntimeEvent(database, {
      eventId: terminalEventId,
      kind: "message.completed",
      occurredAt: 1_400,
      payload: { messageId, role: "agent" },
      seq: 4,
      sessionId: threadId,
    });
    liveEvents.emit();

    const decoder = new TextDecoder();
    let sseText = "";

    while (!sseText.includes(`id: ${terminalEventId}`)) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(3_000).then(() => {
          throw new Error("Timed out waiting for the terminal assistant snapshot.");
        }),
      ]);

      if (chunk.done) {
        throw new Error("SSE closed before the terminal assistant snapshot.");
      }
      sseText += decoder.decode(chunk.value, { stream: true });
    }

    await reader.cancel();
    liveEvents.close();
    const liveContent = sseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => expectRecord(JSON.parse(line.slice("data: ".length)))["content"])
      .filter((content): content is string => typeof content === "string")
      .join("");
    const replayResponse = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    const replayContent = expectArray((await readJson(replayResponse))["events"])
      .map((event) => expectRecord(event)["content"])
      .filter((content): content is string => typeof content === "string")
      .join("");

    expect(liveContent).toBe("Final world");
    expect(replayContent).toBe(liveContent);
    expect(sseText).not.toContain("Obsolete snapshot");
    expect(sseText).not.toContain("private");
  }, 10_000);

  test.each([
    {
      deltaContent: "world",
      snapshotContent: "Final ",
      terminalKind: "message.completed",
      terminalBeforeConnect: true,
      threadIndex: 254,
      timing: "after the terminal",
    },
    {
      deltaContent: "world",
      snapshotContent: "Final ",
      terminalKind: "message.completed",
      terminalBeforeConnect: false,
      threadIndex: 255,
      timing: "between the snapshot and terminal",
    },
    {
      deltaContent: "world",
      snapshotContent: "Final ",
      terminalKind: "run.failed",
      terminalBeforeConnect: false,
      threadIndex: 259,
      timing: "before a repaired run terminal",
    },
    {
      deltaContent: "te\uE202private\uE201world",
      snapshotContent: "Final \uE200ci",
      terminalKind: "message.completed",
      terminalBeforeConnect: false,
      threadIndex: 260,
      timing: "across a private citation chunk boundary",
    },
  ] as const)(
    "hydrates canonical snapshot text when connecting $timing",
    async ({ deltaContent, snapshotContent, terminalBeforeConnect, terminalKind, threadIndex }) => {
      const database = await createPublicHttpContractDatabase();
      const app = createPublicThreadApiTestApp();
      const liveEvents = createPublicEventSessionNamespace();
      const threadId = generatedPublicThreadId(threadIndex);
      const messageId = `initial-canonical-${String(threadIndex)}`;
      const runId = terminalKind === "run.failed" ? PUBLIC_API_TEST_IDS.run : null;

      await insertPublicThread(database, {
        id: threadId,
        title: "Initial canonical snapshot",
        updatedAt: 1_000,
      });
      await insertRuntimeEvent(database, {
        kind: "message.started",
        occurredAt: 1_100,
        payload: { messageId, role: "agent" },
        runId,
        seq: 1,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.delta",
        occurredAt: 1_200,
        payload: { contentDelta: "Draft ", messageId, role: "agent" },
        runId,
        seq: 2,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        kind: "message.added",
        occurredAt: 1_300,
        payload: { content: snapshotContent, messageId, role: "agent" },
        runId,
        seq: 3,
        sessionId: threadId,
      });

      const completeSnapshot = async () => {
        await insertRuntimeEvent(database, {
          kind: "message.delta",
          occurredAt: 1_400,
          payload: { contentDelta: deltaContent, messageId, role: "agent" },
          runId,
          seq: 4,
          sessionId: threadId,
        });
        await insertRuntimeEvent(database, {
          kind: terminalKind,
          occurredAt: 1_500,
          payload:
            terminalKind === "message.completed"
              ? { messageId, role: "agent" }
              : {
                  error: {
                    code: "runtime.driver_terminal",
                    details: {},
                    message: "Driver disconnected.",
                    retryable: true,
                  },
                  recoverable: true,
                },
          runId,
          seq: 5,
          sessionId: threadId,
        });
      };

      if (terminalBeforeConnect) {
        await completeSnapshot();
      }

      const response = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
        { sessionNamespace: liveEvents.binding },
      );
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Expected stream response body.");
      }

      const decoder = new TextDecoder();
      let sseText = "";
      const readUntil = async (marker: string): Promise<void> => {
        while (!sseText.includes(marker)) {
          const chunk = await Promise.race([
            reader.read(),
            Bun.sleep(3_000).then(() => {
              throw new Error(`Timed out waiting for ${marker}.`);
            }),
          ]);

          if (chunk.done) {
            throw new Error(`SSE closed before ${marker}.`);
          }
          sseText += decoder.decode(chunk.value, { stream: true });
        }
      };

      await readUntil(
        terminalBeforeConnect ? "id: 01J00000000000000000000014" : "id: 01J00000000000000000000012",
      );
      if (!terminalBeforeConnect) {
        await completeSnapshot();
        liveEvents.emit();
        await readUntil("id: 01J00000000000000000000014");
      }
      await reader.cancel();
      liveEvents.close();

      const liveContent = sseText
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => expectRecord(JSON.parse(line.slice("data: ".length))))
        .filter((event) => event["type"] === "agent.message.delta")
        .map((event) => event["content"])
        .filter((content): content is string => typeof content === "string")
        .join("");
      const replayResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      const replayContent = expectArray((await readJson(replayResponse))["events"])
        .map(expectRecord)
        .filter((event) => event["type"] === "agent.message.delta")
        .map((event) => event["content"])
        .filter((content): content is string => typeof content === "string")
        .join("");

      expect(liveContent).toBe("Final world");
      expect(replayContent).toBe(liveContent);
      expect(liveContent).not.toContain("Draft");
      expect(sseText).not.toContain("private");
      expect(sseText).not.toContain("\uE200");
    },
    10_000,
  );

  test("keeps a citation parser alive across a repaired run terminal", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(262);
    const messageId = "terminal-citation-recovery";
    const runId = PUBLIC_API_TEST_IDS.run;
    const eventId = (seq: number) => generatedPublicThreadId(12_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Terminal citation recovery",
      updatedAt: 1_000,
    });
    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }

    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(": connected");
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_100,
      payload: { messageId, role: "agent" },
      runId,
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.delta",
      occurredAt: 1_200,
      payload: { contentDelta: "before\uE200ci", messageId, role: "agent" },
      runId,
      seq: 2,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(2)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "run.failed",
      occurredAt: 1_300,
      payload: {
        error: {
          code: "runtime.driver_terminal",
          details: {},
          message: "Driver disconnected.",
          retryable: true,
        },
        recoverable: true,
      },
      runId,
      seq: 3,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(3)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(4),
      kind: "message.delta",
      occurredAt: 1_250,
      payload: {
        contentDelta: "te\uE202SECRET\uE201after",
        messageId,
        role: "agent",
      },
      runId,
      seq: 4,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(4)}`);
    await reader.cancel();
    liveEvents.close();

    const liveMessageContent = sseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => expectRecord(JSON.parse(line.slice("data: ".length))))
      .filter((event) => event["type"] === "agent.message.delta")
      .map((event) => event["content"])
      .filter((content): content is string => typeof content === "string")
      .join("");
    const replayResponse = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    const replayEvents = expectArray((await readJson(replayResponse))["events"]).map(expectRecord);
    const replayMessages = replayEvents.filter((event) => event["type"] === "agent.message.delta");

    expect(liveMessageContent).toBe("beforeafter");
    expect(replayMessages).toHaveLength(1);
    expect(replayMessages[0]?.["content"]).toBe(liveMessageContent);
    expect(sseText).not.toContain("SECRET");
    expect(sseText).not.toContain("\uE200");
  }, 10_000);

  test("keeps one canonical stream when an authoritative snapshot arrives after repair", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(263);
    const messageId = "terminal-snapshot-recovery";
    const runId = PUBLIC_API_TEST_IDS.run;
    const eventId = (seq: number) => generatedPublicThreadId(12_100 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Terminal snapshot recovery",
      updatedAt: 1_000,
    });
    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }

    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(": connected");
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_100,
      payload: { messageId, role: "agent" },
      runId,
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.delta",
      occurredAt: 1_200,
      payload: { contentDelta: "Draft", messageId, role: "agent" },
      runId,
      seq: 2,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(2)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "run.failed",
      occurredAt: 1_500,
      payload: {
        error: {
          code: "runtime.driver_terminal",
          details: {},
          message: "Driver disconnected.",
          retryable: true,
        },
        recoverable: true,
      },
      runId,
      seq: 3,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(3)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(4),
      kind: "message.started",
      occurredAt: 1_250,
      payload: { messageId, role: "agent" },
      runId,
      seq: 4,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(5),
      kind: "message.added",
      occurredAt: 1_300,
      payload: { content: "Obsolete", messageId, role: "agent" },
      runId,
      seq: 5,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(6),
      kind: "message.added",
      occurredAt: 1_350,
      payload: { content: "Final ", messageId, role: "agent" },
      runId,
      seq: 6,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(7),
      kind: "message.delta",
      occurredAt: 1_400,
      payload: { contentDelta: "world", messageId, role: "agent" },
      runId,
      seq: 7,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(8),
      kind: "tool.call.updated",
      occurredAt: 1_600,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "recovery_marker",
        toolCallId: "terminal-snapshot-marker",
      },
      runId,
      seq: 8,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(8)}`);
    await reader.cancel();
    liveEvents.close();

    const liveMessages = sseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => expectRecord(JSON.parse(line.slice("data: ".length))))
      .filter((event) => event["type"] === "agent.message.delta");
    const replayResponse = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    const replayMessages = expectArray((await readJson(replayResponse))["events"])
      .map(expectRecord)
      .filter((event) => event["type"] === "agent.message.delta");

    expect(liveMessages.map((event) => event["content"]).join("")).toBe("Draft");
    expect(replayMessages).toHaveLength(1);
    expect(replayMessages[0]?.["content"]).toBe("Final world");
    expect(sseText).not.toContain("Obsolete");
  }, 10_000);

  test("keeps final stream identity stable when its message terminal arrives after repair", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(268);
    const messageId = "late-message-terminal";
    const runId = PUBLIC_API_TEST_IDS.run;
    const eventId = (seq: number) => generatedPublicThreadId(16_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Late message terminal identity",
      updatedAt: 1_000,
    });
    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }
    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(": connected");
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_100,
      payload: { messageId, role: "agent" },
      runId,
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.added",
      occurredAt: 1_200,
      payload: { content: "Final ", messageId, role: "agent" },
      runId,
      seq: 2,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "message.delta",
      occurredAt: 1_300,
      payload: { contentDelta: "world", messageId, role: "agent" },
      runId,
      seq: 3,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(4),
      kind: "run.failed",
      occurredAt: 1_400,
      payload: {
        error: {
          code: "runtime.driver_terminal",
          details: {},
          message: "Driver disconnected.",
          retryable: true,
        },
        recoverable: true,
      },
      runId,
      seq: 4,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(4)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(5),
      kind: "message.completed",
      occurredAt: 1_350,
      payload: { messageId, role: "agent" },
      runId,
      seq: 5,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(6),
      kind: "tool.call.updated",
      occurredAt: 1_500,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "late_terminal_marker",
        toolCallId: "late-terminal-marker",
      },
      runId,
      seq: 6,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(6)}`);
    await reader.cancel();
    liveEvents.close();

    const liveEventsBody = sseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => expectRecord(JSON.parse(line.slice("data: ".length))));
    const replayResponse = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    const replayEvents = expectArray((await readJson(replayResponse))["events"]).map(expectRecord);
    const liveMessage = liveEventsBody.filter((event) => event["type"] === "agent.message.delta");
    const replayMessage = replayEvents.filter((event) => event["type"] === "agent.message.delta");

    expect(liveMessage).toEqual(replayMessage);
    expect(liveMessage).toEqual([
      expect.objectContaining({ content: "Final world", id: eventId(2) }),
    ]);
    expect(sseText).not.toContain(`id: ${eventId(5)}`);
  }, 10_000);

  test("retains an undisplayed stream parser across the initial event limit", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(264);
    const messageId = "limited-citation-stream";
    const eventId = (seq: number) => generatedPublicThreadId(12_200 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Limited citation stream",
      updatedAt: 1_000,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_100,
      payload: { messageId, role: "agent" },
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.delta",
      occurredAt: 1_200,
      payload: { contentDelta: "before\uE200ci", messageId, role: "agent" },
      seq: 2,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "tool.call.updated",
      occurredAt: 1_300,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "limit_marker",
        toolCallId: "limited-citation-marker",
      },
      seq: 3,
      sessionId: threadId,
    });

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream?limit=1`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }

    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(`id: ${eventId(3)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(4),
      kind: "message.delta",
      occurredAt: 1_400,
      payload: {
        contentDelta: "te\uE202SECRET\uE201after",
        messageId,
        role: "agent",
      },
      seq: 4,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(4)}`);
    await reader.cancel();
    liveEvents.close();

    expect(sseText).toContain('"content":"after"');
    expect(sseText).not.toContain("SECRET");
    expect(sseText).not.toContain("\uE200");
  }, 10_000);

  test("fails closed for an old stream outside the initial scan", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(265);
    const messageId = "unscanned-citation-stream";
    const eventId = (seq: number) => generatedPublicThreadId(14_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Unscanned citation stream",
      updatedAt: 1_000,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_000,
      payload: { messageId, role: "agent" },
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.delta",
      occurredAt: 2_000,
      payload: { contentDelta: "before\uE200ci", messageId, role: "agent" },
      seq: 2,
      sessionId: threadId,
    });

    for (let seq = 3; seq <= 1_003; seq += 1) {
      await insertRuntimeEvent(database, {
        eventId: eventId(seq),
        kind: "tool.call.updated",
        occurredAt: seq * 1_000,
        payload: {
          rawInput: "{}",
          status: "running",
          title: "scan_filler",
          toolCallId: `scan-filler-${seq}`,
        },
        seq,
        sessionId: threadId,
      });
    }

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream?limit=1`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }
    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(`id: ${eventId(1_003)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(1_004),
      kind: "message.delta",
      occurredAt: 1_004_000,
      payload: {
        contentDelta: "te\uE202SECRET\uE201after",
        messageId,
        role: "agent",
      },
      seq: 1_004,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1_005),
      kind: "tool.call.updated",
      occurredAt: 1_005_000,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "post_scan_marker",
        toolCallId: "post-scan-marker",
      },
      seq: 1_005,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(1_005)}`);
    await reader.cancel();
    liveEvents.close();

    expect(sseText).not.toContain("SECRET");
    expect(sseText).not.toContain("\uE200");
    expect(sseText).not.toContain(`id: ${eventId(1_004)}`);
  }, 10_000);

  test("trusts a delta parser when an exact full page reaches the database start", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(269);
    const messageId = "exact-page-citation-stream";
    const eventId = (seq: number) => generatedPublicThreadId(17_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Exact page citation stream",
      updatedAt: 1_000,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.delta",
      occurredAt: 1_000,
      payload: { contentDelta: "before\uE200ci", messageId, role: "agent" },
      seq: 1,
      sessionId: threadId,
    });

    for (let seq = 2; seq <= 1_000; seq += 1) {
      await insertRuntimeEvent(database, {
        eventId: eventId(seq),
        kind: "tool.call.updated",
        occurredAt: seq * 1_000,
        payload: {
          rawInput: "{}",
          status: "running",
          title: "page_filler",
          toolCallId: `page-filler-${seq}`,
        },
        seq,
        sessionId: threadId,
      });
    }

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream?limit=1`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }
    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(`id: ${eventId(1_000)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(1_001),
      kind: "message.delta",
      occurredAt: 1_001_000,
      payload: {
        contentDelta: "te\uE202SECRET\uE201after",
        messageId,
        role: "agent",
      },
      seq: 1_001,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(1_001)}`);
    await reader.cancel();
    liveEvents.close();

    expect(sseText).toContain('"content":"after"');
    expect(sseText).not.toContain("SECRET");
    expect(sseText).not.toContain("\uE200");
  }, 10_000);

  test("does not revive an omitted terminal snapshot on a later event", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(266);
    const messageId = "omitted-terminal-snapshot";
    const runId = PUBLIC_API_TEST_IDS.run;
    const eventId = (seq: number) => generatedPublicThreadId(15_100 + seq);
    const failure = {
      error: {
        code: "runtime.driver_terminal",
        details: {},
        message: "Driver disconnected.",
        retryable: true,
      },
      recoverable: true,
    };

    await insertPublicThread(database, {
      id: threadId,
      title: "Omitted terminal snapshot",
      updatedAt: 1_000,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_100,
      payload: { messageId, role: "agent" },
      runId,
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.added",
      occurredAt: 1_200,
      payload: { content: "OLD OMITTED", messageId, role: "agent" },
      runId,
      seq: 2,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "message.completed",
      occurredAt: 1_300,
      payload: { messageId, role: "agent" },
      runId,
      seq: 3,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(4),
      kind: "run.failed",
      occurredAt: 1_400,
      payload: failure,
      runId,
      seq: 4,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(5),
      kind: "tool.call.updated",
      occurredAt: 1_500,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "initial_marker",
        toolCallId: "initial-terminal-marker",
      },
      runId,
      seq: 5,
      sessionId: threadId,
    });

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream?limit=1`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }
    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(`id: ${eventId(5)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(6),
      kind: "tool.call.updated",
      occurredAt: 1_600,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "later_marker",
        toolCallId: "later-terminal-marker",
      },
      runId,
      seq: 6,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(6)}`);
    await reader.cancel();
    liveEvents.close();

    expect(sseText).not.toContain("OLD OMITTED");
    expect(sseText).not.toContain(`id: ${eventId(2)}`);
  }, 10_000);

  test("releases completed run state and rejects late fragments after the next run", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(267);
    const firstRunId = PUBLIC_API_TEST_IDS.run;
    const secondRunId = generatedPublicThreadId(15_250);
    const messageId = "released-run-citation";
    const eventId = (seq: number) => generatedPublicThreadId(15_300 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Released run state",
      updatedAt: 1_000,
    });
    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }
    const decoder = new TextDecoder();
    let sseText = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!sseText.includes(marker)) {
        const chunk = await Promise.race([
          reader.read(),
          Bun.sleep(3_000).then(() => {
            throw new Error(`Timed out waiting for ${marker}.`);
          }),
        ]);
        if (chunk.done) {
          throw new Error(`SSE closed before ${marker}.`);
        }
        sseText += decoder.decode(chunk.value, { stream: true });
      }
    };

    await readUntil(": connected");
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_100,
      payload: { messageId, role: "agent" },
      runId: firstRunId,
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.delta",
      occurredAt: 1_200,
      payload: { contentDelta: "before\uE200ci", messageId, role: "agent" },
      runId: firstRunId,
      seq: 2,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "run.failed",
      occurredAt: 1_300,
      payload: {
        error: {
          code: "runtime.driver_terminal",
          details: {},
          message: "Driver disconnected.",
          retryable: true,
        },
        recoverable: true,
      },
      runId: firstRunId,
      seq: 3,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(3)}`);
    await insertRuntimeEvent(database, {
      eventId: eventId(4),
      kind: "run.started",
      occurredAt: 1_400,
      payload: { startedAt: "1970-01-01T00:00:01.400Z" },
      runId: secondRunId,
      seq: 4,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(5),
      kind: "message.delta",
      occurredAt: 1_250,
      payload: {
        contentDelta: "te\uE202SECRET\uE201after",
        messageId,
        role: "agent",
      },
      runId: firstRunId,
      seq: 5,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(6),
      kind: "tool.call.updated",
      occurredAt: 1_500,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "next_run_marker",
        toolCallId: "next-run-marker",
      },
      runId: secondRunId,
      seq: 6,
      sessionId: threadId,
    });
    liveEvents.emit();
    await readUntil(`id: ${eventId(6)}`);
    await reader.cancel();
    liveEvents.close();

    expect(sseText).toContain('"content":"before"');
    expect(sseText).not.toContain("SECRET");
    expect(sseText).not.toContain(`id: ${eventId(5)}`);
  }, 10_000);

  test("reads a complete retained stream across public event pages", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const threadId = generatedPublicThreadId(256);
    const runId = PUBLIC_API_TEST_IDS.run;
    const fragmentCount = 520;
    const eventId = (seq: number) => generatedPublicThreadId(4_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Paged public streams",
      updatedAt: 1_000,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "run.started",
      occurredAt: 1_000,
      payload: { startedAt: "1970-01-01T00:00:01.000Z" },
      runId,
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "thought.started",
      occurredAt: 2_000,
      payload: { thoughtId: "thought-a" },
      runId,
      seq: 2,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(3),
      kind: "thought.started",
      occurredAt: 3_000,
      payload: { thoughtId: "thought-b" },
      runId,
      seq: 3,
      sessionId: threadId,
    });

    for (let index = 0; index < fragmentCount; index += 1) {
      const seq = index * 2 + 4;
      await insertRuntimeEvent(database, {
        eventId: eventId(seq),
        kind: "thought.delta",
        occurredAt: seq * 1_000,
        payload: { contentDelta: "a", thoughtId: "thought-a" },
        runId,
        seq,
        sessionId: threadId,
      });
      await insertRuntimeEvent(database, {
        eventId: eventId(seq + 1),
        kind: "thought.delta",
        occurredAt: (seq + 1) * 1_000,
        payload: { contentDelta: "b", thoughtId: "thought-b" },
        runId,
        seq: seq + 1,
        sessionId: threadId,
      });
    }

    const firstTerminalSeq = fragmentCount * 2 + 4;
    for (const [offset, thoughtId] of ["thought-a", "thought-b"].entries()) {
      const seq = firstTerminalSeq + offset;
      await insertRuntimeEvent(database, {
        eventId: eventId(seq),
        kind: "thought.completed",
        occurredAt: seq * 1_000,
        payload: { thoughtId },
        runId,
        seq,
        sessionId: threadId,
      });
    }
    await insertRuntimeEvent(database, {
      eventId: eventId(firstTerminalSeq + 2),
      kind: "run.completed",
      occurredAt: (firstTerminalSeq + 2) * 1_000,
      payload: { stopReason: "end_turn" },
      runId,
      seq: firstTerminalSeq + 2,
      sessionId: threadId,
    });

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events?limit=2`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    const body = await readJson(response);
    const events = expectArray(body["events"]).map(expectRecord);

    expect(body["truncated"]).toBe(true);
    expect(events.map((event) => event["type"])).toEqual(["agent.thinking.delta", "run.completed"]);
    expect(events[0]?.["content"]).toBe("b".repeat(fragmentCount));
  });

  test("orders public pages by durable sequence rather than driver time", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const threadId = generatedPublicThreadId(261);
    const runId = PUBLIC_API_TEST_IDS.run;
    const fragmentCount = 1_002;
    const eventId = (seq: number) => generatedPublicThreadId(10_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Occurrence-ordered public stream",
      updatedAt: 1_000,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "run.started",
      occurredAt: 1_000,
      payload: { startedAt: "1970-01-01T00:00:01.000Z" },
      runId,
      seq: 1,
      sessionId: threadId,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(2),
      kind: "message.started",
      occurredAt: 100_000,
      payload: { messageId: "out-of-order-public-message", role: "agent" },
      runId,
      seq: 2,
      sessionId: threadId,
    });

    for (let index = 0; index < fragmentCount; index += 1) {
      const seq = index + 3;
      await insertRuntimeEvent(database, {
        eventId: eventId(seq),
        kind: "message.delta",
        occurredAt: 101_000 + index,
        payload: {
          contentDelta: "x",
          messageId: "out-of-order-public-message",
          role: "agent",
        },
        runId,
        seq,
        sessionId: threadId,
      });
    }

    const toolSeq = fragmentCount + 3;
    await insertRuntimeEvent(database, {
      eventId: eventId(toolSeq),
      kind: "tool.call.updated",
      occurredAt: 2_000,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "read_file",
        toolCallId: "out-of-order-tool",
      },
      runId,
      seq: toolSeq,
      sessionId: threadId,
    });
    const runTerminalSeq = toolSeq + 1;
    await insertRuntimeEvent(database, {
      eventId: eventId(runTerminalSeq),
      kind: "run.completed",
      occurredAt: 3_000,
      payload: { stopReason: "end_turn" },
      runId,
      seq: runTerminalSeq,
      sessionId: threadId,
    });

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events?limit=2`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    const body = await readJson(response);
    const events = expectArray(body["events"]).map(expectRecord);

    expect(body["truncated"]).toBe(true);
    expect(events.map((event) => event["type"])).toEqual(["tool.use.started", "run.completed"]);
    expect(events[0]?.["toolCallId"]).toBe("out-of-order-tool");
  });

  test("fails closed for a public message cut by the raw scan ceiling", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const liveEvents = createPublicEventSessionNamespace();
    const threadId = generatedPublicThreadId(257);
    const runId = PUBLIC_API_TEST_IDS.run;
    const fragmentCount = 20_001;
    const eventId = (seq: number) => generatedPublicThreadId(7_000 + seq);

    await insertPublicThread(database, {
      id: threadId,
      title: "Ceiling-bounded public stream",
      updatedAt: 1_000,
    });
    await insertRuntimeEvent(database, {
      eventId: eventId(1),
      kind: "message.started",
      occurredAt: 1_000,
      payload: { messageId: "ceiling-message", role: "agent" },
      runId,
      seq: 1,
      sessionId: threadId,
    });

    for (let index = 0; index < fragmentCount; index += 1) {
      const seq = index + 2;
      await insertRuntimeEvent(database, {
        eventId: eventId(seq),
        kind: "message.delta",
        occurredAt: seq * 1_000,
        payload: {
          contentDelta: index === 0 ? "before\uE200ci" : index === 1 ? "te\uE202SECRET" : "SECRET",
          messageId: "ceiling-message",
          role: "agent",
        },
        runId,
        seq,
        sessionId: threadId,
      });
    }

    const messageTerminalSeq = fragmentCount + 2;
    await insertRuntimeEvent(database, {
      eventId: eventId(messageTerminalSeq),
      kind: "message.completed",
      occurredAt: messageTerminalSeq * 1_000,
      payload: { messageId: "ceiling-message", role: "agent" },
      runId,
      seq: messageTerminalSeq,
      sessionId: threadId,
    });
    const finalMessageSeq = messageTerminalSeq + 1;
    await insertRuntimeEvent(database, {
      eventId: eventId(finalMessageSeq),
      kind: "message.added",
      occurredAt: finalMessageSeq * 1_000,
      payload: {
        content: "Complete final answer",
        messageId: "complete-final-message",
        role: "agent",
      },
      runId,
      seq: finalMessageSeq,
      sessionId: threadId,
    });
    const runTerminalSeq = finalMessageSeq + 1;
    const runTerminalEventId = eventId(runTerminalSeq);
    await insertRuntimeEvent(database, {
      eventId: runTerminalEventId,
      kind: "run.completed",
      occurredAt: runTerminalSeq * 1_000,
      payload: { stopReason: "end_turn" },
      runId,
      seq: runTerminalSeq,
      sessionId: threadId,
    });

    const listResponse = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events?limit=2`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    const listBody = await readJson(listResponse);
    const listEvents = expectArray(listBody["events"]).map(expectRecord);
    expect(listBody["truncated"]).toBe(true);
    expect(listEvents.map((event) => event["type"])).toEqual([
      "agent.message.delta",
      "run.completed",
    ]);
    expect(listEvents[0]?.["content"]).toBe("Complete final answer");

    const streamResponse = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events/stream?limit=2`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
      { sessionNamespace: liveEvents.binding },
    );
    const reader = streamResponse.body?.getReader();
    if (!reader) {
      throw new Error("Expected stream response body.");
    }
    const decoder = new TextDecoder();
    let sseText = "";

    while (!sseText.includes(`id: ${runTerminalEventId}`)) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("SSE closed before the initial canonical event.");
      }
      sseText += decoder.decode(chunk.value, { stream: true });
    }

    const lateDeltaSeq = runTerminalSeq + 1;
    await insertRuntimeEvent(database, {
      eventId: eventId(lateDeltaSeq),
      kind: "message.delta",
      occurredAt: lateDeltaSeq * 1_000,
      payload: {
        contentDelta: "SECRET\uE201after",
        messageId: "ceiling-message",
        role: "agent",
      },
      runId,
      seq: lateDeltaSeq,
      sessionId: threadId,
    });
    const markerSeq = lateDeltaSeq + 1;
    const markerEventId = eventId(markerSeq);
    await insertRuntimeEvent(database, {
      eventId: markerEventId,
      kind: "tool.call.updated",
      occurredAt: markerSeq * 1_000,
      payload: {
        rawInput: "{}",
        status: "running",
        title: "ceiling_marker",
        toolCallId: "ceiling-marker",
      },
      runId,
      seq: markerSeq,
      sessionId: threadId,
    });
    liveEvents.emit();

    while (!sseText.includes(`id: ${markerEventId}`)) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("SSE closed before the post-ceiling marker.");
      }
      sseText += decoder.decode(chunk.value, { stream: true });
    }

    await reader.cancel();
    liveEvents.close();
    const liveEventsBody = sseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => expectRecord(JSON.parse(line.slice("data: ".length))));

    expect(liveEventsBody.slice(0, listEvents.length)).toEqual(listEvents);
    expect(liveEventsBody.at(-1)?.["id"]).toBe(markerEventId);
    expect(sseText).not.toContain("SECRET");
    expect(sseText).not.toContain("\uE200");
  }, 30_000);

  test("reads row-scoped pre-0015 stream identities after migration", async () => {
    const database = await createPre0015PublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const threadId = generatedPublicThreadId(999);
    const eventIds = ["01J0000000000000000000001F", "01J0000000000000000000001G"];

    await database
      .prepare(
        `INSERT INTO session (
           agent_id, archived_at, end_user_id, created_at, creator_account_id,
           deployment_version_id, deployment_version_number, id, kind,
           metadata_json, model, project_id, provider, renamed, runtime_id, status,
           title, type, updated_at
         ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        PUBLIC_API_TEST_IDS.agent,
        "customer-123",
        1_000,
        PUBLIC_API_TEST_IDS.ownerAccount,
        PUBLIC_API_TEST_IDS.deployment,
        1,
        threadId,
        "pet",
        JSON.stringify({
          public_api: {
            created_by: {
              token_id: PUBLIC_API_TEST_IDS.patOwner,
              token_label: PUBLIC_API_TEST_IDS.patOwner,
            },
            idempotency_key: null,
            source: "public_api",
          },
        }),
        "gpt-5.4",
        PUBLIC_API_TEST_IDS.project,
        "openai",
        false,
        "openai-runtime",
        "IDLE",
        "Pre-0015 stream fixture",
        "ui",
        1_000,
      )
      .run();
    for (const [index, eventId] of eventIds.entries()) {
      await database
        .prepare(
          `INSERT INTO session_event (
             id, session_id, agent_id, seq, content_text, ended_at, event_type,
             family, process_status, process_type, source, source_event_id,
             visibility, occurred_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          eventId,
          threadId,
          PUBLIC_API_TEST_IDS.agent,
          index + 1,
          `Legacy row ${index + 1}`,
          1_100 + index,
          "message.delta",
          "process",
          "available",
          "agent.message.delta",
          "driver",
          eventId,
          "all_consumers",
          1_100 + index,
          1_100 + index,
        )
        .run();
    }

    migratePre0015PublicHttpContractDatabase(database);

    const rows = await database
      .prepare(
        `SELECT content_text, ended_at, event_type, id, occurred_at,
                process_status, process_type, run_id, seq, stream_id, tokens
           FROM session_event
          WHERE session_id = ?
          ORDER BY seq`,
      )
      .bind(threadId)
      .all<SessionEventProcessRow>();
    expect(rows.results.map((row) => row.stream_id)).toEqual(eventIds);
    await expect(
      database
        .prepare(
          "SELECT semantic_hash, tool_parent_message_id, tool_result_message_id, tool_status FROM session_event WHERE session_id = ? ORDER BY seq",
        )
        .bind(threadId)
        .all(),
    ).resolves.toMatchObject({
      results: eventIds.map(() => ({
        semantic_hash: null,
        tool_parent_message_id: null,
        tool_result_message_id: null,
        tool_status: null,
      })),
      success: true,
    });
    await expect(
      database
        .prepare("UPDATE session_event SET semantic_hash = 'not-a-sha256' WHERE id = ?")
        .bind(eventIds[0])
        .run(),
    ).rejects.toThrow();
    expect(
      createSessionProcessEventsFromSessionEventRows(rows.results).map((event) => event.content),
    ).toEqual(["Legacy row 1", "Legacy row 2"]);

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    expect(response.status).toBe(200);
    expect(
      expectArray((await readJson(response))["events"]).map(
        (event) => expectRecord(event)["content"],
      ),
    ).toEqual(["Legacy row 1", "Legacy row 2"]);

    await database
      .prepare(
        "UPDATE session_event SET event_type = 'tool.call.updated', run_id = ?, tool_call_id = 'tool-1', tool_status = 'completed', mcp_command_id = '01J0000000000000000000001J' WHERE id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.run, eventIds[0])
      .run();
    await expect(
      database
        .prepare(
          "UPDATE session_event SET event_type = 'tool.call.updated', run_id = ?, tool_call_id = 'tool-1', tool_status = 'running' WHERE id = ?",
        )
        .bind(PUBLIC_API_TEST_IDS.run, eventIds[1])
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          "UPDATE session_event SET tool_status = 'failed', mcp_command_id = '01J0000000000000000000001J' WHERE id = ?",
        )
        .bind(eventIds[1])
        .run(),
    ).rejects.toThrow("UNIQUE constraint failed");
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
      requestPublicApi(app, database, request, { fileBucket: bucket });

    await withProviderProbeMock(async () => {
      const createThreadResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            userId: "customer-123",
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
      const projectDraftFileRow = await database
        .prepare("SELECT object_key FROM file_record WHERE id = ?")
        .bind(fileId)
        .first<{ object_key: string }>();
      if (!projectDraftFileRow) {
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
      expect(bucket.objects.has(projectDraftFileRow.object_key)).toBe(false);

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
      requestPublicApi(app, database, request, { fileBucket: bucket });

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

      const projectDraftFileRow = await database
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
      expect(projectDraftFileRow).toMatchObject({
        committed: 0,
        owner_id: PUBLIC_API_TEST_IDS.project,
        owner_kind: "app",
        purpose: "app_draft",
        scope_id: PUBLIC_API_TEST_IDS.project,
        scope_kind: "app_draft",
        session_kind: "attachment",
        status: "ready",
      });
      if (!projectDraftFileRow) {
        throw new Error("Expected ready Agent draft file row.");
      }
      expect(
        await bucket.get(projectDraftFileRow.object_key).then((object) => object?.text()),
      ).toBe(fileBody);

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
            input: {
              content: [{ text: "Read the attached launch note.", type: "text" }],
              type: "user.message",
            },
            resources: [{ file_id: fileId, type: "file" }],
            userId: "customer-123",
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
      expect(bucket.objects.has(projectDraftFileRow.object_key)).toBe(false);
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
      requestPublicApi(app, database, request, { fileBucket: bucket });
    const threadId = generatedPublicThreadId(130);

    await insertPublicThread(database, {
      id: threadId,
      title: "File claim guard public Thread",
      updatedAt: 2_100,
    });

    const wrongCreatorFileId = await createReadyProjectDraftFile({
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

    const wrongProjectFileId = await createReadyProjectDraftFile({
      body: "Wrong project draft.\n",
      bucket,
      database,
      name: "wrong-project.txt",
    });
    const wrongProjectId = "01J0000000000000000000BAD2";
    await database
      .prepare("UPDATE file_record SET owner_id = ?, scope_id = ? WHERE id = ?")
      .bind(wrongProjectId, wrongProjectId, wrongProjectFileId)
      .run();
    await expectCreateThreadFileClaimRejected({
      fileId: wrongProjectFileId,
      message: `Attachment ${wrongProjectFileId} is not a draft attachment.`,
      requestThreadApi,
      threadId,
    });

    const nonDraftFileId = await createReadyProjectDraftFile({
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

    const notReadyFileId = await createPendingProjectDraftFile({
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
      .bind(wrongCreatorFileId, wrongProjectFileId, notReadyFileId)
      .all<{ id: string; scope_kind: string; status: string }>();
    const rejectedRowsById = new Map(rejectedRows.results.map((row) => [row.id, row]));
    expect(rejectedRowsById.get(wrongCreatorFileId)).toMatchObject({
      scope_kind: "app_draft",
      status: "ready",
    });
    expect(rejectedRowsById.get(wrongProjectFileId)).toMatchObject({
      scope_kind: "app_draft",
      status: "ready",
    });
    expect(rejectedRowsById.get(notReadyFileId)).toMatchObject({
      scope_kind: "app_draft",
      status: "pending",
    });
  });

  test("deletes a public Thread only after caller and Project admission", async () => {
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

    const mismatchedAppDatabase = await createPublicHttpContractDatabase();
    const mismatchedProjectThreadId = generatedPublicThreadId(122);
    await insertPublicThread(mismatchedAppDatabase, {
      id: mismatchedProjectThreadId,
      title: "Mismatched Project public Thread",
      updatedAt: 2_002,
    });
    await mismatchedAppDatabase
      .prepare("UPDATE session SET project_id = ? WHERE id = ?")
      .bind("01J0000000000000000000BAD1", mismatchedProjectThreadId)
      .run();

    const mismatchedProjectDeleteResponse = await requestPublicApi(
      app,
      mismatchedAppDatabase,
      new Request(`https://api.example.com/api/v1/threads/${mismatchedProjectThreadId}`, {
        headers: { Authorization: bearer(TOKENS.owner) },
        method: "DELETE",
      }),
    );
    expect(mismatchedProjectDeleteResponse.status).toBe(404);
    expect(expectRecord(await readJson(mismatchedProjectDeleteResponse))["error"]).toMatchObject({
      code: "not_found",
      message: "Thread not found.",
    });

    const mismatchedProjectThreadStillExists = await mismatchedAppDatabase
      .prepare("SELECT id, project_id FROM session WHERE id = ?")
      .bind(mismatchedProjectThreadId)
      .first<{ id: string; project_id: string }>();
    expect(mismatchedProjectThreadStillExists).toEqual({
      id: mismatchedProjectThreadId,
      project_id: "01J0000000000000000000BAD1",
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
    const createRequest = (userId: string) => ({
      body: JSON.stringify({
        input: {
          content: [{ text: "Retry-safe work.", type: "text" }],
          type: "user.message",
        },
        userId,
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

  test("recovers a completed Thread creation after its idempotency completion write fails", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const idempotencyKey = "thread-create-completion-failure";
    const createRequest = (key = idempotencyKey) =>
      new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
        body: JSON.stringify({
          input: {
            content: [{ text: "Recover the completed Thread.", type: "text" }],
            type: "user.message",
          },
          userId: "customer-123",
        }),
        headers: {
          Authorization: bearer(TOKENS.owner),
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        method: "POST",
      });

    await withProviderProbeMock(async () => {
      const first = await requestPublicApiWithBindings(
        app,
        createRequest(),
        createPublicHttpTestBindings(
          failFirstPublicApiIdempotencyCompletion(database),
        ) as ApiBindings,
      );
      expect(first.status).toBe(201);
      const firstBody = await readJson(first);
      const firstThread = expectRecord(firstBody["thread"]);
      const firstRun = expectRecord(firstBody["run"]);
      const firstThreadId = expectString(firstThread["id"]);
      const firstRunId = expectString(firstRun["id"]);

      await expect(countPublicThreadsForAgent(database)).resolves.toBe(1);
      await database
        .prepare(
          "UPDATE public_api_idempotency_key SET updated_at = ? WHERE token_id = ? AND idempotency_key = ?",
        )
        .bind(Date.now() - 11 * 60 * 1000, PUBLIC_API_TEST_IDS.patOwner, idempotencyKey)
        .run();

      const unrelated = await requestPublicApi(
        app,
        database,
        createRequest("other-idempotency-key"),
      );
      expect(unrelated.status).toBe(201);
      await expect(countPublicThreadsForAgent(database)).resolves.toBe(2);

      const retry = await requestPublicApi(app, database, createRequest());
      expect(retry.status).toBe(201);
      expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
      const retryBody = await readJson(retry);
      expect(expectRecord(retryBody["thread"])["id"]).toBe(firstThreadId);
      expect(expectRecord(retryBody["run"])["id"]).toBe(firstRunId);
      await expect(countPublicThreadsForAgent(database)).resolves.toBe(2);
      await expect(
        countPublicApiIdempotencyRows(database, PUBLIC_API_TEST_IDS.patOwner, idempotencyKey),
      ).resolves.toBe(1);
    });
  });

  test("does not re-execute a stale public Thread event after its idempotency completion write fails", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const threadId = generatedPublicThreadId(240);
    const idempotencyKey = "thread-event-completion-failure";
    const sendEventRequest = () =>
      new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
        body: JSON.stringify({
          events: [{ text: "Do not queue this event twice.", type: "user_message" }],
        }),
        headers: {
          Authorization: bearer(TOKENS.owner),
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        method: "POST",
      });

    await insertPublicThread(database, {
      id: threadId,
      title: "Event idempotency recovery",
      updatedAt: 2_400,
    });

    await withProviderProbeMock(async () => {
      const first = await requestPublicApiWithBindings(
        app,
        sendEventRequest(),
        createPublicHttpTestBindings(
          failFirstPublicApiIdempotencyCompletion(database),
        ) as ApiBindings,
      );
      expect(first.status).toBe(200);
      await expect(countSessionRows(database, "session_run", threadId)).resolves.toBe(1);
      await expect(countSessionRows(database, "session_message", threadId)).resolves.toBe(1);

      await database
        .prepare(
          "UPDATE public_api_idempotency_key SET updated_at = ? WHERE token_id = ? AND idempotency_key = ?",
        )
        .bind(Date.now() - 11 * 60 * 1000, PUBLIC_API_TEST_IDS.patOwner, idempotencyKey)
        .run();

      const retry = await requestPublicApi(app, database, sendEventRequest());
      expect(retry.status).toBe(409);
      expect(Number(retry.headers.get("Retry-After"))).toBeGreaterThan(60 * 60);
      expect(expectRecord(await readJson(retry))["error"]).toMatchObject({
        code: "idempotency_conflict",
      });
      await expect(countSessionRows(database, "session_run", threadId)).resolves.toBe(1);
      await expect(countSessionRows(database, "session_message", threadId)).resolves.toBe(1);
      await expect(
        countPublicApiIdempotencyRows(database, PUBLIC_API_TEST_IDS.patOwner, idempotencyKey),
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
        userId: "customer-123",
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

  test("requires a non-empty userId when creating a Thread", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
        body: JSON.stringify({}),
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
      message: "userId is required.",
    });
  });

  test("treats userId as part of create Thread idempotency identity", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublicThreadApiTestApp();
    const createRequest = (userId: string) =>
      new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
        body: JSON.stringify({ userId }),
        headers: {
          Authorization: bearer(TOKENS.owner),
          "Content-Type": "application/json",
          "Idempotency-Key": "thread-create-user-conflict",
        },
        method: "POST",
      });

    await withProviderProbeMock(async () => {
      const first = await requestPublicApi(app, database, createRequest("customer-1"));
      expect(first.status).toBe(201);

      const conflict = await requestPublicApi(app, database, createRequest("customer-2"));
      expect(conflict.status).toBe(409);
      expect(expectRecord(await readJson(conflict))["error"]).toMatchObject({
        code: "idempotency_conflict",
      });
    });
  });
});
