import { describe, expect, spyOn, test } from "bun:test";

import { createProjectApiKey } from "../src/modules/auth/application/personal-access-token.service";
import * as runtimePrewarm from "../src/modules/runtime/application/session-runs/prewarm-agent-session-runtime.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { systemClock } from "../src/time";
import {
  PUBLIC_API_TEST_IDS as IDS,
  TOKENS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import {
  OWNER_VIEWER,
  bearer,
  createPublicThreadApiTestApp,
  createPublicEventSessionNamespace,
  expectArray,
  expectRecord,
  expectString,
  readJson,
  requestPublicApiWithBindings,
  insertRuntimeEvent,
  withProviderProbeMock,
} from "./public-thread-api-fixtures";

async function setup(
  options: {
    budgetPolicy?: string;
    sessionNamespace?: ApiBindings["Session"];
    requestDatabase?: (database: D1Database) => D1Database;
  } = {},
) {
  const database = await createPublicHttpContractDatabase();
  const key = await createProjectApiKey(database, OWNER_VIEWER, {
    label: "Session HTTP test",
    projectId: IDS.project,
  });
  const app = createPublicThreadApiTestApp();
  const bucket = new PublicApiMemoryFileBucket();
  const requestDatabase = options.requestDatabase?.(database) ?? database;
  const request = (path: string, init: RequestInit = {}, token = key.value) =>
    requestPublicApiWithBindings(
      app,
      new Request(`https://api.example.com/api/${path}`, {
        ...init,
        headers: { Authorization: bearer(token), ...init.headers },
      }),
      {
        ...createPublicHttpTestBindings(requestDatabase, {
          fileBucket: bucket as unknown as R2Bucket,
          ...options,
        }),
        MOSOO_TURN_BUDGET_POLICY: options.budgetPolicy,
      } as ApiBindings,
    );
  const createAt = (path: string, body: unknown, idempotencyKey?: string) =>
    request(path, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      method: "POST",
    });
  const create = (version: "v1" | "v2", body: unknown, idempotencyKey?: string) =>
    createAt(`${version}/agents/${IDS.agent}/threads`, body, idempotencyKey);
  const createProject = (body: unknown, idempotencyKey?: string) =>
    createAt(`v2/projects/${IDS.project}/threads`, body, idempotencyKey);
  const snapshot = async (id: string) => {
    const row = await database
      .prepare("SELECT plan_json FROM session_execution_snapshot WHERE session_id = ?")
      .bind(id)
      .first<{ plan_json: string }>();
    return expectRecord(JSON.parse(expectString(row?.plan_json)));
  };
  return { bucket, create, createProject, database, request, snapshot };
}

// Simulate a lost D1 response after its transaction committed. The HTTP boundary
// must reconcile this ambiguous outcome without deleting or repeating admitted work.
function loseCommittedBatchResponse(
  database: D1Database,
  sqlFragment: string,
  enabled = () => true,
): D1Database {
  const rawStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const queries = new WeakMap<D1PreparedStatement, string>();
  let failed = false;
  const wrap = (statement: D1PreparedStatement, query: string): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values), query);
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    rawStatements.set(wrapped, statement);
    queries.set(wrapped, query);
    return wrapped;
  };
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "prepare") return (query: string) => wrap(target.prepare(query), query);
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const matches = statements.some((statement) =>
            queries.get(statement)?.includes(sqlFragment),
          );
          const results = await target.batch(
            statements.map((statement) => rawStatements.get(statement) ?? statement),
          );
          if (!failed && matches && enabled()) {
            failed = true;
            throw new Error("Injected lost D1 commit response.");
          }
          return results;
        };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// These tests exercise HTTP authentication/admission and the real Session store.
// Runtime provisioning is intentionally absent; live tool/restore evidence is separate.
describe("Project direct Session API v2", () => {
  const configuration = {
    type: "inline",
    harness: "openai-runtime",
    provider: "openai",
    model: "gpt-5.4",
    instructions: "Use the supplied files and preserve these instructions.",
  };

  test("uploads and admits exactly one Session and Run without an Agent", async () => {
    const { createProject, database, request, snapshot } = await setup();
    await database.prepare("DELETE FROM agent").run();
    const form = new FormData();
    form.set("file", new File(["a,b\n1,2\n"], "input.csv", { type: "text/csv" }));
    const upload = await request(`v2/projects/${IDS.project}/files`, {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(201);
    const fileId = expectString(expectRecord((await readJson(upload))["file"])["id"]);
    const body = {
      configuration,
      resources: [{ type: "file", file_id: fileId }],
      input: { type: "user.message", content: [{ type: "text", text: "Analyze the CSV." }] },
    };
    await withProviderProbeMock(async () => {
      const response = await createProject(body, "direct-once");
      expect(response.status).toBe(201);
      const created = await readJson(response);
      const thread = expectRecord(created["thread"]);
      const id = expectString(thread["id"]);
      expect(thread["agent_id"]).toBeNull();
      expect(expectRecord(await snapshot(id))["binding"]).toMatchObject({
        agentId: null,
        prompt: configuration.instructions,
      });
      const retry = await createProject(body, "direct-once");
      expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await readJson(retry)).toEqual(created);
      expect(
        (
          await createProject(
            {
              ...body,
              configuration: { ...configuration, instructions: "Different instructions." },
            },
            "direct-once",
          )
        ).status,
      ).toBe(409);
      expect(await database.prepare("SELECT count(*) AS count FROM agent").first()).toEqual({
        count: 0,
      });
      expect(await database.prepare("SELECT count(*) AS count FROM session").first()).toEqual({
        count: 1,
      });
      expect(
        await database
          .prepare("SELECT count(*) AS count FROM session_run WHERE agent_id IS NULL")
          .first(),
      ).toEqual({ count: 1 });
      expect((await request(`v2/threads/${id}`)).status).toBe(200);
      expect((await request(`v1/threads/${id}`)).status).toBe(404);
      expect(await (await request(`v2/files/${fileId}/content`)).text()).toBe("a,b\n1,2\n");
    });
  });

  test("recovers a committed inline Session without repeating creation", async () => {
    const { createProject, database } = await setup({
      requestDatabase: (db) =>
        loseCommittedBatchResponse(db, 'insert into "session_execution_snapshot"'),
    });
    await database.prepare("DELETE FROM agent").run();
    await withProviderProbeMock(async () => {
      expect((await createProject({ configuration }, "direct-recover")).status).toBe(500);
      const row = await database.prepare("SELECT id FROM session").first<{ id: string }>();
      await database
        .prepare("UPDATE public_api_idempotency_key SET updated_at = ? WHERE idempotency_key = ?")
        .bind(Date.now() - 11 * 60 * 1000, "direct-recover")
        .run();
      const retry = await createProject({ configuration }, "direct-recover");
      expect(retry.status).toBe(201);
      expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
      expect(expectRecord((await readJson(retry))["thread"])["id"]).toBe(row?.id);
      expect(await database.prepare("SELECT count(*) AS count FROM session").first()).toEqual({
        count: 1,
      });
    });
  });

  test("keeps keys route-bound and recovers a frozen Session after its preset is deleted", async () => {
    let interrupt = false;
    const { create, createProject, database } = await setup({
      requestDatabase: (db) =>
        loseCommittedBatchResponse(db, 'insert into "session_execution_snapshot"', () => interrupt),
    });
    await withProviderProbeMock(async () => {
      const old = await readJson(await create("v2", {}, "shared-key"));
      const oldId = expectString(expectRecord(old["thread"])["id"]);
      interrupt = true;
      const body = { configuration: { type: "agent", agent_id: IDS.agent } };
      expect((await createProject(body, "shared-key")).status).toBe(409);
      expect((await createProject(body, "preset-recovery")).status).toBe(500);
      const row = await database
        .prepare("SELECT id FROM session WHERE id != ?")
        .bind(oldId)
        .first<{ id: string }>();
      await database.prepare("DELETE FROM agent").run();
      await database
        .prepare("UPDATE public_api_idempotency_key SET updated_at = ? WHERE idempotency_key = ?")
        .bind(Date.now() - 11 * 60 * 1000, "preset-recovery")
        .run();
      const retry = await createProject(body, "preset-recovery");
      expect(retry.status).toBe(201);
      expect(expectRecord((await readJson(retry))["thread"])["id"]).toBe(row?.id);
      expect(row?.id).not.toBe(oldId);
      expect(await database.prepare("SELECT count(*) AS count FROM session").first()).toEqual({
        count: 2,
      });
    });
  });

  test("rejects ambiguous configuration, unsupported selections and missing credentials before admission", async () => {
    const { createProject, database } = await setup();
    await withProviderProbeMock(async () => {
      for (const candidate of [
        { ...configuration, agent_id: IDS.agent },
        { type: "agent", agent_id: IDS.agent, instructions: "Hidden override" },
        { ...configuration, instructions: "" },
      ]) {
        const response = await createProject({ configuration: candidate });
        expect(response.status).toBe(400);
        expect((await readJson(response))["error"]).toMatchObject({ code: "invalid_request" });
      }
      for (const candidate of [
        { ...configuration, harness: "unsupported-runtime" },
        { ...configuration, provider: "unsupported-provider" },
        { ...configuration, harness: "claude-agent-sdk" },
        { ...configuration, model: "unavailable-model" },
      ]) {
        const response = await createProject({ configuration: candidate });
        expect(response.status).toBe(409);
        expect((await readJson(response))["error"]).toMatchObject({ code: "readiness_blocked" });
      }
      await database.prepare("DELETE FROM vendor_credential").run();
      expect((await createProject({ configuration })).status).toBe(409);
      expect(await database.prepare("SELECT count(*) AS count FROM session").first()).toEqual({
        count: 0,
      });
    });
  });

  test("denies a Project key on another Project before upload or execution", async () => {
    const { request, database } = await setup();
    const otherProject = "01J00000000000000000000099";
    await database
      .prepare(
        "INSERT INTO project (id, organization_id, owner_account_id, name, created_at, updated_at) VALUES (?, ?, ?, 'Other Project', 1, 1)",
      )
      .bind(otherProject, IDS.organization, IDS.ownerAccount)
      .run();
    const path = `v2/projects/${otherProject}`;
    const response = await request(`${path}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ configuration }),
    });
    expect(response.status).toBe(404);
    const form = new FormData();
    form.set("file", new File(["private"], "private.txt"));
    expect((await request(`${path}/files`, { method: "POST", body: form })).status).toBe(404);
    expect(await database.prepare("SELECT count(*) AS count FROM session").first()).toEqual({
      count: 0,
    });
  });

  test("keeps CLI login and replacement keys in the same explicit Project receipt boundary", async () => {
    const { request, database } = await setup({
      requestDatabase: (db) =>
        loseCommittedBatchResponse(db, 'insert into "session_execution_snapshot"'),
    });
    const path = `v2/projects/${IDS.project}/threads`;
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "cli-project-once" },
      body: JSON.stringify({ configuration }),
    };
    await withProviderProbeMock(async () => {
      expect((await request(path, init, TOKENS.outsider)).status).toBe(403);
      expect((await request(path, init, TOKENS.owner)).status).toBe(500);
      const row = await database.prepare("SELECT id FROM session").first<{ id: string }>();
      await database
        .prepare("UPDATE public_api_idempotency_key SET updated_at = ?")
        .bind(Date.now() - 11 * 60 * 1000)
        .run();
      const replacement = await createProjectApiKey(database, OWNER_VIEWER, {
        projectId: IDS.project,
        label: "Replacement key",
      });
      const recovered = await request(path, init, replacement.value);
      expect(recovered.status).toBe(201);
      expect(recovered.headers.get("Idempotency-Replayed")).toBe("true");
      const body = await readJson(recovered);
      expect(expectRecord(body["thread"])["id"]).toBe(row?.id);
      expect(await readJson(await request(path, init, TOKENS.owner))).toEqual(body);
      expect(await database.prepare("SELECT count(*) AS count FROM session").first()).toEqual({
        count: 1,
      });
    });
  });

  test("rejects a foreign preset and file even for CLI login owning both Projects", async () => {
    const { request, database } = await setup();
    const otherProject = "01J0000000000000000000007A";
    await database
      .prepare(
        "INSERT INTO project (id, organization_id, owner_account_id, name, created_at, updated_at) VALUES (?, ?, ?, 'Other Project', 1, 1)",
      )
      .bind(otherProject, IDS.organization, IDS.ownerAccount)
      .run();
    const form = new FormData();
    form.set("file", new File(["private"], "private.txt"));
    const upload = await request(
      `v2/projects/${otherProject}/files`,
      { method: "POST", body: form },
      TOKENS.owner,
    );
    expect(upload.status).toBe(201);
    const fileId = expectString(expectRecord((await readJson(upload))["file"])["id"]);
    await database
      .prepare("UPDATE agent SET project_id = ? WHERE id = ?")
      .bind(otherProject, IDS.agent)
      .run();
    const prewarm = spyOn(runtimePrewarm, "scheduleAgentSessionRuntimePrewarm");
    try {
      await withProviderProbeMock(async () => {
        for (const [body, status] of [
          [{ configuration: { type: "agent", agent_id: IDS.agent } }, 403],
          [{ configuration, resources: [{ type: "file", file_id: fileId }] }, 400],
        ] as const) {
          const response = await request(
            `v2/projects/${IDS.project}/threads`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            TOKENS.owner,
          );
          expect(response.status).toBe(status);
        }
        expect(await database.prepare("SELECT count(*) AS count FROM session").first()).toEqual({
          count: 0,
        });
        expect(prewarm).not.toHaveBeenCalled();
      });
    } finally {
      prewarm.mockRestore();
    }
  });
});

describe("saved-Agent Thread API v2", () => {
  test("records a caller's per-turn cap and rejects changed-budget idempotent retries", async () => {
    const { create, request } = await setup({ budgetPolicy: '{"defaultUsd":0.05,"maxUsd":1}' });
    await withProviderProbeMock(async () => {
      const body = {
        maxCostUsd: 0.02,
        input: { type: "user.message", content: [{ type: "text", text: "Read the input" }] },
      };
      const response = await create("v2", body, "bounded-create");
      expect(response.status).toBe(201);
      const created = await readJson(response);
      expect(expectRecord(created["run"])["budget"]).toEqual({
        capUsd: 0.02,
        estimatedCostUsd: 0,
        state: "available",
      });
      const id = expectString(expectRecord(created["thread"])["id"]);
      const retrieved = await readJson(await request(`v2/threads/${id}`));
      expect(expectRecord(retrieved["run"])["budget"]).toEqual({
        capUsd: 0.02,
        estimatedCostUsd: 0,
        state: "available",
      });
      expect((await create("v2", { ...body, maxCostUsd: 0.03 }, "bounded-create")).status).toBe(
        409,
      );
      expect((await create("v2", { ...body, maxCostUsd: 2 })).status).toBe(400);
      expect((await create("v2", { maxCostUsd: 0.02 })).status).toBe(400);
      const defaulted = await readJson(await create("v2", { input: body.input }));
      expect(expectRecord(defaulted["run"])["budget"]).toMatchObject({ capUsd: 0.05 });
    });
  });
  test.each(["recovery deadline", "read-only cutover"] as const)(
    "guards file transfer across %s",
    async (boundary) => {
      const { bucket, create, database, request } = await setup();
      await database.prepare("UPDATE agent SET kind = 'cattle' WHERE id = ?").bind(IDS.agent).run();
      await withProviderProbeMock(async () => {
        const created = await readJson(await create("v2", {}));
        const id = expectString(expectRecord(created["thread"])["id"]);
        const deadline = Date.now();
        const completedAt = deadline - 30 * 24 * 60 * 60 * 1000;
        await database
          .prepare(
            "INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, trigger, status, provider, model, runtime_id, trace_id, created_at, completed_at, updated_at) VALUES (?, ?, ?, ?, 'user_prompt', 'completed', 'openai', 'gpt-5.4', 'openai-runtime', 'expiry-boundary-fixture', ?, ?, ?)",
          )
          .bind(IDS.run, id, IDS.agent, IDS.ownerAccount, completedAt, completedAt, completedAt)
          .run();
        const upload = new FormData();
        upload.set("file", new File(["new work"], "next.txt"));
        const uploaded = await readJson(
          await request(`v2/agents/${IDS.agent}/files`, { method: "POST", body: upload }),
        );
        const fileId = expectString(expectRecord(uploaded["file"])["id"]);
        const clock = spyOn(systemClock, "nowMs").mockReturnValue(deadline - 1);
        const put = bucket.put.bind(bucket);
        const copy = spyOn(bucket, "put").mockImplementation(async (...args) => {
          const result = await put(...args);
          clock.mockReturnValue(deadline);
          if (boundary === "read-only cutover") {
            await database
              .prepare("UPDATE session SET status = 'TERMINATED' WHERE id = ?")
              .bind(id)
              .run();
          }
          return result;
        });
        try {
          const continuation = await request(`v2/threads/${id}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              events: [
                {
                  type: "user_message",
                  text: "Received before expiry.",
                  resources: [{ type: "file", file_id: fileId }],
                },
              ],
            }),
          });
          const files = await readJson(await request(`v2/threads/${id}/files`));
          if (boundary === "recovery deadline") {
            expect(continuation.status).toBe(200);
            const result = await readJson(continuation);
            expect(result["events"]).toMatchObject([{ run: { status: "queued" } }]);
            expect(files["files"]).toMatchObject([{ id: fileId, committed: true }]);
          } else {
            expect(files["files"]).toEqual([]);
            expect(continuation.status).toBe(400);
            expect(
              (await create("v2", { resources: [{ type: "file", file_id: fileId }] })).status,
            ).toBe(201);
            expect(await (await request(`v2/files/${fileId}/content`)).text()).toBe("new work");
          }
          expect(copy).toHaveBeenCalled();
        } finally {
          copy.mockRestore();
          clock.mockRestore();
        }
      });
    },
  );

  test.each(["recovery expiry", "reviewed read-only cutover"] as const)(
    "%s preserves history and files while allowing a fresh Session",
    async (reason) => {
      const { create, database, request } = await setup();
      await database.prepare("UPDATE agent SET kind = 'cattle' WHERE id = ?").bind(IDS.agent).run();
      await withProviderProbeMock(async () => {
        const savedFile = new FormData();
        savedFile.set("file", new File(["saved result"], "report.txt"));
        const uploadedSaved = await readJson(
          await request(`v2/agents/${IDS.agent}/files`, { method: "POST", body: savedFile }),
        );
        const savedId = expectString(expectRecord(uploadedSaved["file"])["id"]);
        const created = await readJson(
          await create("v2", { resources: [{ type: "file", file_id: savedId }] }),
        );
        const id = expectString(expectRecord(created["thread"])["id"]);
        await database
          .prepare("UPDATE file_record SET session_kind = 'artifact' WHERE id = ?")
          .bind(savedId)
          .run();
        const completedAt =
          Date.now() - (reason === "recovery expiry" ? 31 : 1) * 24 * 60 * 60 * 1000;
        await database
          .prepare(
            "INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, trigger, status, provider, model, runtime_id, trace_id, created_at, completed_at, updated_at) VALUES (?, ?, ?, ?, 'user_prompt', 'completed', 'openai', 'gpt-5.4', 'openai-runtime', 'expiry-fixture', ?, ?, ?)",
          )
          .bind(IDS.run, id, IDS.agent, IDS.ownerAccount, completedAt, completedAt, completedAt)
          .run();
        await database
          .prepare("UPDATE session SET last_run_id = ? WHERE id = ?")
          .bind(IDS.run, id)
          .run();
        await insertRuntimeEvent(database, {
          kind: "run.completed",
          occurredAt: completedAt,
          payload: { stopReason: "end_turn" },
          runId: IDS.run,
          seq: 2,
          sessionId: id,
        });
        if (reason === "reviewed read-only cutover") {
          await database
            .prepare("UPDATE session SET status = 'TERMINATED' WHERE id = ?")
            .bind(id)
            .run();
        }
        const history = await readJson(await request(`v2/threads/${id}`));
        expect(history["run"]).toMatchObject({ id: IDS.run, status: "completed" });
        const savedEvents = await readJson(await request(`v2/threads/${id}/events`));
        const savedFiles = await readJson(await request(`v2/threads/${id}/files`));
        const upload = new FormData();
        upload.set("file", new File(["new work"], "next.txt"));
        const uploaded = await readJson(
          await request(`v2/agents/${IDS.agent}/files`, { method: "POST", body: upload }),
        );
        const fileId = expectString(expectRecord(uploaded["file"])["id"]);
        const continuation = await request(`v2/threads/${id}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: [
              {
                type: "user_message",
                text: "Continue after expiry.",
                resources: [{ type: "file", file_id: fileId }],
              },
            ],
          }),
        });
        expect(await readJson(await request(`v2/threads/${id}/files`))).toEqual(savedFiles);
        if (reason === "recovery expiry") {
          expect(continuation.status).toBe(409);
          expect(await continuation.text()).toContain("recovery expired");
        } else {
          expect(continuation.status).toBe(400);
          const textOnly = await request(`v2/threads/${id}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: [{ type: "user_message", text: "Continue." }] }),
          });
          expect(textOnly.status).toBe(403);
          expect((await readJson(textOnly))["error"]).toMatchObject({ code: "forbidden" });
          expect((await request(`v2/threads/${id}/unarchive`, { method: "POST" })).status).toBe(
            403,
          );
          expect((await request(`v2/files/${savedId}`, { method: "DELETE" })).status).toBe(400);
        }
        expect(await readJson(await request(`v2/threads/${id}`))).toEqual(history);
        for (const suffix of ["events", "files", "usage"])
          expect((await request(`v2/threads/${id}/${suffix}`)).status).toBe(200);
        expect(await readJson(await request(`v2/threads/${id}/events`))).toEqual(savedEvents);
        expect(await readJson(await request(`v2/threads/${id}/files`))).toEqual(savedFiles);
        expect(await (await request(`v2/files/${savedId}/content`)).text()).toBe("saved result");
        const fresh = await create("v2", { resources: [{ type: "file", file_id: fileId }] });
        expect(fresh.status).toBe(201);
      });
    },
  );

  test("does not mistake a later message for the interrupted creation input", async () => {
    const { create, database, request } = await setup({
      requestDatabase: (db) =>
        loseCommittedBatchResponse(db, 'insert into "session_execution_snapshot"'),
    });
    const input = {
      input: {
        type: "user.message",
        content: [{ type: "text", text: "Original creation input." }],
      },
    };
    await withProviderProbeMock(async () => {
      expect((await create("v2", input, "interleaved-message")).status).toBe(500);
      const list = await readJson(await request(`v2/agents/${IDS.agent}/threads`));
      const id = expectString(expectRecord(expectArray(list["threads"])[0])["id"]);
      const other = await request(`v2/threads/${id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{ type: "user_message", text: "Different later input." }],
        }),
      });
      expect(other.status).toBe(200);
      // This fixture has no Cloudflare runtime. Wait for its explicit failure,
      // leaving room for the original creation turn to be admitted on recovery.
      let otherRun: Record<string, unknown> = {};
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        otherRun = expectRecord((await readJson(await request(`v2/threads/${id}`)))["run"]);
        if (otherRun["status"] === "failed") break;
        await Bun.sleep(5);
      }
      expect(otherRun["status"]).toBe("failed");
      await database
        .prepare("UPDATE public_api_idempotency_key SET updated_at = ? WHERE idempotency_key = ?")
        .bind(Date.now() - 11 * 60 * 1000, "interleaved-message")
        .run();
      const recovered = await create("v2", input, "interleaved-message");
      expect(recovered.status).toBe(201);
      const body = await readJson(recovered);
      expect(expectRecord(body["thread"])["id"]).toBe(id);
      expect(expectRecord(body["run"])["id"]).not.toBe(otherRun["id"]);
      const events = await readJson(await request(`v2/threads/${id}/events`));
      expect(expectArray(events["events"])).toContainEqual(
        expect.objectContaining({
          type: "user.message",
          content: "Original creation input.",
        }),
      );
    });
  });

  test("does not recover an older Session when a retained key expires and is reused", async () => {
    let interrupt = false;
    const { create, database } = await setup({
      requestDatabase: (db) =>
        loseCommittedBatchResponse(db, 'insert into "session_execution_snapshot"', () => interrupt),
    });
    await withProviderProbeMock(async () => {
      const old = await readJson(await create("v2", {}, "reused-key"));
      const oldId = expectString(expectRecord(old["thread"])["id"]);
      const priorDay = Date.now() - 25 * 60 * 60 * 1000;
      await database
        .prepare("UPDATE session SET created_at = ? WHERE id = ?")
        .bind(priorDay, oldId)
        .run();
      await database
        .prepare(
          "UPDATE public_api_idempotency_key SET created_at = ?, updated_at = ? WHERE idempotency_key = ?",
        )
        .bind(priorDay, priorDay, "reused-key")
        .run();
      interrupt = true;
      expect((await create("v2", {}, "reused-key")).status).toBe(500);
      await database
        .prepare("UPDATE public_api_idempotency_key SET updated_at = ? WHERE idempotency_key = ?")
        .bind(Date.now() - 11 * 60 * 1000, "reused-key")
        .run();
      const recovered = await create("v2", {}, "reused-key");
      expect(recovered.status).toBe(201);
      expect(expectRecord((await readJson(recovered))["thread"])["id"]).not.toBe(oldId);
    });
  });

  test("retains uploaded material when its claim commits but the response is lost", async () => {
    const { create, database, request } = await setup({
      requestDatabase: (db) => loseCommittedBatchResponse(db, '"owner_kind" = ?'),
    });
    const material = "region,revenue\nnorth,120\n";
    const form = new FormData();
    form.set("file", new File([material], "input.csv", { type: "text/csv" }));
    const uploaded = await request(`v2/agents/${IDS.agent}/files`, {
      method: "POST",
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const fileId = expectString(expectRecord((await readJson(uploaded))["file"])["id"]);
    const input = {
      resources: [{ type: "file", file_id: fileId }],
      input: { type: "user.message", content: [{ type: "text", text: "Analyze the CSV." }] },
    };
    await withProviderProbeMock(async () => {
      expect((await create("v2", input, "lost-file-claim")).status).toBe(500);
      const list = await readJson(await request(`v2/agents/${IDS.agent}/threads`));
      const threads = expectArray(list["threads"]);
      expect(threads).toHaveLength(1);
      const id = expectString(expectRecord(threads[0])["id"]);
      const content = await request(`v2/files/${fileId}/content`);
      expect(content.status).toBe(200);
      expect(await content.text()).toBe(material);
      await database
        .prepare("UPDATE public_api_idempotency_key SET updated_at = ? WHERE idempotency_key = ?")
        .bind(Date.now() - 11 * 60 * 1000, "lost-file-claim")
        .run();
      const retry = await create("v2", input, "lost-file-claim");
      expect(retry.status).toBe(201);
      const recovered = await readJson(retry);
      expect(expectRecord(recovered["thread"])["id"]).toBe(id);
      expect(recovered["run"]).not.toBeNull();
      const files = await readJson(await request(`v2/threads/${id}/files`));
      expect(expectArray(files["files"])).toHaveLength(1);
      expect(await (await request(`v2/files/${fileId}/content`)).text()).toBe(material);
    });
  });

  test("resumes an interrupted creation using its original Session and saved configuration", async () => {
    const { create, database, request, snapshot } = await setup({
      requestDatabase: (db) =>
        loseCommittedBatchResponse(db, 'insert into "session_execution_snapshot"'),
    });
    const input = {
      input: {
        type: "user.message",
        content: [{ type: "text", text: "Analyze original material." }],
      },
    };
    await withProviderProbeMock(async () => {
      expect((await create("v2", input, "lost-session-commit")).status).toBe(500);
      const list = await readJson(await request(`v2/agents/${IDS.agent}/threads`));
      const threads = expectArray(list["threads"]);
      expect(threads).toHaveLength(1);
      const id = expectString(expectRecord(threads[0])["id"]);
      const originalSnapshot = await snapshot(id);
      await database
        .prepare("UPDATE agent SET prompt = 'Different instructions' WHERE id = ?")
        .bind(IDS.agent)
        .run();
      await database
        .prepare("UPDATE public_api_idempotency_key SET updated_at = ? WHERE idempotency_key = ?")
        .bind(Date.now() - 11 * 60 * 1000, "lost-session-commit")
        .run();
      const [retry, concurrentRetry] = await Promise.all([
        create("v2", input, "lost-session-commit"),
        create("v2", input, "lost-session-commit"),
      ]);
      expect(retry.status).toBe(201);
      expect(concurrentRetry.status).toBe(201);
      const recovered = await readJson(retry);
      expect(expectRecord((await readJson(concurrentRetry))["run"])["id"]).toBe(
        expectRecord(recovered["run"])["id"],
      );
      expect(expectRecord(recovered["thread"])["id"]).toBe(id);
      expect(recovered["run"]).not.toBeNull();
      expect(await snapshot(id)).toEqual(originalSnapshot);
      const events = await readJson(await request(`v2/threads/${id}/events`));
      expect(expectArray(events["events"])).toContainEqual(
        expect.objectContaining({ type: "user.message", content: "Analyze original material." }),
      );
    });
  });

  test("recovers one admitted initial turn when D1 loses the commit response", async () => {
    const { create, database, request } = await setup({
      requestDatabase: (db) => loseCommittedBatchResponse(db, 'insert into "session_run"'),
    });
    const input = {
      input: { type: "user.message", content: [{ type: "text", text: "Analyze fixed material." }] },
    };
    await withProviderProbeMock(async () => {
      expect((await create("v2", input, "lost-run-commit")).status).toBe(500);
      const list = await readJson(await request(`v2/agents/${IDS.agent}/threads`));
      const threads = expectArray(list["threads"]);
      expect(threads).toHaveLength(1);
      const thread = expectRecord(threads[0]);
      const id = expectString(thread["id"]);
      const before = await readJson(await request(`v2/threads/${id}`));
      const runId = expectString(expectRecord(before["run"])["id"]);
      await database
        .prepare("UPDATE public_api_idempotency_key SET updated_at = ? WHERE idempotency_key = ?")
        .bind(Date.now() - 11 * 60 * 1000, "lost-run-commit")
        .run();
      const retry = await create("v2", input, "lost-run-commit");
      expect(retry.status).toBe(201);
      const recovered = await readJson(retry);
      expect(expectRecord(recovered["thread"])["id"]).toBe(id);
      expect(expectRecord(recovered["run"])["id"]).toBe(runId);
      const events = await readJson(await request(`v2/threads/${id}/events`));
      expect(
        expectArray(events["events"]).filter(
          (event) => expectRecord(event)["type"] === "user.message",
        ),
      ).toHaveLength(1);
    });
  });

  test("replays persisted events over v2 SSE for an owner-created Session", async () => {
    const live = createPublicEventSessionNamespace();
    const { database, request } = await setup({ sessionNamespace: live.binding });
    await insertOwnerSession(database);
    await insertRuntimeEvent(database, {
      kind: "message.added",
      occurredAt: 1000,
      seq: 1,
      sessionId: IDS.ownerSession,
      payload: { content: "Saved conversation event", messageId: "message-1", role: "agent" },
    });
    const stream = await request(`v2/threads/${IDS.ownerSession}/events/stream`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("Expected SSE body.");
    let text = "";
    try {
      while (!text.includes("Saved conversation event")) {
        const next = await reader.read();
        if (next.done) throw new Error("SSE ended before the persisted event.");
        text += new TextDecoder().decode(next.value);
      }
      expect(text).toContain("data:");
    } finally {
      await reader.cancel();
      live.close();
    }
  });

  test("serves distinct v1 and v2 OpenAPI contracts", async () => {
    const { request } = await setup();
    const oldDocument = await readJson(await request("v1/openapi.json"));
    const newDocument = await readJson(await request("v2/openapi.json"));
    const oldSchemas = expectRecord(expectRecord(oldDocument["components"])["schemas"]);
    const newSchemas = expectRecord(expectRecord(newDocument["components"])["schemas"]);
    expect(expectRecord(oldSchemas["CreateThreadRequest"])["required"]).toEqual(["userId"]);
    expect(expectRecord(newSchemas["CreateThreadRequest"])["required"]).toEqual([]);
    const oldCreate = expectRecord(
      expectRecord(expectRecord(oldDocument["paths"])["/agents/{agentId}/threads"])["post"],
    );
    const newCreate = expectRecord(
      expectRecord(expectRecord(newDocument["paths"])["/agents/{agentId}/threads"])["post"],
    );
    expect(expectRecord(oldCreate["requestBody"])["required"]).toBeTrue();
    expect(expectRecord(newCreate["requestBody"])["required"]).toBeFalse();
    expect(expectRecord(oldDocument["paths"])["/threads/{threadId}/usage"]).toBeUndefined();
    expect(expectRecord(newDocument["paths"])["/threads/{threadId}/usage"]).toBeObject();
    expect(newDocument["servers"]).toEqual([{ url: "https://api.example.com/api/v2" }]);
  });

  test("reads nullable runtime usage with pagination and Project isolation", async () => {
    const { database, request } = await setup();
    await insertOwnerSession(database);
    await database
      .prepare(
        "INSERT INTO session_model_call (id, session_id, session_run_id, provider, model, status, input_tokens, output_tokens, cost_currency, total_cost_usd_micros, metadata_json) VALUES (?, ?, ?, 'openai', 'gpt-5.4', 'completed', 100, 20, 'USD', 250000, ?)",
      )
      .bind(
        "01J0000000000000000000008A",
        IDS.ownerSession,
        IDS.run,
        '{"usageContract":"openai_total_with_cached_breakdown","private":"must not leak"}',
      )
      .run();
    await database
      .prepare(
        "INSERT INTO session_model_call (id, session_id, session_run_id, provider, model, status) VALUES (?, ?, ?, 'openai', 'gpt-5.4', 'started')",
      )
      .bind("01J0000000000000000000008B", IDS.ownerSession, IDS.run)
      .run();
    const first = await readJson(await request(`v2/threads/${IDS.ownerSession}/usage?limit=1`));
    expect(first["nextCursor"]).toBe("01J0000000000000000000008A");
    expect(first["usage"]).toEqual([
      {
        id: "01J0000000000000000000008A",
        runId: IDS.run,
        provider: "openai",
        model: "gpt-5.4",
        status: "completed",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        reportedCostUsd: 0.25,
        usageContract: "openai_total_with_cached_breakdown",
      },
    ]);
    const second = await readJson(
      await request(
        `v2/threads/${IDS.ownerSession}/usage?after=${expectString(first["nextCursor"])}`,
      ),
    );
    expect(second["nextCursor"]).toBeNull();
    expect(expectArray(second["usage"])[0]).toMatchObject({
      inputTokens: null,
      reportedCostUsd: null,
    });
    expect((await request(`v2/threads/${IDS.ownerSession}/usage?limit=0`)).status).toBe(400);
    expect((await request(`v2/threads/${IDS.ownerSession}/usage?after=bad`)).status).toBe(400);
    await database
      .prepare("UPDATE session SET project_id = ? WHERE id = ?")
      .bind("01J0000000000000000000007A", IDS.ownerSession)
      .run();
    expect((await request(`v2/threads/${IDS.ownerSession}/usage`)).status).toBe(404);
  });

  test("rejects busy input and cancels by Thread ID before admitting a follow-up", async () => {
    const { database, request } = await setup();
    await insertOwnerSession(database);
    const now = Date.now();
    await database
      .prepare(
        "INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, trigger, status, provider, model, runtime_id, trace_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'user_prompt', 'queued', 'openai', 'gpt-5.4', 'openai-runtime', 'test-trace', ?, ?)",
      )
      .bind(IDS.run, IDS.ownerSession, IDS.agent, IDS.ownerAccount, now, now)
      .run();
    await database
      .prepare("UPDATE session SET status = 'RUNNING', last_run_id = ? WHERE id = ?")
      .bind(IDS.run, IDS.ownerSession)
      .run();
    const send = (event: unknown) =>
      request(`v2/threads/${IDS.ownerSession}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [event] }),
      });
    expect(
      (await send({ type: "user_message", text: "A second turn must not queue." })).status,
    ).toBe(409);
    const cancelled = await send({ type: "user_interrupt" });
    expect(cancelled.status).toBe(200);
    const history = await readJson(await request(`v2/threads/${IDS.ownerSession}`));
    expect(history["run"]).toMatchObject({ id: IDS.run, status: "cancelled" });
    const next = await send({ type: "user_message", text: "Continue in this Session." });
    expect(next.status).toBe(200);
    expect((await readJson(next))["thread"]).toMatchObject({ id: IDS.ownerSession });
  });

  test("creates a private saved Agent without userId and freezes that configuration", async () => {
    const fixture = await setup();
    await fixture.database
      .prepare(
        "UPDATE agent SET status = 'draft', live_deployment_version_id = NULL, prompt = ? WHERE id = ?",
      )
      .bind("Saved instructions A", IDS.agent)
      .run();
    await withProviderProbeMock(async () => {
      const response = await fixture.create("v2", {}, "private-create");
      expect(response.status).toBe(201);
      const body = await readJson(response);
      const thread = expectRecord(body["thread"]);
      const id = expectString(thread["id"]);
      expect(thread).toMatchObject({ agent_id: IDS.agent, userId: null });
      expect(body["links"]).toEqual({ thread: `/api/v2/threads/${id}` });
      expect(body["run"]).toBeNull();
      const admitted = await fixture.snapshot(id);
      expect(admitted["binding"]).toMatchObject({
        prompt: "Saved instructions A",
        deploymentVersionId: null,
      });
      expect(admitted["configJson"]).toBeString();

      await fixture.database
        .prepare("UPDATE agent SET prompt = ? WHERE id = ?")
        .bind("Saved instructions B", IDS.agent)
        .run();
      expect(await fixture.snapshot(id)).toEqual(admitted);
      const next = await readJson(await fixture.create("v2", {}));
      expect(
        (await fixture.snapshot(expectString(expectRecord(next["thread"])["id"])))["binding"],
      ).toMatchObject({ prompt: "Saved instructions B" });
      const replay = await readJson(await fixture.create("v2", {}, "private-create"));
      expect(replay).toEqual(body);
      expect((await fixture.create("v2", { userId: "different" }, "private-create")).status).toBe(
        409,
      );

      for (const suffix of ["", "/events", "/files"]) {
        expect((await fixture.request(`v2/threads/${id}${suffix}`)).status).toBe(200);
        expect((await fixture.request(`v1/threads/${id}${suffix}`)).status).toBe(404);
      }
      const listed = await readJson(await fixture.request(`v2/agents/${IDS.agent}/threads`));
      expect(expectArray(listed["threads"])).toHaveLength(2);
      const legacy = await fixture.create("v1", { userId: "customer" });
      expect(legacy.status).toBe(409);
      expect(expectRecord((await readJson(legacy))["error"])["code"]).toBe("agent_not_published");
    });
  });

  test("keeps v1 live selection, required identity, links, and listing separate", async () => {
    const fixture = await setup();
    await fixture.database
      .prepare("UPDATE agent SET prompt = ? WHERE id = ?")
      .bind("Unpublished edit", IDS.agent)
      .run();
    await withProviderProbeMock(async () => {
      expect((await fixture.create("v1", {})).status).toBe(400);
      const legacy = await readJson(
        await fixture.create("v1", { userId: "customer" }, "shared-key"),
      );
      expect((await fixture.create("v2", { userId: "customer" }, "shared-key")).status).toBe(409);
      const savedResponse = await fixture.create("v2", { userId: "customer" }, "v2-create");
      expect(savedResponse.status).toBe(201);
      const saved = await readJson(savedResponse);
      const legacyId = expectString(expectRecord(legacy["thread"])["id"]);
      const savedId = expectString(expectRecord(saved["thread"])["id"]);
      expect(savedId).not.toBe(legacyId);
      expect(legacy["links"]).toEqual({ thread: `/api/v1/threads/${legacyId}` });
      expect((await fixture.snapshot(legacyId))["binding"]).toMatchObject({
        prompt: "Help.",
        deploymentVersionId: IDS.deployment,
      });
      expect((await fixture.snapshot(savedId))["binding"]).toMatchObject({
        prompt: "Unpublished edit",
        deploymentVersionId: null,
      });
      const list = await readJson(await fixture.request(`v1/agents/${IDS.agent}/threads`));
      expect(expectArray(list["threads"]).map((thread) => expectRecord(thread)["id"])).toEqual([
        legacyId,
      ]);
      const read = await readJson(await fixture.request(`v2/threads/${legacyId}`));
      expect(read["thread"]).toMatchObject({ id: legacyId, userId: "customer" });
    });
  });

  test("admits owner Sessions from the console and retains history when publication changes", async () => {
    const fixture = await setup();
    await insertOwnerSession(fixture.database);
    await fixture.database
      .prepare("UPDATE agent SET status = 'draft', live_deployment_version_id = NULL WHERE id = ?")
      .bind(IDS.agent)
      .run();
    const response = await fixture.request(`v2/threads/${IDS.ownerSession}`);
    expect(response.status).toBe(200);
    expect((await readJson(response))["thread"]).toMatchObject({
      id: IDS.ownerSession,
      userId: null,
    });
    expect((await fixture.request(`v1/threads/${IDS.ownerSession}`)).status).toBe(404);
    for (const suffix of ["events", "files"]) {
      expect((await fixture.request(`v2/threads/${IDS.ownerSession}/${suffix}`)).status).toBe(200);
    }
    expect(
      (await fixture.request(`v2/threads/${IDS.ownerSession}/archive`, { method: "POST" })).status,
    ).toBe(200);
    expect(
      (await fixture.request(`v2/threads/${IDS.ownerSession}/unarchive`, { method: "POST" }))
        .status,
    ).toBe(200);
  });

  test("uploads and claims files for an unpublished Agent and denies another Project key", async () => {
    const fixture = await setup();
    await fixture.database
      .prepare("UPDATE agent SET status = 'draft', live_deployment_version_id = NULL WHERE id = ?")
      .bind(IDS.agent)
      .run();
    const form = new FormData();
    form.set("file", new File(["region,revenue\nnorth,120\n"], "input.csv", { type: "text/csv" }));
    const uploaded = await fixture.request(`v2/agents/${IDS.agent}/files`, {
      method: "POST",
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const fileId = expectString(expectRecord((await readJson(uploaded))["file"])["id"]);
    await withProviderProbeMock(async () => {
      const created = await fixture.create("v2", {
        resources: [{ type: "file", file_id: fileId }],
      });
      expect(created.status).toBe(201);
      const id = expectString(expectRecord((await readJson(created))["thread"])["id"]);
      const files = await readJson(await fixture.request(`v2/threads/${id}/files`));
      expect(expectArray(files["files"])).toHaveLength(1);
      expect(await (await fixture.request(`v2/files/${fileId}/content`)).text()).toBe(
        "region,revenue\nnorth,120\n",
      );
      expect((await fixture.request(`v1/files/${fileId}/content`)).status).toBe(404);

      const otherProject = "01J0000000000000000000007A";
      await fixture.database
        .prepare(
          "INSERT INTO project (id, organization_id, owner_account_id, name, created_at, updated_at) VALUES (?, ?, ?, 'Other Project', 1, 1)",
        )
        .bind(otherProject, IDS.organization, IDS.ownerAccount)
        .run();
      const otherKey = await createProjectApiKey(fixture.database, OWNER_VIEWER, {
        projectId: otherProject,
        label: "Other Project",
      });
      for (const path of [
        `threads/${id}`,
        `threads/${id}/events`,
        `threads/${id}/files`,
        `files/${fileId}`,
        `files/${fileId}/content`,
        `agents/${IDS.agent}/threads`,
      ]) {
        const denied = await fixture.request(`v2/${path}`, {}, otherKey.value);
        expect([403, 404]).toContain(denied.status);
      }
    });
  });
});
