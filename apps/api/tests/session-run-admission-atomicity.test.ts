import { describe, expect, test } from "bun:test";

import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AgentDeploymentVersionId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import { createRuntimeEventSemanticHash } from "@mosoo/runtime-events";

import { API_COMMAND_QUEUE_SEND_FAILED_CODE } from "../src/modules/api-command/application/api-command-ledger";
import { getAccountViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { queueSessionRun } from "../src/modules/runtime/application/session-run.service";
import { recordCanonicalSessionRunTerminal } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import { createQueuedSessionRunRuntimeEvents } from "../src/modules/runtime/application/session-runs/session-run-view-events.service";
import { prepareAssistantMessageProjection } from "../src/modules/runtime/infrastructure/driver-instance/assistant-message-projection";
import { setSessionRunStatus } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { API_ERROR_CODE } from "../src/platform/errors";
import {
  PUBLIC_API_TEST_IDS,
  createApiCommandQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { ApiCommandQueueStub, SqliteD1Database } from "./helpers/public-api-http-test-fixture";
import { insertRuntimeEvent } from "./public-thread-api-fixtures";

interface AdmissionCounts {
  apiCommand: number;
  event: number;
  message: number;
  run: number;
}

interface SessionAdmissionState {
  lastMessageAt: number | null;
  lastRunId: string | null;
  messageSeqCursor: number;
  runtimeEventSeqCursor: number;
  status: string;
}

const FAILURE_POINTS = [
  {
    label: "Run insert",
    pattern: /\bINSERT\s+INTO\s+(?:"session_run"|session_run)(?:\s|\()/iu,
  },
  {
    label: "Session state update",
    pattern: /\bUPDATE\s+"session"\s+SET\b/iu,
  },
  {
    label: "user message insert",
    pattern: /\bINSERT\s+INTO\s+"session_message"/iu,
  },
  {
    label: "runtime event insert",
    pattern: /\bINSERT\s+INTO\s+"session_event"/iu,
  },
  {
    label: "dispatch command insert",
    pattern: /\bINSERT\s+INTO\s+"api_command"/iu,
  },
] as const;

function failFirstMatchingStatement(database: D1Database, pattern: RegExp): D1Database {
  let failed = false;

  function wrapStatement(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), query);
        }

        if (!failed && pattern.test(query) && property === "run") {
          return async () => {
            failed = true;
            throw new Error(`Injected D1 admission failure for: ${query}`);
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

function serializeD1Batches(database: D1Database): D1Database {
  let previousBatch = Promise.resolve();

  return {
    batch: <T = unknown>(statements: D1PreparedStatement[]) => {
      const batch = previousBatch.then(() => database.batch<T>(statements));
      previousBatch = batch.then(
        () => undefined,
        () => undefined,
      );
      return batch;
    },
    prepare: database.prepare.bind(database),
  } as D1Database;
}

async function readAdmissionCounts(database: SqliteD1Database): Promise<AdmissionCounts> {
  const [run, message, event, apiCommand] = await Promise.all(
    ["session_run", "session_message", "session_event", "api_command"].map((table) =>
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>(),
    ),
  );

  if (run === null || message === null || event === null || apiCommand === null) {
    throw new Error("Admission count query did not return a row.");
  }

  return {
    apiCommand: apiCommand.count,
    event: event.count,
    message: message.count,
    run: run.count,
  };
}

async function readSessionState(database: SqliteD1Database): Promise<SessionAdmissionState> {
  const state = await database
    .prepare(
      `SELECT
        last_message_at AS lastMessageAt,
        last_run_id AS lastRunId,
        message_seq_cursor AS messageSeqCursor,
        runtime_event_seq_cursor AS runtimeEventSeqCursor,
        status
      FROM session
      WHERE id = ?`,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .first<SessionAdmissionState>();

  if (state === null) {
    throw new Error("Owner Session is missing.");
  }

  return state;
}

function queueOwnerRun(input: {
  bindings: ApiBindings;
  clientRequestId?: string;
  viewer: AuthenticatedViewer;
}) {
  return queueSessionRun({
    bindings: input.bindings,
    executionContext: null,
    input: {
      accessViewer: input.viewer,
      attachmentIds: [],
      clientRequestId: input.clientRequestId ?? "issue-329-request",
      prompt: "Admit this request atomically.",
      session: {
        agent_id: PUBLIC_API_TEST_IDS.agent,
        project_id: PUBLIC_API_TEST_IDS.project,
        deployment_version_id: parsePlatformId<AgentDeploymentVersionId>(
          PUBLIC_API_TEST_IDS.deployment,
          "fixture deployment version",
        ),
        deployment_version_number: 1,
        id: parsePlatformId<SessionId>(PUBLIC_API_TEST_IDS.ownerSession, "fixture session"),
        model: "gpt-5.4",
        provider: "openai",
        runtime_id: "openai-runtime",
      },
    },
    requestUrl: "https://api.example.com/api/graphql",
    viewer: input.viewer,
  });
}

async function createFixture() {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  const viewer = await getAccountViewer(database, PUBLIC_API_TEST_IDS.ownerAccount);

  if (viewer === null) {
    throw new Error("Owner test viewer is missing.");
  }

  return { database, viewer };
}

async function completeRun(
  bindings: ApiBindings,
  database: SqliteD1Database,
  runId: SessionRunId,
): Promise<void> {
  for (const status of ["booting", "running"] as const) {
    const outcome = await setSessionRunStatus(database, {
      runId,
      source: "driver",
      status,
    });
    expect(outcome.kind).toBe("applied");
  }
  const finalMessageId = createPlatformId<SessionMessageId>();
  await insertRuntimeEvent(database, {
    kind: "message.added",
    occurredAt: 3,
    payload: { content: "done", messageId: finalMessageId, role: "agent" },
    runId,
    seq: 3,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await insertRuntimeEvent(database, {
    kind: "message.completed",
    occurredAt: 4,
    payload: { messageId: finalMessageId, role: "agent" },
    runId,
    seq: 4,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await database
    .prepare("UPDATE session SET runtime_event_seq_cursor = 4 WHERE id = ?")
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .run();
  await recordCanonicalSessionRunTerminal(bindings, {
    assistantMessage: prepareAssistantMessageProjection({
      createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      messageId: finalMessageId,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      sessionRunId: runId,
    }),
    error: null,
    runId,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    source: "driver",
    status: "completed",
    timestampMs: 5,
  });
}

describe("Session Run atomic admission", () => {
  test("hashes the exact sourced admission events and keeps replay cursors stable", async () => {
    const { database, viewer } = await createFixture();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: createApiCommandQueueStub(),
    }) as ApiBindings;
    const clientRequestId = "semantic-admission-request";
    const prompt = "Admit this request atomically.";
    const admitted = await queueOwnerRun({ bindings, clientRequestId, viewer });
    const messageId = await database
      .prepare("SELECT id FROM session_message WHERE session_run_id = ?")
      .bind(admitted.run.id)
      .first<string>("id");
    const storedEvents = await database
      .prepare(
        `SELECT id, occurred_at, semantic_hash, source_event_id
         FROM session_event
         WHERE run_id = ?
         ORDER BY seq`,
      )
      .bind(admitted.run.id)
      .all<{
        id: string;
        occurred_at: number;
        semantic_hash: string;
        source_event_id: string;
      }>();

    if (messageId === null || storedEvents.results.length !== 2) {
      throw new Error("Admission did not persist its canonical message and events.");
    }

    const expectedEvents = createQueuedSessionRunRuntimeEvents({
      prompt,
      run: admitted.run,
      sessionId: parsePlatformId<SessionId>(PUBLIC_API_TEST_IDS.ownerSession, "fixture session"),
      sessionMessageId: parsePlatformId(messageId, "fixture message"),
    });
    const expectedHashes = await Promise.all(
      expectedEvents.map((event, index) => {
        const stored = storedEvents.results[index];
        if (stored === undefined) {
          throw new Error("Admission event identity is missing.");
        }
        return createRuntimeEventSemanticHash({
          ...event,
          id: parsePlatformId(stored.id, "fixture runtime event"),
          occurredAt: new Date(stored.occurred_at).toISOString(),
          sourceEventId: stored.source_event_id,
        });
      }),
    );

    expect(storedEvents.results.map((event) => event.semantic_hash)).toEqual(expectedHashes);
    expect(storedEvents.results.map((event) => event.source_event_id)).toEqual([
      clientRequestId,
      storedEvents.results[1]?.id,
    ]);
    const beforeReplay = await readSessionState(database);

    await expect(queueOwnerRun({ bindings, clientRequestId, viewer })).rejects.toMatchObject({
      code: API_ERROR_CODE.sessionRunClientRequestDuplicate,
      status: 409,
    });
    await expect(readSessionState(database)).resolves.toEqual(beforeReplay);
    await expect(readAdmissionCounts(database)).resolves.toEqual({
      apiCommand: 1,
      event: 2,
      message: 1,
      run: 1,
    });
  });

  test.each([
    ["rejects a checkpoint owned by another workspace", PUBLIC_API_TEST_IDS.nonOwnerSession, false],
    ["accepts its ready checkpoint", PUBLIC_API_TEST_IDS.ownerSession, true],
  ] as const)(
    "%s before admitting a cattle follow-up",
    async (_name, workspaceSessionId, ready) => {
      const { database, viewer } = await createFixture();
      const apiCommandQueue = createApiCommandQueueStub();
      const bindings = createPublicHttpTestBindings(database, { apiCommandQueue }) as ApiBindings;
      await database
        .prepare("UPDATE session SET kind = 'cattle' WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .run();
      const first = await queueOwnerRun({
        bindings,
        clientRequestId: "checkpoint-run-a",
        viewer,
      });
      await completeRun(bindings, database, first.run.id);

      await expect(
        database
          .prepare("SELECT workspace_checkpoint_required FROM session WHERE id = ?")
          .bind(PUBLIC_API_TEST_IDS.ownerSession)
          .first<number>("workspace_checkpoint_required"),
      ).resolves.toBe(1);

      await expect(
        queueOwnerRun({ bindings, clientRequestId: "checkpoint-run-b", viewer }),
      ).rejects.toMatchObject({
        code: API_ERROR_CODE.sessionRunCheckpointPending,
        message: expect.stringContaining("still committing its previous workspace checkpoint"),
        status: 409,
      });

      database.execute(`
      INSERT INTO sandbox (
        agent_id, project_id, id, incarnation, kind, network_constraints_hash,
        owner_account_id, subject_kind, subject_id, status, bind_mount_ready,
        global_mounts_json, created_at, updated_at
      )
      VALUES (
        '${PUBLIC_API_TEST_IDS.agent}', '${PUBLIC_API_TEST_IDS.project}',
        '${PUBLIC_API_TEST_IDS.sandbox}', 1, 'cattle', '${"0".repeat(64)}',
        '${PUBLIC_API_TEST_IDS.ownerAccount}', 'session', '${PUBLIC_API_TEST_IDS.ownerSession}',
        'active', 1, '[]', 1, 1
      );

      INSERT INTO sandbox_session (
        cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
        sandbox_incarnation, session_id, status, updated_at
      )
      VALUES (
        '01J0000000000000000000000Z', 1, '/workspace/se/${PUBLIC_API_TEST_IDS.ownerSession}', '{}',
        '${PUBLIC_API_TEST_IDS.sandbox}', 1, '${PUBLIC_API_TEST_IDS.ownerSession}', 'active', 1
      );

      INSERT INTO sandbox_backup (
        created_at, dir, id, keep, sandbox_id, sandbox_incarnation, session_run_id,
        staging_id, status, ttl_seconds, updated_at, workspace_session_id
      )
      VALUES (
        1, '/workspace/se/${PUBLIC_API_TEST_IDS.ownerSession}', '${PUBLIC_API_TEST_IDS.operation}',
        0, '${PUBLIC_API_TEST_IDS.sandbox}', 1, '${first.run.id}',
        '${PUBLIC_API_TEST_IDS.operation}', 'ready', 315360000, 1,
        '${workspaceSessionId}'
      );
    `);

      const followUp = queueOwnerRun({
        bindings,
        clientRequestId: "checkpoint-run-b",
        viewer,
      });
      if (!ready) {
        await expect(followUp).rejects.toMatchObject({
          code: API_ERROR_CODE.sessionRunCheckpointPending,
        });
        return;
      }

      await expect(followUp).resolves.toMatchObject({ run: { status: "queued" } });
    },
  );

  test("grandfathers a completed cattle Run from before the checkpoint rollout", async () => {
    const { database, viewer } = await createFixture();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: createApiCommandQueueStub(),
    }) as ApiBindings;
    await database
      .prepare("UPDATE session SET kind = 'cattle' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    const first = await queueOwnerRun({
      bindings,
      clientRequestId: "legacy-checkpoint-run-a",
      viewer,
    });
    await database
      .prepare("UPDATE session_run SET status = 'completed' WHERE id = ?")
      .bind(first.run.id)
      .run();
    await database
      .prepare("UPDATE session SET status = 'IDLE' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    const second = await queueOwnerRun({
      bindings,
      clientRequestId: "legacy-checkpoint-run-b",
      viewer,
    });

    expect(second.run.status).toBe("queued");
    await expect(
      database
        .prepare("SELECT workspace_checkpoint_required FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first<number>("workspace_checkpoint_required"),
    ).resolves.toBe(0);
  });

  for (const failurePoint of FAILURE_POINTS) {
    test(`rolls back every durable admission record when the ${failurePoint.label} fails`, async () => {
      const { database, viewer } = await createFixture();
      const apiCommandQueue = createApiCommandQueueStub();
      const bindings = createPublicHttpTestBindings(
        failFirstMatchingStatement(database, failurePoint.pattern),
        { apiCommandQueue },
      ) as ApiBindings;

      await expect(queueOwnerRun({ bindings, viewer })).rejects.toThrow(
        "Injected D1 admission failure",
      );
      await expect(readAdmissionCounts(database)).resolves.toEqual({
        apiCommand: 0,
        event: 0,
        message: 0,
        run: 0,
      });
      await expect(readSessionState(database)).resolves.toEqual({
        lastMessageAt: null,
        lastRunId: null,
        messageSeqCursor: 0,
        runtimeEventSeqCursor: 0,
        status: "IDLE",
      });
      expect(apiCommandQueue.sent).toHaveLength(0);

      const retried = await queueOwnerRun({ bindings, viewer });

      expect(retried.run.status).toBe("queued");
      await expect(readAdmissionCounts(database)).resolves.toEqual({
        apiCommand: 1,
        event: 2,
        message: 1,
        run: 1,
      });
      await expect(readSessionState(database)).resolves.toMatchObject({
        lastRunId: retried.run.id,
        messageSeqCursor: 1,
        runtimeEventSeqCursor: 2,
        status: "RUNNING",
      });
      expect(apiCommandQueue.sent).toHaveLength(1);
    });
  }

  test("admits exactly one complete Run when two requests race for an idle Session", async () => {
    const { database, viewer } = await createFixture();
    const apiCommandQueue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(serializeD1Batches(database), {
      apiCommandQueue,
    }) as ApiBindings;

    const outcomes = await Promise.allSettled([
      queueOwnerRun({ bindings, clientRequestId: "issue-329-race-a", viewer }),
      queueOwnerRun({ bindings, clientRequestId: "issue-329-race-b", viewer }),
    ]);
    const accepted = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain("already has an active run");
    await expect(readAdmissionCounts(database)).resolves.toEqual({
      apiCommand: 1,
      event: 2,
      message: 1,
      run: 1,
    });
    await expect(readSessionState(database)).resolves.toMatchObject({
      messageSeqCursor: 1,
      runtimeEventSeqCursor: 2,
      status: "RUNNING",
    });
    expect(apiCommandQueue.sent).toHaveLength(1);
  });

  test("does not admit a Run while provisioning owns the Session", async () => {
    const { database, viewer } = await createFixture();
    const apiCommandQueue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, { apiCommandQueue }) as ApiBindings;

    await database
      .prepare(
        `UPDATE session
         SET runtime_provisioning_heartbeat_at = ?,
             runtime_provisioning_operation_id = ?,
             runtime_provisioning_sandbox_id = ?
         WHERE id = ?`,
      )
      .bind(
        1,
        PUBLIC_API_TEST_IDS.operation,
        PUBLIC_API_TEST_IDS.sandbox,
        PUBLIC_API_TEST_IDS.ownerSession,
      )
      .run();

    await expect(queueOwnerRun({ bindings, viewer })).rejects.toThrow();
    await expect(readAdmissionCounts(database)).resolves.toEqual({
      apiCommand: 0,
      event: 0,
      message: 0,
      run: 0,
    });
    await expect(readSessionState(database)).resolves.toEqual({
      lastMessageAt: null,
      lastRunId: null,
      messageSeqCursor: 0,
      runtimeEventSeqCursor: 0,
      status: "IDLE",
    });
    expect(apiCommandQueue.sent).toHaveLength(0);
  });

  test("classifies a completed client request replay without creating a second Run", async () => {
    const { database, viewer } = await createFixture();
    const apiCommandQueue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, { apiCommandQueue }) as ApiBindings;
    const first = await queueOwnerRun({ bindings, viewer });

    await database
      .prepare("UPDATE session_run SET status = 'completed' WHERE id = ?")
      .bind(first.run.id)
      .run();
    await database
      .prepare("UPDATE session SET status = 'IDLE' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await expect(queueOwnerRun({ bindings, viewer })).rejects.toMatchObject({
      code: API_ERROR_CODE.sessionRunClientRequestDuplicate,
      status: 409,
    });
    await expect(readAdmissionCounts(database)).resolves.toEqual({
      apiCommand: 1,
      event: 2,
      message: 1,
      run: 1,
    });
    await expect(readSessionState(database)).resolves.toMatchObject({
      lastRunId: first.run.id,
      messageSeqCursor: 1,
      runtimeEventSeqCursor: 2,
      status: "IDLE",
    });
    expect(apiCommandQueue.sent).toHaveLength(1);
  });

  test("retains a complete durable admission when Queue delivery fails", async () => {
    const { database, viewer } = await createFixture();
    const sent: ApiCommandQueueStub["sent"] = [];
    const apiCommandQueue: ApiCommandQueueStub = {
      sent,
      async send(body, options): Promise<void> {
        sent.push({
          body,
          contentType: options?.contentType ?? "json",
          delaySeconds: options?.delaySeconds ?? null,
          id: `ambiguous-${sent.length + 1}`,
        });
        throw new Error("Injected Queue producer failure.");
      },
    };
    const bindings = createPublicHttpTestBindings(database, { apiCommandQueue }) as ApiBindings;

    const result = await queueOwnerRun({ bindings, viewer });

    expect(result.run.status).toBe("queued");
    await expect(readAdmissionCounts(database)).resolves.toEqual({
      apiCommand: 1,
      event: 2,
      message: 1,
      run: 1,
    });
    await expect(
      database.prepare("SELECT last_error_code AS lastErrorCode, status FROM api_command").first(),
    ).resolves.toEqual({
      lastErrorCode: API_COMMAND_QUEUE_SEND_FAILED_CODE,
      status: "queued",
    });
    expect(sent).toHaveLength(1);
  });
});
