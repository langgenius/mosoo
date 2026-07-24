import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AgentDeploymentVersionId, SessionId } from "@mosoo/id";

import { API_COMMAND_QUEUE_SEND_FAILED_CODE } from "../src/modules/api-command/application/api-command-ledger";
import { getAccountViewer } from "../src/modules/auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { queueSessionRun } from "../src/modules/runtime/application/session-run.service";
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
        app_id: PUBLIC_API_TEST_IDS.app,
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

describe("Session Run atomic admission", () => {
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
