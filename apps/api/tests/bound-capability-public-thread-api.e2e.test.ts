import { describe, expect, test } from "bun:test";

import { sessionRunsTable, sessionsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { insertSessionMessage } from "../src/modules/sessions/infrastructure/session-message-store.repository";
import {
  BOUND_DEPLOYMENT_ID,
  BOUND_DEPLOYMENT_RUN_ID,
  BOUND_OTHER_DEPLOYMENT_ID,
  BOUND_OTHER_DEPLOYMENT_RUN_ID,
  BOUND_REPLACEMENT_DEPLOYMENT_RUN_ID,
  BOUND_BINDING,
  boundCapabilityClaims,
  createBoundCapabilityClient,
  createBoundDeploymentAuthoritySchema,
  createBoundTestBindings,
  deleteBoundDeployment,
  insertBoundDeployment,
  insertBoundDeploymentRun,
} from "./bound-capability-fixtures";
import {
  PublicApiMemoryFileBucket,
  PUBLIC_API_TEST_IDS,
  TOKENS,
  createPublicHttpContractDatabase,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";
import {
  bearer,
  createPublicThreadApiTestApp,
  expectArray,
  expectRecord,
  expectString,
  readJson,
  requestPublicApiWithBindings,
  withProviderProbeMock,
} from "./public-thread-api-fixtures";

const ATTACHMENT_BODY = "Avatar bytes.\n";
const ARTIFACT_BODY = "PK codex-pet.zip";
const FINAL_OUTPUT_TEXT = "Your pet is ready: outputs/codex-pet.zip";

interface BoundSurface {
  bindings: ReturnType<typeof createBoundTestBindings>;
  bucket: PublicApiMemoryFileBucket;
  database: SqliteD1Database;
  ownerRequest: (path: string, init?: RequestInit) => Promise<Response>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  token: string;
}

async function createBoundSurface(claims = boundCapabilityClaims()): Promise<BoundSurface> {
  const database = await createPublicHttpContractDatabase();
  createBoundDeploymentAuthoritySchema(database);
  await insertBoundDeployment(database);

  const app = createPublicThreadApiTestApp();
  const bucket = new PublicApiMemoryFileBucket();
  const bindings = createBoundTestBindings(database, {
    fileBucket: bucket as unknown as R2Bucket,
  });
  const client = await createBoundCapabilityClient({ app, bindings, claims });

  return {
    bindings,
    bucket,
    database,
    ownerRequest: (path, init) =>
      requestPublicApiWithBindings(
        app,
        new Request(`https://api.example.com/api/v1${path}`, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            Authorization: bearer(TOKENS.owner),
          },
        }),
        bindings,
      ),
    request: client.request,
    token: client.token,
  };
}

function attachmentForm(name = "avatar.png", body = ATTACHMENT_BODY): FormData {
  const formData = new FormData();
  formData.set("file", new File([new TextEncoder().encode(body)], name, { type: "image/png" }));
  return formData;
}

function createThreadBody(fileId: string, userId = "end-user-42"): string {
  return JSON.stringify({
    input: {
      content: [{ text: "Turn the attached avatar into a pet.", type: "text" }],
      type: "user.message",
    },
    resources: [{ file_id: fileId, type: "file" }],
    userId,
  });
}

async function uploadAttachment(surface: BoundSurface): Promise<string> {
  const response = await surface.request("/files", { body: attachmentForm(), method: "POST" });

  expect(response.status).toBe(201);
  const file = expectRecord(expectRecord(await readJson(response))["file"]);
  expect(file).toMatchObject({ name: "avatar.png", size: ATTACHMENT_BODY.length });

  return expectString(file["id"]);
}

async function createThread(
  surface: BoundSurface,
  fileId: string,
): Promise<{ runId: string; threadId: string }> {
  const response = await surface.request("/threads", {
    body: createThreadBody(fileId),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  expect(response.status).toBe(201);
  const payload = await readJson(response);
  const run = expectRecord(payload["run"]);
  expect(["queued", "running"]).toContain(run["status"]);

  return {
    runId: expectString(run["id"]),
    threadId: expectString(expectRecord(payload["thread"])["id"]),
  };
}

async function readRunProvenance(
  database: SqliteD1Database,
  runId: string,
): Promise<Record<string, unknown> | null> {
  return database
    .prepare(
      `SELECT bound_capability_agent_id, bound_capability_app_id, bound_capability_binding_env,
              bound_capability_binding_name, bound_capability_deployment_id,
              bound_capability_deployment_run_id
         FROM session_run
        WHERE id = ?`,
    )
    .bind(runId)
    .first<Record<string, unknown>>();
}

async function simulateArtifactAndCompletion(
  surface: BoundSurface,
  input: { runId: string; threadId: string },
): Promise<string> {
  const artifactId = PUBLIC_API_TEST_IDS.fileAlt;
  const objectKey = `session/${input.threadId}/artifact/${artifactId}/codex-pet.zip`;

  await surface.database
    .prepare(
      `INSERT INTO file_record (
         id, scope_kind, scope_id, session_kind, status, name, path, parent_path, object_key,
         owner_id, owner_kind, purpose, expires_at, mime_type, size, etag, committed, version,
         created_by_account_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      artifactId,
      "session",
      input.threadId,
      "artifact",
      "ready",
      "codex-pet.zip",
      `artifact/${artifactId}/codex-pet.zip`,
      `artifact/${artifactId}`,
      objectKey,
      input.threadId,
      "session",
      "session_artifact",
      null,
      "application/zip",
      ARTIFACT_BODY.length,
      null,
      1,
      1,
      PUBLIC_API_TEST_IDS.ownerAccount,
      2,
      2,
    )
    .run();
  await surface.bucket.put(objectKey, ARTIFACT_BODY, {
    httpMetadata: { contentType: "application/zip" },
  });

  await insertSessionMessage(surface.database, {
    content: FINAL_OUTPUT_TEXT,
    createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
    role: "assistant",
    segments: [{ kind: "text", text: FINAL_OUTPUT_TEXT }],
    sessionId: input.threadId,
    sessionRunId: input.runId,
  });
  await surface.database
    .app()
    .update(sessionRunsTable)
    .set({
      completedAt: 1_150,
      errorCode: null,
      errorDetailsJson: null,
      errorMessage: null,
      status: "completed",
      updatedAt: 1_150,
    })
    .where(eq(sessionRunsTable.id, input.runId))
    .run();
  await surface.database
    .app()
    .update(sessionsTable)
    .set({ lastRunId: input.runId, status: "IDLE", updatedAt: 1_150 })
    .where(eq(sessionsTable.id, input.threadId))
    .run();

  return artifactId;
}

describe("bound capability Public Thread API e2e", () => {
  test("runs upload -> Thread/Run -> artifact download through the deployment identity", async () => {
    const surface = await createBoundSurface();

    await withProviderProbeMock(async () => {
      const fileId = await uploadAttachment(surface);
      const draftRow = await surface.database
        .prepare(
          "SELECT created_by_account_id, owner_id, purpose, scope_kind FROM file_record WHERE id = ?",
        )
        .bind(fileId)
        .first<Record<string, unknown>>();
      expect(draftRow).toEqual({
        created_by_account_id: PUBLIC_API_TEST_IDS.ownerAccount,
        owner_id: PUBLIC_API_TEST_IDS.app,
        purpose: "app_draft",
        scope_kind: "app_draft",
      });

      // A capability only sees a file once it is attached to one of its Threads.
      const draftLookup = await surface.request(`/files/${fileId}`);
      expect(draftLookup.status).toBe(404);

      const { runId, threadId } = await createThread(surface, fileId);

      const sessionRow = await surface.database
        .prepare(
          "SELECT agent_id, app_id, creator_account_id, end_user_id, metadata_json FROM session WHERE id = ?",
        )
        .bind(threadId)
        .first<{
          agent_id: string;
          app_id: string;
          creator_account_id: string;
          end_user_id: string;
          metadata_json: string;
        }>();
      expect(sessionRow).toMatchObject({
        agent_id: PUBLIC_API_TEST_IDS.agent,
        app_id: PUBLIC_API_TEST_IDS.app,
        creator_account_id: PUBLIC_API_TEST_IDS.ownerAccount,
        end_user_id: "end-user-42",
      });
      expect(JSON.parse(sessionRow?.metadata_json ?? "{}")).toEqual({
        public_api: {
          created_by: {
            binding_env: BOUND_BINDING.env,
            binding_name: BOUND_BINDING.name,
            deployment_id: BOUND_DEPLOYMENT_ID,
            deployment_run_id: BOUND_DEPLOYMENT_RUN_ID,
            kind: "deployment_capability",
          },
          idempotency_key: null,
          source: "public_api",
        },
      });

      expect(await readRunProvenance(surface.database, runId)).toEqual({
        bound_capability_agent_id: PUBLIC_API_TEST_IDS.agent,
        bound_capability_app_id: PUBLIC_API_TEST_IDS.app,
        bound_capability_binding_env: BOUND_BINDING.env,
        bound_capability_binding_name: BOUND_BINDING.name,
        bound_capability_deployment_id: BOUND_DEPLOYMENT_ID,
        bound_capability_deployment_run_id: BOUND_DEPLOYMENT_RUN_ID,
      });

      const claimedRow = await surface.database
        .prepare("SELECT scope_id, scope_kind, session_kind FROM file_record WHERE id = ?")
        .bind(fileId)
        .first<Record<string, unknown>>();
      expect(claimedRow).toEqual({
        scope_id: threadId,
        scope_kind: "session",
        session_kind: "attachment",
      });

      const pending = await surface.request(`/threads/${threadId}`);
      expect(pending.status).toBe(200);
      const pendingPayload = await readJson(pending);
      expect(expectRecord(pendingPayload["thread"])["id"]).toBe(threadId);
      expect(expectRecord(pendingPayload["run"])["id"]).toBe(runId);
      expect(expectRecord(pendingPayload["run"])["status"]).not.toBe("completed");
      // Responses never echo the capability token back to the deployed App.
      expect(JSON.stringify(pendingPayload)).not.toContain(surface.token);

      const events = await surface.request(`/threads/${threadId}/events`);
      expect(events.status).toBe(200);
      expectArray((await readJson(events))["events"]);

      const artifactId = await simulateArtifactAndCompletion(surface, { runId, threadId });

      const completed = await surface.request(`/threads/${threadId}`);
      expect(completed.status).toBe(200);
      expect(expectRecord((await readJson(completed))["run"])).toMatchObject({
        finalOutput: { text: FINAL_OUTPUT_TEXT },
        id: runId,
        status: "completed",
      });

      const listed = await surface.request(`/threads/${threadId}/files`);
      expect(listed.status).toBe(200);
      const files = expectArray((await readJson(listed))["files"]).map((file) =>
        expectRecord(file),
      );
      expect(files.map((file) => [file["id"], file["kind"], file["name"]])).toEqual(
        expect.arrayContaining([
          [fileId, "attachment", "avatar.png"],
          [artifactId, "artifact", "codex-pet.zip"],
        ]),
      );

      const artifactMetadata = await surface.request(`/files/${artifactId}`);
      expect(artifactMetadata.status).toBe(200);
      expect(expectRecord((await readJson(artifactMetadata))["file"])).toMatchObject({
        id: artifactId,
        name: "codex-pet.zip",
      });

      const download = await surface.request(`/files/${artifactId}/content?disposition=attachment`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toStartWith("application/zip");
      expect(download.headers.get("content-disposition")).toContain('filename="codex-pet.zip"');
      expect(await download.text()).toBe(ARTIFACT_BODY);

      const threads = await surface.request("/threads");
      expect(threads.status).toBe(200);
      expect(
        expectArray((await readJson(threads))["threads"]).map(
          (thread) => expectRecord(thread)["id"],
        ),
      ).toEqual([threadId]);

      // Continue the Thread: the follow-up Run carries the same provenance.
      const followUp = await surface.request(`/threads/${threadId}/events`, {
        body: JSON.stringify({
          events: [{ text: "Make the tail longer.", type: "user_message" }],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(followUp.status).toBe(200);
      const followUpEvent = expectRecord(
        expectArray(expectRecord(await readJson(followUp))["events"])[0],
      );
      const followUpRunId = expectString(expectRecord(followUpEvent["run"])["id"]);
      expect(followUpRunId).not.toBe(runId);
      expect(await readRunProvenance(surface.database, followUpRunId)).toMatchObject({
        bound_capability_deployment_id: BOUND_DEPLOYMENT_ID,
        bound_capability_deployment_run_id: BOUND_DEPLOYMENT_RUN_ID,
      });
    });
  });

  test("keeps the capability inside its App, declared Agent, and Deployment", async () => {
    const surface = await createBoundSurface();
    await insertBoundDeployment(surface.database, {
      deploymentId: BOUND_OTHER_DEPLOYMENT_ID,
      deploymentRunId: BOUND_OTHER_DEPLOYMENT_RUN_ID,
    });
    const otherDeployment = await createBoundCapabilityClient({
      app: createPublicThreadApiTestApp(),
      bindings: surface.bindings,
      claims: boundCapabilityClaims({
        deploymentId: BOUND_OTHER_DEPLOYMENT_ID,
        deploymentRunId: BOUND_OTHER_DEPLOYMENT_RUN_ID,
      }),
    });

    await withProviderProbeMock(async () => {
      const fileId = await uploadAttachment(surface);
      const { threadId } = await createThread(surface, fileId);

      // The owner's own Access Token Thread for the same Agent is invisible.
      const ownerThread = await surface.ownerRequest(
        `/agents/${PUBLIC_API_TEST_IDS.agent}/threads`,
        {
          body: JSON.stringify({ userId: "owner-customer" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      expect(ownerThread.status).toBe(201);
      const ownerThreadId = expectString(
        expectRecord(expectRecord(await readJson(ownerThread))["thread"])["id"],
      );

      for (const path of [
        `/threads/${ownerThreadId}`,
        `/threads/${ownerThreadId}/events`,
        `/threads/${ownerThreadId}/files`,
        `/files/${PUBLIC_API_TEST_IDS.file}/content`,
      ]) {
        const response = await surface.request(path);
        expect(response.status).toBe(404);
      }
      const ownerThreadContinue = await surface.request(`/threads/${ownerThreadId}/events`, {
        body: JSON.stringify({ events: [{ text: "hijack", type: "user_message" }] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(ownerThreadContinue.status).toBe(404);

      // Another Deployment of the same App and Agent cannot see this Thread.
      const crossDeployment = await otherDeployment.request(`/threads/${threadId}`);
      expect(crossDeployment.status).toBe(404);
      const crossDeploymentList = await otherDeployment.request("/threads");
      expect(crossDeploymentList.status).toBe(200);
      expect(expectArray((await readJson(crossDeploymentList))["threads"])).toEqual([]);

      // The owner still sees the deployment's Thread through the Access Token API.
      const ownerView = await surface.ownerRequest(`/threads/${threadId}`);
      expect(ownerView.status).toBe(200);

      // A capability minted for an Agent outside the App is refused outright.
      const foreignAgent = await createBoundCapabilityClient({
        app: createPublicThreadApiTestApp(),
        bindings: surface.bindings,
        claims: boundCapabilityClaims({ appId: PUBLIC_API_TEST_IDS.organization }),
      });
      const foreignUpload = await foreignAgent.request("/files", {
        body: attachmentForm(),
        method: "POST",
      });
      expect(foreignUpload.status).toBe(409);
      expect(expectRecord(await readJson(foreignUpload))["error"]).toMatchObject({
        code: "agent_not_published",
      });

      // A tampered token never authenticates.
      const forged = await requestPublicApiWithBindings(
        createPublicThreadApiTestApp(),
        new Request(`https://api.example.com/api/v1/bound/${surface.token}x/threads`),
        surface.bindings,
      );
      expect(forged.status).toBe(401);
    });
  });

  test("rejects every bound operation once the deployment is removed or replaced", async () => {
    const surface = await createBoundSurface();

    await withProviderProbeMock(async () => {
      const fileId = await uploadAttachment(surface);
      const { threadId } = await createThread(surface, fileId);

      await deleteBoundDeployment(surface.database);

      const revokedError = {
        code: "agent_not_published",
        message: "This capability is no longer authorized for the active deployment.",
      };

      for (const [path, init] of [
        [`/threads/${threadId}`, undefined],
        [`/threads/${threadId}/files`, undefined],
        ["/threads", undefined],
        ["/files", { body: attachmentForm(), method: "POST" }],
        [
          "/threads",
          {
            body: createThreadBody(fileId),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          },
        ],
        [
          `/threads/${threadId}/events`,
          {
            body: JSON.stringify({ events: [{ text: "again", type: "user_message" }] }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          },
        ],
      ] as const) {
        const response = await surface.request(path, init);
        expect(response.status).toBe(409);
        expect(expectRecord(await readJson(response))["error"]).toEqual(revokedError);
      }

      // The owner keeps full access to the Thread the deployment created.
      const ownerView = await surface.ownerRequest(`/threads/${threadId}`);
      expect(ownerView.status).toBe(200);
    });

    // A successful replacement revision that drops the binding revokes the old URL.
    const replaced = await createBoundSurface();
    await insertBoundDeploymentRun(replaced.database, {
      agentBindings: [],
      deploymentId: BOUND_DEPLOYMENT_ID,
      deploymentRunId: BOUND_REPLACEMENT_DEPLOYMENT_RUN_ID,
    });
    const response = await replaced.request("/files", { body: attachmentForm(), method: "POST" });
    expect(response.status).toBe(409);
  });

  test("replays an idempotent create across capability revisions of one deployment", async () => {
    const surface = await createBoundSurface();

    await withProviderProbeMock(async () => {
      const fileId = await uploadAttachment(surface);
      const body = createThreadBody(fileId);
      const headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": "pet-7",
      };

      const first = await surface.request("/threads", { body, headers, method: "POST" });
      expect(first.status).toBe(201);
      const threadId = expectString(expectRecord((await readJson(first))["thread"])["id"]);

      // Redeploy: the new revision keeps the binding, so the old token is
      // replaced and the Worker retries with the freshly minted URL.
      await insertBoundDeploymentRun(surface.database, {
        agentBindings: [BOUND_BINDING],
        deploymentId: BOUND_DEPLOYMENT_ID,
        deploymentRunId: BOUND_REPLACEMENT_DEPLOYMENT_RUN_ID,
      });
      const nextRevision = await createBoundCapabilityClient({
        app: createPublicThreadApiTestApp(),
        bindings: surface.bindings,
        claims: boundCapabilityClaims({ deploymentRunId: BOUND_REPLACEMENT_DEPLOYMENT_RUN_ID }),
      });

      const staleRetry = await surface.request("/threads", { body, headers, method: "POST" });
      expect(staleRetry.status).toBe(409);

      const retry = await nextRevision.request("/threads", { body, headers, method: "POST" });
      expect(retry.status).toBe(201);
      expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
      expect(expectRecord((await readJson(retry))["thread"])["id"]).toBe(threadId);

      // The new revision reads the Thread the previous revision created.
      const retrieve = await nextRevision.request(`/threads/${threadId}`);
      expect(retrieve.status).toBe(200);
    });
  });

  test("cleans up the Thread when deletion wins the guarded Run insert race", async () => {
    const surface = await createBoundSurface();
    const revoking = revokeDeploymentWhenRunInsertStarts(surface.database);
    const bindings = createBoundTestBindings(revoking as unknown as SqliteD1Database, {
      fileBucket: surface.bucket as unknown as R2Bucket,
    });
    const client = await createBoundCapabilityClient({
      app: createPublicThreadApiTestApp(),
      bindings,
    });

    await withProviderProbeMock(async () => {
      const response = await client.request("/threads", {
        body: JSON.stringify({
          input: { content: [{ text: "Hello", type: "text" }], type: "user.message" },
          userId: "end-user-42",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(409);
      expect(expectRecord(await readJson(response))["error"]).toEqual({
        code: "agent_not_published",
        message: "This capability is no longer authorized for the active deployment.",
      });
      await expect(
        surface.database
          .prepare("SELECT COUNT(*) AS count FROM session")
          .first<{ count: number }>(),
      ).resolves.toEqual({ count: 0 });
      await expect(
        surface.database
          .prepare("SELECT COUNT(*) AS count FROM session_run")
          .first<{ count: number }>(),
      ).resolves.toEqual({ count: 0 });
    });
  });
});

function revokeDeploymentWhenRunInsertStarts(database: SqliteD1Database): D1Database {
  let revoked = false;

  function wrapStatement(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    const shouldRevoke = /\bINSERT\s+INTO\s+(?:"session_run"|session_run)(?:\s|\()/iu.test(query);

    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), query);
        }

        if (
          shouldRevoke &&
          !revoked &&
          (property === "all" || property === "first" || property === "raw" || property === "run")
        ) {
          const method = Reflect.get(target, property, receiver);

          if (typeof method === "function") {
            return async (...args: unknown[]) => {
              revoked = true;
              await deleteBoundDeployment(database);
              return method.apply(target, args);
            };
          }
        }

        return Reflect.get(target, property, receiver);
      },
    });
  }

  return {
    batch: database.batch.bind(database),
    prepare: (query) => wrapStatement(database.prepare(query), query),
  } as D1Database;
}
