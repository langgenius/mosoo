import { describe, expect, test } from "bun:test";

import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import { parsePlatformId } from "@mosoo/id";
import type { PublicThreadId } from "@mosoo/id";

import { createHttpApp } from "../src/adapters/http/create-http-app";
import {
  authenticatePersonalAccessToken,
  createPersonalAccessToken,
  createProjectApiKey,
  hashTokenValue,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "../src/modules/auth/application/personal-access-token.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { fileStore } from "../src/modules/files/application/file-store";
import { sendPublicThreadSessionEvents } from "../src/modules/public-api/public-thread-api-command.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
  TOKENS,
} from "./helpers/public-api-http-test-fixture";
import {
  expectRecord,
  expectString,
  readJson,
  withProviderProbeMock,
  requestPublicApiWithBindings,
} from "./public-thread-api-fixtures";

const SECOND_PROJECT = "01J000000000000000000000Z1";
const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

async function fixture() {
  const database = await createPublicHttpContractDatabase();
  database.execute(`INSERT INTO project (id, organization_id, owner_account_id, name, created_at, updated_at)
    SELECT '${SECOND_PROJECT}', organization_id, owner_account_id, 'Second', created_at, updated_at FROM project WHERE id = '${PUBLIC_API_TEST_IDS.project}';`);
  const key = await createProjectApiKey(database, VIEWER, {
    label: "Backend",
    projectId: PUBLIC_API_TEST_IDS.project,
  });
  const secondKey = await createProjectApiKey(database, VIEWER, {
    label: "Other project",
    projectId: SECOND_PROJECT,
  });
  const replacement = await createProjectApiKey(database, VIEWER, {
    label: "Replacement",
    projectId: PUBLIC_API_TEST_IDS.project,
  });
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const app = createHttpApp();
  async function request(path: string, token = key.value, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    return withProviderProbeMock(() =>
      requestPublicApiWithBindings(
        app,
        new Request(`https://api.example.com${PUBLIC_API_PREFIX}${path}`, { ...init, headers }),
        bindings,
      ),
    );
  }
  return { database, bindings, key, secondKey, replacement, request };
}

describe("Project API keys and CLI account credentials", () => {
  test("owner creates Project keys over HTTP; secrets are hashed and lists are Project-scoped", async () => {
    const { database, request, key } = await fixture();
    const response = await request("/access-tokens", TOKENS.owner, {
      method: "POST",
      body: JSON.stringify({ label: "Application", projectId: PUBLIC_API_TEST_IDS.project }),
    });
    expect(response.status).toBe(201);
    const created = await readJson(response);
    expect(created.value).toStartWith("msp_");
    expect(expectRecord(created.token).projectId).toBe(PUBLIC_API_TEST_IDS.project);
    const listed = await listPersonalAccessTokens(database, VIEWER, PUBLIC_API_TEST_IDS.project);
    expect(listed.tokens).toHaveLength(3);
    expect(listed.tokens.every((token) => token.projectId === PUBLIC_API_TEST_IDS.project)).toBe(
      true,
    );
    expect(JSON.stringify(listed)).not.toContain(key.value);
    const stored = await database
      .prepare("SELECT token_hash, project_id FROM personal_access_token WHERE id = ?")
      .bind(key.token.id)
      .first();
    expect(stored).toEqual({
      token_hash: await hashTokenValue(key.value),
      project_id: PUBLIC_API_TEST_IDS.project,
    });
    expect(await authenticatePersonalAccessToken(database, key.value)).toMatchObject({
      viewer: { id: VIEWER.id, projectId: PUBLIC_API_TEST_IDS.project },
    });
  });

  test("rejects legacy manual and CLI tokens even when their hashes exist", async () => {
    const { database, request, key } = await fixture();
    for (const old of ["mst_old_manual", "mst_old_cli", "grt_pat_old"]) {
      await database
        .prepare("UPDATE personal_access_token SET token_hash = ? WHERE id = ?")
        .bind(await hashTokenValue(old), key.token.id)
        .run();
      expect(await authenticatePersonalAccessToken(database, old)).toBeNull();
      expect((await request(`/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`, old)).status).toBe(
        401,
      );
    }
    const cli = await createPersonalAccessToken(database, VIEWER, { label: "CLI login" });
    expect(cli.value).toStartWith("mcli_");
    expect((await request("/auth/cli/session", cli.value)).status).toBe(200);
    expect((await request("/auth/cli/session", key.value)).status).toBe(401);
    expect(
      (await authenticatePersonalAccessToken(database, cli.value))?.viewer.projectId,
    ).toBeUndefined();
    expect((await request(`/access-tokens?projectId=${SECOND_PROJECT}`, cli.value)).status).toBe(
      200,
    );
  });

  test("requires a valid owned Project and account authentication for all key management", async () => {
    const { request, key } = await fixture();
    for (const init of [
      { method: "GET" },
      {
        method: "POST",
        body: JSON.stringify({ label: "Escalation", projectId: PUBLIC_API_TEST_IDS.project }),
      },
      { method: "DELETE" },
    ]) {
      const path =
        init.method === "DELETE"
          ? `/access-tokens/${key.token.id}`
          : `/access-tokens?projectId=${PUBLIC_API_TEST_IDS.project}`;
      expect((await request(path, key.value, init)).status).toBe(401);
    }
    expect(
      (
        await request("/access-tokens", TOKENS.owner, {
          method: "POST",
          body: JSON.stringify({ label: "Missing project" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(`/access-tokens?projectId=${PUBLIC_API_TEST_IDS.project}`, TOKENS.outsider))
        .status,
    ).toBe(403);
  });

  test("GraphQL permits Agent configuration in the key's Project and denies account operations and cross-Project aliases", async () => {
    const { request, key, secondKey } = await fixture();
    const query = `query { mine: accessibleAgentList(projectId: "${PUBLIC_API_TEST_IDS.project}") { id } }`;
    expect(
      (await request("/graphql", key.value, { method: "POST", body: JSON.stringify({ query }) }))
        .status,
    ).toBe(200);
    expect(
      (
        await request("/graphql", secondKey.value, {
          method: "POST",
          body: JSON.stringify({ query }),
        })
      ).status,
    ).toBe(403);
    const createAgent = `mutation { createAgent(input: { projectId: "${PUBLIC_API_TEST_IDS.project}", name: "Configured by key", kind: cattle, runtimeId: "openai-runtime", provider: "openai", model: "gpt-5.4", prompt: "Produce a report", skillIds: [] }) { id } }`;
    const ownConfig = await request("/graphql", key.value, {
      method: "POST",
      body: JSON.stringify({ query: createAgent }),
    });
    expect(await readJson(ownConfig)).toMatchObject({
      data: { createAgent: { id: expect.any(String) } },
    });
    const crossConfig = await request("/graphql", secondKey.value, {
      method: "POST",
      body: JSON.stringify({ query: createAgent }),
    });
    expect(crossConfig.status).toBe(403);
    const viewerQuery = "query { viewer { __typename } }";
    expect(
      await readJson(
        await request("/graphql", key.value, {
          method: "POST",
          body: JSON.stringify({ query: viewerQuery }),
        }),
      ),
    ).toMatchObject({ errors: [{ extensions: { code: "FORBIDDEN" } }] });
    expect(
      (
        await request("/graphql", TOKENS.owner, {
          method: "POST",
          body: JSON.stringify({ query: viewerQuery }),
        })
      ).status,
    ).toBe(200);
  });

  test("Session creation is Project-idempotent; rotation preserves history while other Projects cannot read or mutate it", async () => {
    const { database, bindings, request, key, replacement, secondKey } = await fixture();
    const create = {
      method: "POST",
      body: JSON.stringify({ userId: "customer" }),
      headers: { "Idempotency-Key": "one-session" },
    };
    const path = `/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`;
    const response = await request(path, key.value, create);
    expect(response.status).toBe(201);
    const created = await readJson(response);
    const threadId = expectString(expectRecord(created.thread).id);
    const replay = await request(path, replacement.value, create);
    expect(await readJson(replay)).toEqual(created);
    expect((await request(path, secondKey.value, create)).status).toBe(403);
    await revokePersonalAccessToken(database, VIEWER, key.token.id);
    expect((await request(`/v1/threads/${threadId}`, key.value)).status).toBe(401);
    expect((await request(`/v1/threads/${threadId}`, replacement.value)).status).toBe(200);
    expect((await request(`/v1/threads/${threadId}`, TOKENS.owner)).status).toBe(200);
    for (const [suffix, method, body] of [
      ["", "GET", undefined],
      ["/events", "GET", undefined],
      ["/files", "GET", undefined],
      ["/events", "POST", JSON.stringify({ events: [{ type: "user_message", text: "continue" }] })],
      ["/events", "POST", JSON.stringify({ events: [{ type: "user_interrupt" }] })],
    ] as const) {
      const denied = await request(`/v1/threads/${threadId}${suffix}`, secondKey.value, {
        method,
        ...(body === undefined ? {} : { body }),
      });
      expect([403, 404]).toContain(denied.status);
    }
    expect(
      (await listPersonalAccessTokens(database, VIEWER, PUBLIC_API_TEST_IDS.project)).tokens.map(
        (token) => token.id,
      ),
    ).toEqual([replacement.token.id]);
    const replacementCaller = await authenticatePersonalAccessToken(database, replacement.value);
    if (!replacementCaller) throw new Error("Replacement key must authenticate.");
    await sendPublicThreadSessionEvents({
      bindings,
      caller: replacementCaller.viewer,
      executionContext: null,
      input: { events: [{ type: "user_message", text: "Run with the replacement key" }] },
      requestUrl: "https://api.example.com/api/v1",
      threadId: parsePlatformId<PublicThreadId>(threadId, "Thread ID"),
    });
    const beforeRevoke = await database
      .prepare("SELECT id, status, created_by_key_id FROM session_run WHERE session_id = ?")
      .bind(threadId)
      .first();
    expect(beforeRevoke).toMatchObject({
      status: "queued",
      created_by_key_id: replacement.token.id,
    });
    await revokePersonalAccessToken(database, VIEWER, replacement.token.id);
    const afterRevoke = await database
      .prepare("SELECT id, status, created_by_key_id FROM session_run WHERE session_id = ?")
      .bind(threadId)
      .first();
    expect(afterRevoke).toEqual(beforeRevoke);
    const successor = await createProjectApiKey(database, VIEWER, {
      label: "Successor",
      projectId: PUBLIC_API_TEST_IDS.project,
    });
    const successorCaller = await authenticatePersonalAccessToken(database, successor.value);
    if (!successorCaller) throw new Error("Successor key must authenticate.");
    await sendPublicThreadSessionEvents({
      bindings,
      caller: successorCaller.viewer,
      executionContext: null,
      input: { events: [{ type: "user_interrupt" }] },
      requestUrl: "https://api.example.com/api/v1",
      threadId: parsePlatformId<PublicThreadId>(threadId, "Thread ID"),
    });
    expect(
      await database
        .prepare("SELECT status FROM session_run WHERE session_id = ?")
        .bind(threadId)
        .first(),
    ).toEqual({ status: "cancelled" });

    expect((await request(`/v1/threads/${threadId}`, TOKENS.owner)).status).toBe(200);
  });

  test("file uploads and retrieval cannot cross Projects owned by the same account", async () => {
    const { bindings, request, key, secondKey } = await fixture();
    const upload = await fileStore.createUpload(
      bindings,
      { ...VIEWER, projectId: PUBLIC_API_TEST_IDS.project },
      {
        file: { contentType: "text/plain", name: "input.txt", size: 4 },
        purpose: "app_draft",
        target: { id: PUBLIC_API_TEST_IDS.project, kind: "app_draft", name: "input.txt" },
      },
    );
    const fileId = upload.fileId;
    expect((await request(`/files/${fileId}/upload`, key.value)).status).toBe(200);
    expect((await request(`/files/${fileId}/upload`, secondKey.value)).status).toBe(404);
    expect(
      (await request(`/files?projectId=${PUBLIC_API_TEST_IDS.project}`, secondKey.value)).status,
    ).toBe(403);
    await expect(
      fileStore.createUpload(
        bindings,
        { ...VIEWER, projectId: SECOND_PROJECT },
        {
          file: { contentType: "text/plain", name: "blocked.txt", size: 4 },
          purpose: "app_draft",
          target: { id: PUBLIC_API_TEST_IDS.project, kind: "app_draft", name: "blocked.txt" },
        },
      ),
    ).rejects.toThrow("File not found");
  });
});
