import { describe, expect, test } from "bun:test";

import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import { createHttpApp } from "../src/adapters/http/create-http-app";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createWorkspaceApiKey } from "../src/modules/auth/application/workspace-api-key.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const OWNER: AuthenticatedViewer = {
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
      data: [{ id: "gpt-5.4" }, { id: "gpt-5.5" }],
    });

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function runRequest(
  apiKey: string,
  body: Record<string, unknown>,
  bindings: ApiBindings,
): Promise<Response> {
  return createHttpApp().request(
    `${PUBLIC_API_PREFIX}/v1/runs`,
    {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
    bindings,
    createTestExecutionContext(),
  );
}

describe("Workspace Run API", () => {
  test("lists the curated Harness marketplace", async () => {
    const database = await createPublicHttpContractDatabase();
    const response = await createHttpApp().request(
      `${PUBLIC_API_PREFIX}/v1/harnesses`,
      undefined,
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    expect(response.status).toBe(200);
    const body = await response.json<{ harnesses: { slug: string }[] }>();
    expect(body.harnesses.map((harness) => harness.slug)).toEqual([
      "claude-code",
      "openai-codex",
      "opencode",
      "deepseek-harness",
    ]);
    expect(body.harnesses.at(-1)).toMatchObject({
      profiles: [
        {
          id: "deepseek-harness/headless",
          provenance: { revision: "141eb6fef83422698aef7a981029e843e8161534" },
        },
      ],
      status: "unavailable",
    });
  });

  test("launches two Harnesses with one Workspace key and creates no Agent rows", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const key = await createWorkspaceApiKey(database, OWNER, {
      label: "Harness experiment",
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });

    const [codexResponse, openCodeResponse] = await withProviderProbeMock(async () => [
      await runRequest(
        key.value,
        {
          harness: "openai-codex",
          input: "Review this repository",
          profile: "openai-codex/mosoo-baseline@2026.08-experiment.2",
        },
        bindings,
      ),
      await runRequest(
        key.value,
        { harness: "opencode", input: { task: "Review this repository" } },
        bindings,
      ),
    ]);

    expect(codexResponse.status).toBe(201);
    expect(openCodeResponse.status).toBe(201);
    const codexRun = await codexResponse.json<{
      id: string;
      source: {
        harness: string;
        kind: string;
        profile: { id: string; revision: string; version: string };
        version: string;
      };
      threadId: string;
      workspaceId: string;
    }>();
    const openCodeRun = await openCodeResponse.json<{
      id: string;
      source: {
        harness: string;
        kind: string;
        profile: { id: string; revision: string; version: string };
        version: string;
      };
      threadId: string;
      workspaceId: string;
    }>();

    expect(codexRun).toMatchObject({
      source: {
        harness: "openai-codex",
        kind: "harness",
        profile: {
          id: "openai-codex/mosoo-baseline",
          version: "2026.08-experiment.2",
        },
      },
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });
    expect(openCodeRun).toMatchObject({
      source: {
        harness: "opencode",
        kind: "harness",
        profile: {
          id: "opencode/mosoo-baseline",
          version: "2026.08-experiment.2",
        },
      },
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });
    expect(codexRun.source.version).toBe(openCodeRun.source.version);
    expect(codexRun.id).not.toBe(openCodeRun.id);

    const counts = await database
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM agent) AS agent_count,
            (SELECT COUNT(*) FROM session) AS session_count,
            (SELECT COUNT(*) FROM session_run) AS run_count
        `,
      )
      .first<{ agent_count: number; run_count: number; session_count: number }>();
    expect(counts).toEqual({ agent_count: 1, run_count: 2, session_count: 2 });

    const compatibilityRows = await database
      .prepare("SELECT agent_id, id FROM session ORDER BY created_at, id")
      .all<{ agent_id: string; id: string }>();
    expect(compatibilityRows.results).toEqual([
      { agent_id: codexRun.threadId, id: codexRun.threadId },
      { agent_id: openCodeRun.threadId, id: openCodeRun.threadId },
    ]);

    const retrieveResponse = await createHttpApp().request(
      `${PUBLIC_API_PREFIX}/v1/runs/${codexRun.id}`,
      { headers: { authorization: `Bearer ${key.value}` } },
      bindings,
      createTestExecutionContext(),
    );
    expect(retrieveResponse.status).toBe(200);
    expect(await retrieveResponse.json()).toMatchObject({
      id: codexRun.id,
      source: { harness: "openai-codex", kind: "harness" },
    });
  });

  test("rejects mixed source selectors before allocating a Session", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const key = await createWorkspaceApiKey(database, OWNER, {
      label: "Contract test",
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });
    const response = await runRequest(
      key.value,
      {
        agent: PUBLIC_API_TEST_IDS.agent,
        harness: "openai-codex",
        input: "This must be rejected",
      },
      bindings,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Exactly one of agent or harness is required.",
      },
    });
    const sessions = await database
      .prepare("SELECT COUNT(*) AS count FROM session")
      .first<{ count: number }>();
    expect(sessions?.count).toBe(0);
  });

  test("rejects unknown Profile Versions and unavailable Harness distributions", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const key = await createWorkspaceApiKey(database, OWNER, {
      label: "Locked profile contract",
      workspaceId: PUBLIC_API_TEST_IDS.app,
    });

    const unknownProfile = await runRequest(
      key.value,
      {
        harness: "openai-codex",
        input: "This must be rejected",
        profile: "openai-codex/unlocked-local-plugins@latest",
      },
      bindings,
    );
    const deepSeekWithoutAdapter = await runRequest(
      key.value,
      { harness: "deepseek-harness", input: "This must also be rejected" },
      bindings,
    );

    expect(unknownProfile.status).toBe(400);
    expect(await unknownProfile.json()).toMatchObject({
      error: { message: expect.stringContaining("Harness profile") },
    });
    expect(deepSeekWithoutAdapter.status).toBe(400);
    expect(await deepSeekWithoutAdapter.json()).toMatchObject({
      error: { message: "Harness deepseek-harness is unavailable." },
    });
    const sessions = await database
      .prepare("SELECT COUNT(*) AS count FROM session")
      .first<{ count: number }>();
    expect(sessions?.count).toBe(0);
  });
});
