/**
 * Name-addressed App API namespace contract (PRD "API Namespace & Access"):
 * /apps/{appSlug}/agents/{agentName}/threads must behave exactly like the
 * ULID /agents/{agentId}/threads surface (same wrappers, admission, rate
 * limiting, idempotency), every resolution miss must render the same
 * anti-enumeration 404, and /apps/{appSlug}/openapi.json must document
 * exactly the exposed+published subset under the namespace server URL.
 */
import { describe, expect, test } from "bun:test";

import { agentsTable } from "@mosoo/db";

import {
  PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE,
  enforcePublicApiRateLimit,
} from "../src/modules/public-api/public-api-rate-limit.service";
import {
  PUBLIC_API_TEST_IDS,
  TOKENS,
  createPublicHttpContractDatabase,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";
import {
  bearer,
  createPublicThreadApiTestApp,
  expectArray,
  expectRecord,
  expectString,
  readJson,
  requestPublicApi,
  withProviderProbeMock,
} from "./public-thread-api-fixtures";

const APP_SLUG = "default-app";
const EXPOSED_AGENT_NAME = "quiz-master";
const NAMESPACE_BASE_URL = `https://api.example.com/api/v1/apps/${APP_SLUG}`;
const NAMESPACE_THREADS_URL = `${NAMESPACE_BASE_URL}/agents/${EXPOSED_AGENT_NAME}/threads`;
const ULID_THREADS_URL = `https://api.example.com/api/v1/agents/${PUBLIC_API_TEST_IDS.agent}/threads`;

const SEEDED_AGENT_IDS = {
  consoleTwin: "01J000000000000000000000G2",
  duplicateA: "01J000000000000000000000G3",
  duplicateB: "01J000000000000000000000G4",
  internal: "01J000000000000000000000G1",
  setupDraft: "01J000000000000000000000G5",
  vetAdvisor: "01J000000000000000000000G6",
} as const;

/**
 * Namespaces the baseline public-API fixture: the App gets its minted slug
 * and the live baseline Agent becomes the exposed repo Agent behind
 * /agents/quiz-master. Seeding happens per test file, not in the shared
 * fixture, so the ~40 other public HTTP suites keep their unexposed shape.
 */
async function createNamespaceDatabase(): Promise<SqliteD1Database> {
  const database = await createPublicHttpContractDatabase();

  await database
    .prepare("UPDATE app SET slug = ? WHERE id = ?")
    .bind(APP_SLUG, PUBLIC_API_TEST_IDS.app)
    .run();
  await database
    .prepare("UPDATE agent SET name = ?, exposed_via_api = 1 WHERE id = ?")
    .bind(EXPOSED_AGENT_NAME, PUBLIC_API_TEST_IDS.agent)
    .run();

  return database;
}

async function seedNamespaceAgent(
  database: SqliteD1Database,
  input: {
    exposedViaApi: number | null;
    id: string;
    liveDeploymentVersionId?: string | null;
    name: string;
    status?: "draft" | "published";
  },
): Promise<void> {
  await database
    .app()
    .insert(agentsTable)
    .values({
      appId: PUBLIC_API_TEST_IDS.app,
      configJson: JSON.stringify({
        packageMcpServers: [],
        packageResolution: null,
        packageSkills: [],
      }),
      createdAt: nowMsForTest(),
      description: null,
      environmentId: PUBLIC_API_TEST_IDS.environment,
      exposedViaApi: input.exposedViaApi,
      id: input.id,
      kind: "pet",
      liveDeploymentVersionId:
        input.liveDeploymentVersionId === undefined
          ? PUBLIC_API_TEST_IDS.deployment
          : input.liveDeploymentVersionId,
      model: "gpt-5.4",
      name: input.name,
      ownerId: PUBLIC_API_TEST_IDS.ownerAccount,
      prompt: "Help.",
      provider: "openai",
      runtimeId: "openai-runtime",
      status: input.status ?? "published",
      updatedAt: nowMsForTest(),
      visibility: "private",
    })
    .run();
}

/** Duplicate + internal + console + draft rows for resolution-miss cases. */
async function seedResolutionMissAgents(database: SqliteD1Database): Promise<void> {
  await seedNamespaceAgent(database, {
    exposedViaApi: 0,
    id: SEEDED_AGENT_IDS.internal,
    name: "triage",
  });
  await seedNamespaceAgent(database, {
    exposedViaApi: null,
    id: SEEDED_AGENT_IDS.consoleTwin,
    name: "concierge",
  });
  await seedNamespaceAgent(database, {
    exposedViaApi: 1,
    id: SEEDED_AGENT_IDS.duplicateA,
    name: "support",
  });
  await seedNamespaceAgent(database, {
    exposedViaApi: 1,
    id: SEEDED_AGENT_IDS.duplicateB,
    name: "support",
  });
  await seedNamespaceAgent(database, {
    exposedViaApi: 1,
    id: SEEDED_AGENT_IDS.setupDraft,
    liveDeploymentVersionId: null,
    name: "setup-pending",
    status: "draft",
  });
}

function createThreadRequest(url: string, options: { idempotencyKey?: string } = {}): Request {
  return new Request(url, {
    body: JSON.stringify({
      client_external_ref: "namespace-parity-1",
      input: {
        content: [{ text: "Say hello from the namespace.", type: "text" }],
        type: "user.message",
      },
    }),
    headers: {
      Authorization: bearer(TOKENS.owner),
      "Content-Type": "application/json",
      ...(options.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": options.idempotencyKey }),
    },
    method: "POST",
  });
}

async function expectPublicApiError(
  response: Response,
  expected: { code: string; message?: string; status: number },
): Promise<void> {
  expect(response.status).toBe(expected.status);
  const error = expectRecord((await readJson(response))["error"]);
  expect(error["code"]).toBe(expected.code);

  if (expected.message !== undefined) {
    expect(error["message"]).toBe(expected.message);
  }
}

describe("App namespace thread routes", () => {
  test("creates Threads through the name route with ULID-route parity and idempotency", async () => {
    const database = await createNamespaceDatabase();
    const app = createPublicThreadApiTestApp();

    await withProviderProbeMock(async () => {
      const nameResponse = await requestPublicApi(
        app,
        database,
        createThreadRequest(NAMESPACE_THREADS_URL, { idempotencyKey: "namespace-create-1" }),
      );
      expect(nameResponse.status).toBe(201);

      const nameBody = await readJson(nameResponse);
      const ulidResponse = await requestPublicApi(
        app,
        database,
        createThreadRequest(ULID_THREADS_URL),
      );
      expect(ulidResponse.status).toBe(201);

      const ulidBody = await readJson(ulidResponse);

      // Same response contract as the ULID route: same shape, same agent
      // attribution, and Thread links stay ULID-addressed (thread-level
      // operations never move into the namespace).
      expect(Object.keys(nameBody).toSorted()).toEqual(Object.keys(ulidBody).toSorted());

      const nameThread = expectRecord(nameBody["thread"]);
      const ulidThread = expectRecord(ulidBody["thread"]);
      expect(Object.keys(nameThread).toSorted()).toEqual(Object.keys(ulidThread).toSorted());
      expect(nameThread["agent_id"]).toBe(PUBLIC_API_TEST_IDS.agent);
      expect(nameThread["agent_id"]).toBe(ulidThread["agent_id"]);
      expect(nameThread["created_by"]).toEqual(ulidThread["created_by"]);
      expect(nameThread["source"]).toBe(ulidThread["source"]);

      const threadId = expectString(nameThread["id"]);
      expect(nameBody["links"]).toEqual({ thread: `/api/v1/threads/${threadId}` });
      expect(expectRecord(nameBody["run"])["trigger"]).toBe(
        expectRecord(ulidBody["run"])["trigger"],
      );

      // The shared idempotency wrapper serves the name route too.
      const replayResponse = await requestPublicApi(
        app,
        database,
        createThreadRequest(NAMESPACE_THREADS_URL, { idempotencyKey: "namespace-create-1" }),
      );
      expect(replayResponse.status).toBe(201);
      expect(replayResponse.headers.get("Idempotency-Replayed")).toBe("true");
      expect(expectRecord((await readJson(replayResponse))["thread"])["id"]).toBe(threadId);
    });
  });

  test("lists Threads through the name route identically to the ULID route", async () => {
    const database = await createNamespaceDatabase();
    const app = createPublicThreadApiTestApp();

    await withProviderProbeMock(async () => {
      const created = await requestPublicApi(
        app,
        database,
        createThreadRequest(NAMESPACE_THREADS_URL),
      );
      expect(created.status).toBe(201);

      const nameList = await requestPublicApi(
        app,
        database,
        new Request(NAMESPACE_THREADS_URL, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      const ulidList = await requestPublicApi(
        app,
        database,
        new Request(ULID_THREADS_URL, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(nameList.status).toBe(200);
      expect(ulidList.status).toBe(200);

      const nameListBody = await readJson(nameList);
      expect(nameListBody).toEqual(await readJson(ulidList));
      expect(expectArray(nameListBody["threads"])).toHaveLength(1);

      // Query passthrough matches the ULID route (archived filtering).
      const archivedList = await requestPublicApi(
        app,
        database,
        new Request(`${NAMESPACE_THREADS_URL}?archived=true`, {
          headers: { Authorization: bearer(TOKENS.owner) },
        }),
      );
      expect(archivedList.status).toBe(200);
      expect(await readJson(archivedList)).toEqual({ threads: [] });
    });
  });

  test("renders the same 404 for every namespace resolution miss", async () => {
    const database = await createNamespaceDatabase();
    await seedResolutionMissAgents(database);
    const app = createPublicThreadApiTestApp();

    const missPaths = [
      // Unknown slug, known agent name.
      `https://api.example.com/api/v1/apps/unknown-app/agents/${EXPOSED_AGENT_NAME}/threads`,
      // Known slug, unknown agent name.
      `${NAMESPACE_BASE_URL}/agents/unknown-agent/threads`,
      // Repo-defined but internal (exposed_via_api = 0).
      `${NAMESPACE_BASE_URL}/agents/triage/threads`,
      // Console-created (exposed_via_api NULL) despite being published.
      `${NAMESPACE_BASE_URL}/agents/concierge/threads`,
      // Duplicate exposed names: the service level refuses to guess.
      `${NAMESPACE_BASE_URL}/agents/support/threads`,
      // Exposed but never published (setup-blocked draft).
      `${NAMESPACE_BASE_URL}/agents/setup-pending/threads`,
    ];

    for (const url of missPaths) {
      const createResponse = await requestPublicApi(app, database, createThreadRequest(url));
      await expectPublicApiError(createResponse, {
        code: "not_found",
        message: "Agent not found.",
        status: 404,
      });
    }

    // The list route resolves through the same helper.
    const listResponse = await requestPublicApi(
      app,
      database,
      new Request(`${NAMESPACE_BASE_URL}/agents/support/threads`, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    await expectPublicApiError(listResponse, {
      code: "not_found",
      message: "Agent not found.",
      status: 404,
    });
  });

  test("rejects namespace segments outside the URL-safe kebab shape", async () => {
    const database = await createNamespaceDatabase();
    const app = createPublicThreadApiTestApp();

    const badSlug = await requestPublicApi(
      app,
      database,
      createThreadRequest(
        `https://api.example.com/api/v1/apps/Bad_Slug/agents/${EXPOSED_AGENT_NAME}/threads`,
      ),
    );
    await expectPublicApiError(badSlug, { code: "invalid_request", status: 400 });

    const badName = await requestPublicApi(
      app,
      database,
      createThreadRequest(`${NAMESPACE_BASE_URL}/agents/Quiz.Master/threads`),
    );
    await expectPublicApiError(badName, { code: "invalid_request", status: 400 });
  });

  test("keeps PAT authentication and rate limiting on the name routes", async () => {
    const database = await createNamespaceDatabase();
    const app = createPublicThreadApiTestApp();

    const unauthenticatedCreate = await requestPublicApi(
      app,
      database,
      new Request(NAMESPACE_THREADS_URL, {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    await expectPublicApiError(unauthenticatedCreate, { code: "unauthenticated", status: 401 });

    const revokedList = await requestPublicApi(
      app,
      database,
      new Request(NAMESPACE_THREADS_URL, {
        headers: { Authorization: bearer(TOKENS.revoked) },
      }),
    );
    await expectPublicApiError(revokedList, { code: "unauthenticated", status: 401 });

    for (let index = 0; index < PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE; index += 1) {
      await enforcePublicApiRateLimit(database, PUBLIC_API_TEST_IDS.patOwner);
    }

    const limitedCreate = await requestPublicApi(
      app,
      database,
      createThreadRequest(NAMESPACE_THREADS_URL),
    );
    await expectPublicApiError(limitedCreate, { code: "rate_limited", status: 429 });

    const retryAfterSeconds = Number(limitedCreate.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfterSeconds)).toBe(true);
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(60);

    const limitedList = await requestPublicApi(
      app,
      database,
      new Request(NAMESPACE_THREADS_URL, {
        headers: { Authorization: bearer(TOKENS.owner) },
      }),
    );
    await expectPublicApiError(limitedList, { code: "rate_limited", status: 429 });
  });
});

describe("App namespace OpenAPI document", () => {
  test("documents exactly the exposed+published subset under the namespace server", async () => {
    const database = await createNamespaceDatabase();
    await seedResolutionMissAgents(database);
    await seedNamespaceAgent(database, {
      exposedViaApi: 1,
      id: SEEDED_AGENT_IDS.vetAdvisor,
      name: "vet-advisor",
    });
    const app = createPublicThreadApiTestApp();

    // Unauthenticated by design; a bogus token is ignored, not rejected.
    const response = await requestPublicApi(
      app,
      database,
      new Request(`${NAMESPACE_BASE_URL}/openapi.json`, {
        headers: { Authorization: bearer(TOKENS.revoked) },
      }),
    );
    expect(response.status).toBe(200);

    const document = await readJson(response);
    expect(document["openapi"]).toBe("3.1.0");
    expect(document["servers"]).toEqual([{ url: NAMESPACE_BASE_URL }]);
    expect(expectRecord(document["info"])["version"]).toBe("v1");

    // Exactly the exposed+published subset: internal (triage), console
    // (concierge), and draft (setup-pending) agents stay out; the duplicate
    // "support" pair collapses to one advertised path.
    const paths = expectRecord(document["paths"]);
    expect(Object.keys(paths).toSorted()).toEqual([
      `/agents/${EXPOSED_AGENT_NAME}/threads`,
      "/agents/support/threads",
      "/agents/vet-advisor/threads",
    ]);

    const quizMasterPath = expectRecord(paths[`/agents/${EXPOSED_AGENT_NAME}/threads`]);
    const createOperation = expectRecord(quizMasterPath["post"]);
    const listOperation = expectRecord(quizMasterPath["get"]);

    // The agentId path parameter is stripped; the shared Idempotency-Key and
    // archived parameters survive from the ULID template.
    expect(
      expectArray(createOperation["parameters"]).map(
        (parameter) => expectRecord(parameter)["name"],
      ),
    ).toEqual(["Idempotency-Key"]);
    expect(
      expectArray(listOperation["parameters"]).map((parameter) => expectRecord(parameter)["name"]),
    ).toEqual(["archived"]);
    expect(expectRecord(createOperation["responses"])["201"]).toBeDefined();

    // Contracts schemas and security schemes ride along unchanged.
    const components = expectRecord(document["components"]);
    expect(expectRecord(components["schemas"])["CreateThreadRequest"]).toBeDefined();
    expect(expectRecord(components["securitySchemes"])["publicApiBearer"]).toBeDefined();
  });

  test("serves an empty namespace document once the slug exists without exposed agents", async () => {
    const database = await createPublicHttpContractDatabase();
    await database
      .prepare("UPDATE app SET slug = ? WHERE id = ?")
      .bind(APP_SLUG, PUBLIC_API_TEST_IDS.app)
      .run();
    const app = createPublicThreadApiTestApp();

    const response = await requestPublicApi(
      app,
      database,
      new Request(`${NAMESPACE_BASE_URL}/openapi.json`),
    );
    expect(response.status).toBe(200);
    expect(expectRecord(await readJson(response))["paths"]).toEqual({});
  });

  test("404s unknown slugs and 400s malformed slugs", async () => {
    const database = await createNamespaceDatabase();
    const app = createPublicThreadApiTestApp();

    const unknown = await requestPublicApi(
      app,
      database,
      new Request("https://api.example.com/api/v1/apps/unknown-app/openapi.json"),
    );
    await expectPublicApiError(unknown, {
      code: "not_found",
      message: "App not found.",
      status: 404,
    });

    const malformed = await requestPublicApi(
      app,
      database,
      new Request("https://api.example.com/api/v1/apps/Bad_Slug/openapi.json"),
    );
    await expectPublicApiError(malformed, { code: "invalid_request", status: 400 });
  });
});
