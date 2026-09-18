import { describe, expect, test } from "bun:test";

import { createProjectApiKey } from "../src/modules/auth/application/personal-access-token.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS as IDS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
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
  requestPublicApi,
  insertRuntimeEvent,
  withProviderProbeMock,
} from "./public-thread-api-fixtures";

async function setup(options: { sessionNamespace?: ApiBindings["Session"] } = {}) {
  const database = await createPublicHttpContractDatabase();
  const key = await createProjectApiKey(database, OWNER_VIEWER, {
    label: "Session HTTP test",
    projectId: IDS.project,
  });
  const app = createPublicThreadApiTestApp();
  const bucket = new PublicApiMemoryFileBucket();
  const request = (path: string, init: RequestInit = {}, token = key.value) =>
    requestPublicApi(
      app,
      database,
      new Request(`https://api.example.com/api/${path}`, {
        ...init,
        headers: { Authorization: bearer(token), ...init.headers },
      }),
      { fileBucket: bucket as unknown as R2Bucket, ...options },
    );
  const create = (version: "v1" | "v2", body: unknown, idempotencyKey?: string) =>
    request(`${version}/agents/${IDS.agent}/threads`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      method: "POST",
    });
  const snapshot = async (id: string) => {
    const row = await database
      .prepare("SELECT plan_json FROM session_execution_snapshot WHERE session_id = ?")
      .bind(id)
      .first<{ plan_json: string }>();
    return expectRecord(JSON.parse(expectString(row?.plan_json)));
  };
  return { create, database, request, snapshot };
}

// These tests exercise HTTP authentication/admission and the real Session store.
// Runtime provisioning is intentionally absent; live tool/restore evidence is separate.
describe("saved-Agent Thread API v2", () => {
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
