import { describe, expect, test } from "bun:test";

import { PUBLISHED_AGENT_THREADS_MAX_LIMIT } from "@mosoo/contracts/public-api";
import { sessionsTable } from "@mosoo/db";

import {
  createOrganizationServiceToken,
  listOrganizationServiceTokens,
  revokeOrganizationServiceToken,
} from "../src/modules/auth/application/organization-service-token.service";
import {
  completeFileUpload,
  createFileUpload,
  uploadFileContent,
} from "../src/modules/files/application/file-http.service";
import {
  PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE,
  enforcePublishedApiRateLimit,
} from "../src/modules/public-api/published-agent-rate-limit.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PublicApiMemoryFileBucket,
  PUBLIC_API_TEST_IDS,
  TOKENS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/published-agent-http-test-fixture";
import {
  MEMBER_VIEWER,
  OWNER_VIEWER,
  bearer,
  createPublishedApiTestApp,
  expectArray,
  expectRecord,
  expectString,
  insertRuntimeEvent,
  readJson,
  requestPublicApi,
  withProviderProbeMock,
} from "./published-agent-public-thread-api-fixtures";

const PUBLIC_THREAD_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

type PublicHttpTestDatabase = Awaited<ReturnType<typeof createPublicHttpContractDatabase>>;

async function createReadyOrganizationDraftFile(input: {
  body: string;
  bucket: PublicApiMemoryFileBucket;
  database: PublicHttpTestDatabase;
  name: string;
}): Promise<string> {
  const bindings = createPublicHttpTestBindings(input.database, {
    fileBucket: input.bucket as unknown as R2Bucket,
  }) as ApiBindings;
  const fileBytes = new TextEncoder().encode(input.body);
  const upload = await createFileUpload(bindings, OWNER_VIEWER, {
    file: {
      contentType: "text/plain",
      name: input.name,
      size: fileBytes.byteLength,
    },
    purpose: "organization_draft",
    target: {
      id: PUBLIC_API_TEST_IDS.organization,
      kind: "organization_draft",
      name: input.name,
    },
  });
  const uploadBody = new Request("https://api.example.com/upload", {
    body: input.body,
    method: "POST",
  }).body;

  await uploadFileContent(bindings, OWNER_VIEWER, upload.fileId, uploadBody);
  await completeFileUpload({
    bindings,
    fileId: upload.fileId,
    input: {},
    viewer: OWNER_VIEWER,
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
          attributed_user_id: null,
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
      organizationId: PUBLIC_API_TEST_IDS.organization,
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

describe("Published Agent Public Thread API e2e", () => {
  test("manages Organization Service tokens with selected Agent allowlists", async () => {
    const database = await createPublicHttpContractDatabase();

    await expect(
      createOrganizationServiceToken(database, MEMBER_VIEWER, {
        allowAttribution: true,
        allowedAgentIds: [PUBLIC_API_TEST_IDS.agent],
        label: "Member attempt",
        organizationId: PUBLIC_API_TEST_IDS.organization,
      }),
    ).rejects.toThrow("You do not have permission to perform this action.");

    const created = await createOrganizationServiceToken(database, OWNER_VIEWER, {
      allowAttribution: true,
      allowedAgentIds: [PUBLIC_API_TEST_IDS.agent],
      label: "Slack adapter",
      organizationId: PUBLIC_API_TEST_IDS.organization,
    });
    expect(created.value.startsWith("grt_svc_")).toBeTrue();
    expect(created.token).toMatchObject({
      allowAttribution: true,
      allowedAgentIds: [PUBLIC_API_TEST_IDS.agent],
      createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      label: "Slack adapter",
      organizationId: PUBLIC_API_TEST_IDS.organization,
      revokedAt: null,
    });

    const listed = await listOrganizationServiceTokens(
      database,
      OWNER_VIEWER,
      PUBLIC_API_TEST_IDS.organization,
    );
    expect(listed.tokens.find((token) => token.id === created.token.id)).toMatchObject({
      allowedAgentIds: [PUBLIC_API_TEST_IDS.agent],
      label: "Slack adapter",
    });

    await revokeOrganizationServiceToken(database, OWNER_VIEWER, created.token.id);
    const afterRevoke = await listOrganizationServiceTokens(
      database,
      OWNER_VIEWER,
      PUBLIC_API_TEST_IDS.organization,
    );
    expect(
      afterRevoke.tokens.find((token) => token.id === created.token.id)?.revokedAt,
    ).toBeString();
  });

  test("creates, retrieves, and lists a Thread without a Task wrapper", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublishedApiTestApp();

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
        created_by: { id: PUBLIC_API_TEST_IDS.ownerAccount, kind: "human_pat" },
        id: threadId,
        source: "api",
      });
      expect(threadId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(run["id"]).toBeString();
      expect(run["trigger"]).toBe("user_prompt");
      expectNoProperties(run, [
        "deploymentVersionId",
        "deploymentVersionNumber",
        "error",
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

      await database
        .prepare(
          `UPDATE organization_member
              SET disabled_at = ?
            WHERE organization_id = ?
              AND account_id = ?`,
        )
        .bind(9_999, PUBLIC_API_TEST_IDS.organization, PUBLIC_API_TEST_IDS.ownerAccount)
        .run();
      const disabledOwnerEventsResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(disabledOwnerEventsResponse.status).toBe(403);
      expect(expectRecord(await readJson(disabledOwnerEventsResponse))["error"]).toMatchObject({
        code: "forbidden",
      });
    });
  });

  test("bounds public Thread lists on stable latest ordering", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublishedApiTestApp();

    for (let index = 0; index < PUBLISHED_AGENT_THREADS_MAX_LIMIT + 5; index += 1) {
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

    expect(threads).toHaveLength(PUBLISHED_AGENT_THREADS_MAX_LIMIT);
    expect(expectRecord(threads[0])["id"]).toBe(
      generatedPublicThreadId(PUBLISHED_AGENT_THREADS_MAX_LIMIT + 4),
    );
    expect(expectRecord(threads.at(-1))["id"]).toBe(generatedPublicThreadId(5));
  });

  test("lists Thread events through the creating Service token only", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublishedApiTestApp();

    await withProviderProbeMock(async () => {
      const response = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            input: {
              content: [{ text: "Run service token work.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.service),
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
        occurredAt: 2_000,
        payload: {
          startedAt: "1970-01-01T00:00:02.000Z",
        },
        runId,
        seq: 1,
        sessionId: threadId,
      });

      const serviceEventsResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.service) },
        }),
      );
      expect(serviceEventsResponse.status).toBe(200);
      expect(
        expectArray(expectRecord(await readJson(serviceEventsResponse))["events"]).length,
      ).toBe(1);

      const ownerEventsResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(ownerEventsResponse.status).toBe(404);

      await database
        .prepare(
          `DELETE FROM organization_service_token_agent
            WHERE token_id = ?
              AND agent_id = ?`,
        )
        .bind(PUBLIC_API_TEST_IDS.serviceToken, PUBLIC_API_TEST_IDS.agent)
        .run();
      const disallowedServiceEventsResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          headers: { Authorization: bearer(TOKENS.service) },
        }),
      );
      expect(disallowedServiceEventsResponse.status).toBe(403);
      expect(expectRecord(await readJson(disallowedServiceEventsResponse))["error"]).toMatchObject({
        code: "forbidden",
      });
    });
  });

  test("denies Service token Thread creation when the execution owner membership is disabled", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublishedApiTestApp();

    await database
      .prepare(
        `UPDATE organization_member
            SET disabled_at = ?
          WHERE organization_id = ?
            AND account_id = ?`,
      )
      .bind(9_999, PUBLIC_API_TEST_IDS.organization, PUBLIC_API_TEST_IDS.ownerAccount)
      .run();

    const response = await requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
        body: JSON.stringify({
          input: {
            content: [{ text: "Run service token work.", type: "text" }],
            type: "user.message",
          },
        }),
        headers: {
          Authorization: bearer(TOKENS.service),
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(expectRecord(await readJson(response))["error"]).toMatchObject({
      code: "forbidden",
    });
  });

  test("archives, unarchives, and manages Thread files through the public routes", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublishedApiTestApp();
    const bucket = new PublicApiMemoryFileBucket();
    const requestThreadApi = (request: Request) =>
      requestPublicApi(app, database, request, { fileBucket: bucket as unknown as R2Bucket });

    await withProviderProbeMock(async () => {
      const createThreadResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            input: {
              content: [{ text: "Read the attached launch note.", type: "text" }],
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

      const draftFileId = await createReadyOrganizationDraftFile({
        body: "Launch note.\n",
        bucket,
        database,
        name: "launch-note.txt",
      });
      const createFileResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/files`, {
          body: JSON.stringify({
            fileId: draftFileId,
          }),
          headers: {
            Authorization: bearer(TOKENS.owner),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(createFileResponse.status).toBe(201);
      const file = expectRecord(expectRecord(await readJson(createFileResponse))["file"]);
      const fileId = expectString(file["id"]);
      expect(file).toMatchObject({
        committed: true,
        kind: "attachment",
        mimeType: "text/plain",
        name: "launch-note.txt",
        size: 13,
      });

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

      const listedFilesResponse = await requestThreadApi(
        new Request(`https://api.example.com/api/v1/threads/${threadId}/files`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(listedFilesResponse.status).toBe(200);
      const listedFiles = expectArray(expectRecord(await readJson(listedFilesResponse))["files"]);
      expect(listedFiles).toHaveLength(1);
      expect(expectRecord(listedFiles[0])).toMatchObject({
        id: fileId,
        name: "launch-note.txt",
        size: 13,
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

  test("rejects invalid Thread event path inputs", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublishedApiTestApp();

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
    const app = createPublishedApiTestApp();
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
          `https://api.example.com/api/v1/threads/${PUBLIC_API_TEST_IDS.memberSession}/files/${invalidId}`,
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

  test("creates an attributed Thread through an allowed Service token", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublishedApiTestApp();

    await withProviderProbeMock(async () => {
      const response = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, {
          body: JSON.stringify({
            attributed_user_id: PUBLIC_API_TEST_IDS.memberAccount,
            input: {
              content: [{ text: "Open a Linear follow-up.", type: "text" }],
              type: "user.message",
            },
          }),
          headers: {
            Authorization: bearer(TOKENS.service),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(response.status).toBe(201);

      const body = await readJson(response);
      const thread = expectRecord(body["thread"]);
      const threadId = expectString(thread["id"]);
      expect(thread).toMatchObject({
        agent_id: PUBLIC_API_TEST_IDS.agent,
        attributed_user: { id: PUBLIC_API_TEST_IDS.memberAccount },
        created_by: { id: PUBLIC_API_TEST_IDS.serviceToken, kind: "service_token" },
        source: "api",
      });
      const initialRunId = expectString(expectRecord(body["run"])["id"]);

      const retrieveResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}`, {
          headers: { Authorization: bearer(TOKENS.service) },
        }),
      );
      expect(retrieveResponse.status).toBe(200);

      await database
        .prepare("UPDATE session_run SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?")
        .bind("completed", 1, 1, initialRunId)
        .run();
      await database
        .prepare("UPDATE session SET status = ? WHERE id = ?")
        .bind("IDLE", threadId)
        .run();

      const followUpResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
          body: JSON.stringify({
            events: [
              {
                text: "Continue the follow-up.",
                type: "user_message",
              },
            ],
          }),
          headers: {
            Authorization: bearer(TOKENS.member),
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      expect(followUpResponse.status).toBe(200);
      expect(expectRecord(await readJson(followUpResponse))["thread"]).toMatchObject({
        id: threadId,
      });

      const archiveResponse = await requestPublicApi(
        app,
        database,
        new Request(`https://api.example.com/api/v1/threads/${threadId}/archive`, {
          headers: { Authorization: bearer(TOKENS.member) },
          method: "POST",
        }),
      );
      expect(archiveResponse.status).toBe(200);
      expect(await readJson(archiveResponse)).toEqual({ ok: true });
    });
  });

  test("replays create Thread responses by Idempotency-Key", async () => {
    const database = await createPublicHttpContractDatabase();
    const app = createPublishedApiTestApp();
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
    const app = createPublishedApiTestApp();
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
      await enforcePublishedApiRateLimit(database, PUBLIC_API_TEST_IDS.patOwner);
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
    const app = createPublishedApiTestApp();
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
