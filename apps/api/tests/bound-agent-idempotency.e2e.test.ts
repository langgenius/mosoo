import { describe, expect, test } from "bun:test";

import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AgentDeploymentVersionId, SessionId, SessionMessageId } from "@mosoo/id";
import { Hono } from "hono";

import { registerPublicApiRoute } from "../src/adapters/http/routes/public-api-route";
import type { ApiCommandMessage } from "../src/modules/api-command/application/api-command-message";
import { getAccountViewer } from "../src/modules/auth/application/public-api-caller.service";
import { createBoundAgentThreadAndWait } from "../src/modules/public-api/app-agent-bound-ask.service";
import {
  beginBoundAgentCallIdempotency,
  hashBoundAgentCallIdempotencyBody,
  hashBoundAgentCallIdempotencySubject,
} from "../src/modules/public-api/app-agent-bound-idempotency.service";
import { mintAppAgentCapabilityToken } from "../src/modules/public-api/app-agent-capability";
import type { AppAgentCapabilityClaims } from "../src/modules/public-api/app-agent-capability";
import { queueSessionRun } from "../src/modules/runtime/application/session-run.service";
import type { ApiBindings, ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createApiCommandQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";
import type { ApiCommandQueueStub, SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const DEPLOYMENT_ID = "01J0000000000000000000000D";
const DEPLOYMENT_RUN_ID = "01J0000000000000000000000R";

interface DispatchCommandPayload {
  session: { id: string };
  sessionRunId: string;
}

interface DurableCounts {
  apiCommand: number;
  idempotency: number;
  run: number;
  session: number;
}

function createBoundAgentRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();

  registerPublicApiRoute(publicApi);
  app.route("/api", publicApi);
  return app;
}

function capabilityClaims(
  overrides: Partial<AppAgentCapabilityClaims> = {},
): AppAgentCapabilityClaims {
  return {
    agentId: PUBLIC_API_TEST_IDS.agent,
    appId: PUBLIC_API_TEST_IDS.app,
    binding: {
      env: "MOSOO_PUBLIC_AGENT",
      expose: "public_thread",
      name: "Public API Agent",
    },
    deploymentId: DEPLOYMENT_ID,
    deploymentRunId: DEPLOYMENT_RUN_ID,
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

async function insertDeploymentAuthority(
  database: SqliteD1Database,
  bindings: AppAgentCapabilityClaims["binding"][],
): Promise<void> {
  database.execute(`
    CREATE TABLE app_deployment (
      app_id text NOT NULL,
      deleted_at integer,
      id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE app_deployment_run (
      app_id text NOT NULL,
      deployment_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      plan_json text,
      status text NOT NULL
    );

    CREATE INDEX app_deployment_run_deployment_id_idx
      ON app_deployment_run (deployment_id, id);
  `);

  await database
    .prepare("INSERT INTO app_deployment (app_id, deleted_at, id) VALUES (?, NULL, ?)")
    .bind(PUBLIC_API_TEST_IDS.app, DEPLOYMENT_ID)
    .run();
  await database
    .prepare(
      "INSERT INTO app_deployment_run (app_id, deployment_id, id, plan_json, status) VALUES (?, ?, ?, ?, 'success')",
    )
    .bind(
      PUBLIC_API_TEST_IDS.app,
      DEPLOYMENT_ID,
      DEPLOYMENT_RUN_ID,
      JSON.stringify({ agentBindings: bindings }),
    )
    .run();
}

function createCompletingApiCommandQueue(database: SqliteD1Database): ApiCommandQueueStub {
  const sent: ApiCommandQueueStub["sent"] = [];

  return {
    sent,
    async send(body: ApiCommandMessage, options): Promise<void> {
      sent.push({
        body,
        contentType: options?.contentType ?? "json",
        delaySeconds: options?.delaySeconds ?? null,
        id: `completed-${sent.length + 1}`,
      });

      const command = await database
        .prepare("SELECT payload_json AS payloadJson FROM api_command WHERE id = ?")
        .bind(body.commandId)
        .first<{ payloadJson: string }>();

      if (command === null) {
        throw new Error("Queued API command is missing from the durable ledger.");
      }

      const payload = JSON.parse(command.payloadJson) as DispatchCommandPayload;
      const timestampMs = nowMsForTest() + sent.length;

      await database
        .prepare(
          `UPDATE session_run
          SET status = 'completed',
              completed_at = ?,
              status_changed_at = ?,
              status_event = 'run.complete',
              status_seq = status_seq + 1,
              status_source = 'driver',
              updated_at = ?
          WHERE id = ?`,
        )
        .bind(timestampMs, timestampMs, timestampMs, payload.sessionRunId)
        .run();
      await database
        .prepare(
          `UPDATE session
          SET status = 'IDLE',
              status_seq = status_seq + 1,
              message_seq_cursor = message_seq_cursor + 1,
              last_message_at = ?,
              updated_at = ?
          WHERE id = ?`,
        )
        .bind(timestampMs, timestampMs, payload.session.id)
        .run();

      const session = await database
        .prepare("SELECT message_seq_cursor AS seq FROM session WHERE id = ?")
        .bind(payload.session.id)
        .first<{ seq: number }>();

      if (session === null) {
        throw new Error("Queued Session is missing.");
      }

      await database
        .prepare(
          `INSERT INTO session_message (
            content_text,
            created_at,
            created_by_account_id,
            id,
            plan_json,
            role,
            segments_json,
            seq,
            session_id,
            session_run_id
          ) VALUES (?, ?, ?, ?, NULL, 'assistant', NULL, ?, ?, ?)`,
        )
        .bind(
          "The original bound request completed.",
          timestampMs,
          PUBLIC_API_TEST_IDS.ownerAccount,
          createPlatformId<SessionMessageId>(),
          session.seq,
          payload.session.id,
          payload.sessionRunId,
        )
        .run();
      await database
        .prepare(
          `UPDATE api_command
          SET status = 'completed',
              completed_at = ?,
              last_error_code = NULL,
              last_error_message = NULL,
              updated_at = ?
          WHERE id = ?`,
        )
        .bind(timestampMs, timestampMs, body.commandId)
        .run();
    },
  };
}

function failFirstMatchingStatement(database: D1Database, pattern: RegExp): D1Database {
  let failed = false;

  function wrapStatement(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    const shouldFail = pattern.test(query);

    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), query);
        }

        if (
          shouldFail &&
          !failed &&
          (property === "all" || property === "first" || property === "raw" || property === "run")
        ) {
          return async () => {
            failed = true;
            throw new Error(`Injected bound admission failure for: ${query}`);
          };
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

async function requestBoundAgent(input: {
  claims: AppAgentCapabilityClaims;
  database: D1Database;
  idempotencyKey?: string;
  message: string;
  queue: ApiCommandQueueStub;
}): Promise<Response> {
  const bindings = createPublicHttpTestBindings(input.database, {
    apiCommandQueue: input.queue,
  }) as ApiBindings;
  const token = await mintAppAgentCapabilityToken(
    bindings.RUNTIME_ACTION_TOKEN_SECRET,
    input.claims,
  );
  const headers = new Headers({ "Content-Type": "application/json" });

  if (input.idempotencyKey !== undefined) {
    headers.set("Idempotency-Key", input.idempotencyKey);
  }

  return createBoundAgentRouteTestApp().request(
    new Request(`https://api.example.com/api/v1/bound/${token}`, {
      body: JSON.stringify({ message: input.message }),
      headers,
      method: "POST",
    }),
    undefined,
    bindings,
    createTestExecutionContext(),
  );
}

async function readDurableCounts(database: SqliteD1Database): Promise<DurableCounts> {
  const [session, run, apiCommand, idempotency] = await Promise.all(
    ["session", "session_run", "api_command", "bound_agent_call_idempotency_key"].map((table) =>
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>(),
    ),
  );

  if (session === null || run === null || apiCommand === null || idempotency === null) {
    throw new Error("Durable count query did not return a row.");
  }

  return {
    apiCommand: apiCommand.count,
    idempotency: idempotency.count,
    run: run.count,
    session: session.count,
  };
}

async function withProviderProbeMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-5.4" }] });

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withAcceleratedClock<T>(operation: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  let nowMs = originalNow();
  Date.now = () => {
    nowMs += 30_000;
    return nowMs;
  };

  try {
    return await operation();
  } finally {
    Date.now = originalNow;
  }
}

async function createFixture(bindings = [capabilityClaims().binding]) {
  const database = await createPublicHttpContractDatabase();
  await insertDeploymentAuthority(database, bindings);
  const queue = createCompletingApiCommandQueue(database);

  return { database, queue };
}

describe("bound Agent HTTP idempotency", () => {
  test("serializes concurrent reservations onto one stable Session identity", async () => {
    const database = await createPublicHttpContractDatabase();
    const claims = capabilityClaims();
    const input = {
      bodyHash: await hashBoundAgentCallIdempotencyBody("concurrent request"),
      idempotencyKey: "concurrent-reservation-327",
      subjectHash: await hashBoundAgentCallIdempotencySubject(claims),
    };

    const reservations = await Promise.all([
      beginBoundAgentCallIdempotency(database, input),
      beginBoundAgentCallIdempotency(database, input),
    ]);

    expect(new Set(reservations.map((reservation) => reservation.reservationId)).size).toBe(1);
    expect(new Set(reservations.map((reservation) => reservation.sessionId)).size).toBe(1);
    expect(reservations.map((reservation) => reservation.status).toSorted()).toEqual([
      "existing",
      "reserved",
    ]);
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM bound_agent_call_idempotency_key").first(),
    ).resolves.toEqual({ count: 1 });
  });

  test("serializes concurrent HTTP retries onto one Session and Run", async () => {
    const { database, queue } = await createFixture();

    await withProviderProbeMock(async () => {
      const requests = await Promise.all([
        requestBoundAgent({
          claims: capabilityClaims(),
          database,
          idempotencyKey: "concurrent-http-327",
          message: "one concurrent logical request",
          queue,
        }),
        requestBoundAgent({
          claims: capabilityClaims(),
          database,
          idempotencyKey: "concurrent-http-327",
          message: "one concurrent logical request",
          queue,
        }),
      ]);
      const bodies = await Promise.all(requests.map((response) => response.json()));

      expect(requests.map((response) => response.status)).toEqual([200, 200]);
      expect(bodies[1]).toEqual(bodies[0]);
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 1,
      idempotency: 1,
      run: 1,
      session: 1,
    });
    expect(queue.sent).toHaveLength(1);
  });

  test("does not duplicate admission when the original service call times out", async () => {
    const { database } = await createFixture();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const claims = capabilityClaims({ exp: Date.now() + 24 * 60 * 60 * 1000 });
    const token = await mintAppAgentCapabilityToken(bindings.RUNTIME_ACTION_TOKEN_SECRET, claims);
    const request = {
      bindings,
      executionContext: null,
      idempotencyKey: "timeout-retry-327",
      input: { message: "same logical request" },
      requestUrl: `https://api.example.com/api/v1/bound/${token}`,
      token,
    } as const;

    await withProviderProbeMock(() =>
      withAcceleratedClock(async () => {
        await expect(createBoundAgentThreadAndWait(request)).rejects.toMatchObject({
          code: "deployment_agent_call_timeout",
          status: 504,
        });
        await expect(createBoundAgentThreadAndWait(request)).rejects.toMatchObject({
          code: "deployment_agent_call_timeout",
          status: 504,
        });
      }),
    );

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 1,
      idempotency: 1,
      run: 1,
      session: 1,
    });
    expect(queue.sent).toHaveLength(1);
  });

  test("recovers the original Session and Run after an ambiguous HTTP result", async () => {
    const { database, queue } = await createFixture();

    await withProviderProbeMock(async () => {
      const first = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "logical-request-327",
        message: "same logical request",
        queue,
      });
      const firstBody = await first.json();

      expect(first.status).toBe(200);

      // Discarding the first result models a response lost after durable admission.
      const retried = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "logical-request-327",
        message: "same logical request",
        queue,
      });

      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual(firstBody);
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 1,
      idempotency: 1,
      run: 1,
      session: 1,
    });
    expect(queue.sent).toHaveLength(1);
    const reservation = await database
      .prepare(
        `SELECT id, session_id AS sessionId
        FROM bound_agent_call_idempotency_key`,
      )
      .first<{ id: string; sessionId: string }>();
    const event = await database
      .prepare("SELECT source_event_id AS sourceEventId FROM session_event ORDER BY seq LIMIT 1")
      .first<{ sourceEventId: string }>();

    expect(reservation).not.toBeNull();
    expect(event?.sourceEventId).toBe(reservation?.id);
  });

  test("recovers the first Run without a binding or event receipt after a later Run", async () => {
    const { database, queue } = await createFixture();
    let firstBody: unknown;

    await withProviderProbeMock(async () => {
      const first = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "original-run-327",
        message: "original logical request",
        queue,
      });
      firstBody = await first.json();
      expect(first.status).toBe(200);

      const reservation = await database
        .prepare(
          `SELECT run_id AS runId, session_id AS sessionId
          FROM bound_agent_call_idempotency_key`,
        )
        .first<{ runId: string; sessionId: string }>();
      const viewer = await getAccountViewer(database, PUBLIC_API_TEST_IDS.ownerAccount);

      if (reservation === null || viewer === null) {
        throw new Error("Bound idempotency recovery fixture is incomplete.");
      }

      // Model interruption before both recovery links become durable. The
      // reserved Session itself must still prevent a later Run from becoming
      // the replay target for the original key.
      await database.prepare("UPDATE bound_agent_call_idempotency_key SET run_id = NULL").run();
      await database.prepare("UPDATE session_event SET source_event_id = id").run();

      const later = await queueSessionRun({
        bindings: createPublicHttpTestBindings(database, {
          apiCommandQueue: queue,
        }) as ApiBindings,
        executionContext: null,
        input: {
          accessViewer: viewer,
          attachmentIds: [],
          clientRequestId: null,
          prompt: "intentional later Run",
          session: {
            agent_id: PUBLIC_API_TEST_IDS.agent,
            app_id: PUBLIC_API_TEST_IDS.app,
            deployment_version_id: parsePlatformId<AgentDeploymentVersionId>(
              PUBLIC_API_TEST_IDS.deployment,
              "fixture deployment version",
            ),
            deployment_version_number: 1,
            id: parsePlatformId<SessionId>(reservation.sessionId, "bound Session"),
            model: "gpt-5.4",
            provider: "openai",
            runtime_id: "openai-runtime",
          },
        },
        requestUrl: "https://api.example.com/api/graphql",
        viewer,
      });

      expect(later.run.id).not.toBe(reservation.runId);

      const retried = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "original-run-327",
        message: "original logical request",
        queue,
      });

      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual(firstBody);
      await expect(
        database.prepare("SELECT run_id AS runId FROM bound_agent_call_idempotency_key").first(),
      ).resolves.toEqual({ runId: reservation.runId });
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 2,
      idempotency: 1,
      run: 2,
      session: 1,
    });
    expect(queue.sent).toHaveLength(2);
  });

  test("fails closed when one key is reused for a different body", async () => {
    const { database, queue } = await createFixture();

    await withProviderProbeMock(async () => {
      const first = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "body-conflict-327",
        message: "first body",
        queue,
      });
      const conflict = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "body-conflict-327",
        message: "different body",
        queue,
      });

      expect(first.status).toBe(200);
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({
        error: {
          code: "idempotency_conflict",
          message: "Idempotency-Key was already used for a different request.",
        },
      });
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 1,
      idempotency: 1,
      run: 1,
      session: 1,
    });
  });

  test("scopes the same key to the verified deployment binding identity", async () => {
    const alternateClaims = capabilityClaims({
      binding: {
        env: "MOSOO_SECOND_AGENT",
        expose: "public_thread",
        name: "Public API Agent",
      },
    });
    const { database, queue } = await createFixture([
      capabilityClaims().binding,
      alternateClaims.binding,
    ]);

    await withProviderProbeMock(async () => {
      const first = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "binding-scoped-327",
        message: "same body",
        queue,
      });
      const second = await requestBoundAgent({
        claims: alternateClaims,
        database,
        idempotencyKey: "binding-scoped-327",
        message: "same body",
        queue,
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 2,
      idempotency: 2,
      run: 2,
      session: 2,
    });
  });

  test("retries the same reserved Session after Session creation fails", async () => {
    const { database, queue } = await createFixture();
    const injectedDatabase = failFirstMatchingStatement(
      database,
      /\bINSERT\s+INTO\s+"session"(?:\s|\()/iu,
    );

    await withProviderProbeMock(async () => {
      const failed = await requestBoundAgent({
        claims: capabilityClaims(),
        database: injectedDatabase,
        idempotencyKey: "session-recovery-327",
        message: "recover after Session failure",
        queue,
      });

      expect(failed.status).toBe(500);
      await expect(readDurableCounts(database)).resolves.toEqual({
        apiCommand: 0,
        idempotency: 1,
        run: 0,
        session: 0,
      });

      const retried = await requestBoundAgent({
        claims: capabilityClaims(),
        database: injectedDatabase,
        idempotencyKey: "session-recovery-327",
        message: "recover after Session failure",
        queue,
      });

      expect(retried.status).toBe(200);
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 1,
      idempotency: 1,
      run: 1,
      session: 1,
    });
  });

  test("resumes the reserved Session after Run admission fails", async () => {
    const { database, queue } = await createFixture();
    const injectedDatabase = failFirstMatchingStatement(
      database,
      /\bINSERT\s+INTO\s+session_run\b/iu,
    );

    await withProviderProbeMock(async () => {
      const failed = await requestBoundAgent({
        claims: capabilityClaims(),
        database: injectedDatabase,
        idempotencyKey: "run-recovery-327",
        message: "recover after Run failure",
        queue,
      });

      expect(failed.status).toBe(500);
      await expect(readDurableCounts(database)).resolves.toEqual({
        apiCommand: 0,
        idempotency: 1,
        run: 0,
        session: 1,
      });

      const retried = await requestBoundAgent({
        claims: capabilityClaims(),
        database: injectedDatabase,
        idempotencyKey: "run-recovery-327",
        message: "recover after Run failure",
        queue,
      });

      expect(retried.status).toBe(200);
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 1,
      idempotency: 1,
      run: 1,
      session: 1,
    });
  });

  test("repairs the original Run binding after its first persistence attempt fails", async () => {
    const { database, queue } = await createFixture();
    const injectedDatabase = failFirstMatchingStatement(
      database,
      /\bUPDATE\s+"bound_agent_call_idempotency_key"\s+SET\b/iu,
    );

    await withProviderProbeMock(async () => {
      const failed = await requestBoundAgent({
        claims: capabilityClaims(),
        database: injectedDatabase,
        idempotencyKey: "run-binding-recovery-327",
        message: "recover the accepted Run binding",
        queue,
      });

      expect(failed.status).toBe(500);
      await expect(readDurableCounts(database)).resolves.toEqual({
        apiCommand: 1,
        idempotency: 1,
        run: 1,
        session: 1,
      });
      await expect(
        database.prepare("SELECT run_id AS runId FROM bound_agent_call_idempotency_key").first(),
      ).resolves.toEqual({ runId: null });

      const retried = await requestBoundAgent({
        claims: capabilityClaims(),
        database: injectedDatabase,
        idempotencyKey: "run-binding-recovery-327",
        message: "recover the accepted Run binding",
        queue,
      });

      expect(retried.status).toBe(200);
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 1,
      idempotency: 1,
      run: 1,
      session: 1,
    });
    expect(queue.sent).toHaveLength(1);
    expect(
      await database
        .prepare("SELECT run_id AS runId FROM bound_agent_call_idempotency_key")
        .first<{ runId: string | null }>(),
    ).toEqual({
      runId: expect.any(String),
    });
  });

  test("rechecks capability revocation before recovering an existing key", async () => {
    const { database, queue } = await createFixture();

    await withProviderProbeMock(async () => {
      const first = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "revoked-retry-327",
        message: "authorize every retry",
        queue,
      });
      expect(first.status).toBe(200);

      await database
        .prepare("UPDATE app_deployment SET deleted_at = ? WHERE id = ?")
        .bind(Date.now(), DEPLOYMENT_ID)
        .run();

      const revoked = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        idempotencyKey: "revoked-retry-327",
        message: "authorize every retry",
        queue,
      });

      expect(revoked.status).toBe(409);
      expect(await revoked.json()).toEqual({
        error: {
          code: "agent_not_published",
          message: "This capability is no longer authorized for the active deployment.",
        },
      });
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 1,
      idempotency: 1,
      run: 1,
      session: 1,
    });
  });

  test("preserves the existing non-idempotent behavior when no key is supplied", async () => {
    const { database, queue } = await createFixture();

    await withProviderProbeMock(async () => {
      const first = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        message: "intentional call one",
        queue,
      });
      const second = await requestBoundAgent({
        claims: capabilityClaims(),
        database,
        message: "intentional call two",
        queue,
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    await expect(readDurableCounts(database)).resolves.toEqual({
      apiCommand: 2,
      idempotency: 0,
      run: 2,
      session: 2,
    });
  });
});
