import { describe, expect, test } from "bun:test";

import type { DriverInstanceId, SessionMessageId, SessionRunId } from "@mosoo/id";

import {
  recordCanonicalSessionRunFailure,
  recordCanonicalSessionRunTerminal,
} from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import { createSessionRunUpdatedEvent } from "../src/modules/runtime/application/session-runs/session-run-view-events.service";
import {
  assertCanonicalTerminalSessionRunProjection,
  reconcileTerminalSessionRuns,
} from "../src/modules/runtime/application/session-runs/terminal-run-reconciliation.service";
import { createSessionRunTerminalSourceId } from "../src/modules/runtime/domain/session-run-terminal-event-id";
import { commitTerminalRunProjection } from "../src/modules/runtime/infrastructure/driver-instance/completed-run-commit.repository";
import { getRuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/session-link.repository";
import { recordDriverInstanceFailure } from "../src/modules/runtime/infrastructure/driver-instance/terminal-driver-events";
import { getSessionRunSummary } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertActiveSandboxSessionFixture,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";
import { insertRuntimeEvent } from "./public-thread-api-fixtures";

const RUN_ID = PUBLIC_API_TEST_IDS.run as SessionRunId;
const DRIVER_ID = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
const FINAL_MESSAGE_ID = "01J0000000000000000000000M" as SessionMessageId;
const CANONICAL_FAILURE_SOURCE_ID = `session-run-terminal:${RUN_ID}:run.failed`;
const DRIVER_ERROR = {
  code: "driver.command_failed",
  details: {},
  message: "OpenAi app-server exited with code 1.",
  retryable: false,
} as const;
const PROVISION_ERROR = {
  code: "runtime.provision_failed",
  details: {},
  message: "Driver command dispatch failed.",
  retryable: false,
} as const;

interface FailureEventRow {
  content_text: string;
  event_type: string;
  source_event_id: string;
}

function advanceRunAfterFirstSummaryRead(
  database: SqliteD1Database,
  advance: () => Promise<void>,
): { database: D1Database; advanced: () => boolean } {
  let advanced = false;

  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values));
        }
        if (property === "raw") {
          return async () => {
            const rows = await target.raw();
            if (!advanced) {
              advanced = true;
              await advance();
            }
            return rows;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  return {
    advanced: () => advanced,
    database: new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) =>
            query.includes('from "session_run"')
              ? wrap(target.prepare(query))
              : target.prepare(query);
        }

        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database,
  };
}

async function insertLinkedRunFixture(
  database: SqliteD1Database,
  status: "booting" | "completed" | "cancelled" | "failed" = "booting",
): Promise<void> {
  await insertOwnerSession(database);
  await insertActiveSandboxSessionFixture(database, {
    ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    timestampMs: 1,
  });
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          boot_token_expires_at,
          boot_token_hash,
          created_at,
          expires_at,
          heartbeat_count,
          protocol,
          protocol_version,
          runtime,
          sandbox_id,
          sandbox_incarnation,
          sandbox_session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      DRIVER_ID,
      1,
      new Uint8Array([1]),
      1,
      1,
      0,
      "orpc-ws",
      1,
      "openai-runtime",
      PUBLIC_API_TEST_IDS.sandbox,
      1,
      PUBLIC_API_TEST_IDS.ownerSession,
      "ready",
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO session_run (
          id,
          session_id,
          agent_id,
          created_by_account_id,
          deployment_version_id,
          deployment_version_number,
          driver_instance_id,
          trigger,
          status,
          provider,
          model,
          runtime_id,
          trace_id,
          started_at,
          completed_at,
          error_code,
          error_message,
          error_details_json,
          error_retryable,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      RUN_ID,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.deployment,
      1,
      DRIVER_ID,
      "user_prompt",
      status,
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-terminal-failure",
      1,
      status === "booting" ? null : 2,
      status === "failed" ? DRIVER_ERROR.code : null,
      status === "failed" ? DRIVER_ERROR.message : null,
      status === "failed" ? "{}" : null,
      status === "failed" ? 0 : null,
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ?, updated_at = 1 WHERE id = ?")
    .bind(RUN_ID, status === "booting" ? "RUNNING" : "IDLE", PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

async function insertHealthyFailedRunFixture(database: SqliteD1Database): Promise<SessionRunId> {
  const runId = PUBLIC_API_TEST_IDS.runAlt as SessionRunId;
  await database
    .prepare(
      `INSERT INTO session_run (
         id, session_id, agent_id, created_by_account_id, deployment_version_id,
         deployment_version_number, driver_instance_id, trigger, status, provider,
         model, runtime_id, trace_id, started_at, completed_at, error_code,
         error_message, error_details_json, error_retryable, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, 'user_prompt', 'failed', 'openai',
                 'gpt-5.4', 'openai-runtime', 'trace-healthy-terminal-repair', 2, 2,
                 ?, ?, '{}', 0, 2, 2)`,
    )
    .bind(
      runId,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.deployment,
      DRIVER_ID,
      PROVISION_ERROR.code,
      PROVISION_ERROR.message,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = 'RUNNING', updated_at = 2 WHERE id = ?")
    .bind(runId, PUBLIC_API_TEST_IDS.ownerSession)
    .run();
  return runId;
}

async function readFailureEvents(database: SqliteD1Database): Promise<FailureEventRow[]> {
  return database
    .prepare(
      `
        SELECT content_text, event_type, source_event_id
        FROM session_event
        WHERE session_id = ? AND event_type = 'run.failed'
        ORDER BY seq
      `,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .all<FailureEventRow>()
    .then((result) => result.results ?? []);
}

async function insertSealedAssistantAuthority(database: SqliteD1Database): Promise<void> {
  await insertRuntimeEvent(database, {
    kind: "message.added",
    occurredAt: 1,
    payload: { content: "done", messageId: FINAL_MESSAGE_ID, role: "agent" },
    runId: RUN_ID,
    seq: 1,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await insertRuntimeEvent(database, {
    kind: "message.completed",
    occurredAt: 2,
    payload: { messageId: FINAL_MESSAGE_ID, role: "agent" },
    runId: RUN_ID,
    seq: 2,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await database
    .prepare(
      `
        INSERT INTO session_message (
          content_text,
          created_at,
          created_by_account_id,
          id,
          plan_json,
          projection_format,
          role,
          segments_json,
          seq,
          session_id,
          session_run_id
        )
        VALUES ('', 1, ?, ?, NULL, 'event_stream_v3', 'assistant', NULL, 1, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.ownerAccount,
      FINAL_MESSAGE_ID,
      PUBLIC_API_TEST_IDS.ownerSession,
      RUN_ID,
    )
    .run();
  await database
    .prepare("UPDATE session SET message_seq_cursor = 1, runtime_event_seq_cursor = 2 WHERE id = ?")
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

async function insertParentlessToolOutput(
  database: SqliteD1Database,
  eventSeq: number,
): Promise<void> {
  await insertRuntimeEvent(database, {
    kind: "tool.call.updated",
    occurredAt: eventSeq,
    payload: {
      rawOutput: "parentless output",
      status: "completed",
      title: "Shell",
      toolCallId: "parentless-tool",
    },
    runId: RUN_ID,
    seq: eventSeq,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await database
    .prepare(
      `UPDATE session
          SET runtime_event_seq_cursor = MAX(runtime_event_seq_cursor, ?)
        WHERE id = ?`,
    )
    .bind(eventSeq, PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

async function insertParentlessToolCarrier(
  database: SqliteD1Database,
  input: { readonly eventSeq: number; readonly messageSeq: number },
): Promise<void> {
  await insertParentlessToolOutput(database, input.eventSeq);
  await database
    .prepare(
      `INSERT INTO session_message (
         content_text, created_at, created_by_account_id, id, plan_json,
         projection_format, role, segments_json, seq, session_id, session_run_id
       ) VALUES ('', ?, ?, ?, NULL, 'event_stream_v3', 'assistant', NULL, ?, ?, ?)`,
    )
    .bind(
      input.eventSeq,
      PUBLIC_API_TEST_IDS.ownerAccount,
      RUN_ID,
      input.messageSeq,
      PUBLIC_API_TEST_IDS.ownerSession,
      RUN_ID,
    )
    .run();
  await database
    .prepare(
      `UPDATE session
          SET message_seq_cursor = MAX(message_seq_cursor, ?)
        WHERE id = ?`,
    )
    .bind(input.messageSeq, PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

async function commitCompletedWithoutFinalStream(database: SqliteD1Database): Promise<void> {
  const current = await getSessionRunSummary(database, RUN_ID);
  if (current === null) {
    throw new Error("Missing Session Run fixture.");
  }
  const completedAt = new Date(2).toISOString();
  const run = {
    ...current,
    completedAt,
    startedAt: current.startedAt ?? completedAt,
    status: "completed" as const,
    updatedAt: completedAt,
  };
  const sourceEventId = createSessionRunTerminalSourceId(RUN_ID, "run.completed");
  const event = createSessionRunUpdatedEvent(
    run,
    PUBLIC_API_TEST_IDS.ownerSession,
    "IDLE",
    sourceEventId,
  );
  await commitTerminalRunProjection(database, {
    assistantMessage: null,
    error: null,
    runId: RUN_ID,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    source: "driver",
    targetStatus: "completed",
    terminalEvent: { event, occurredAt: 2, sourceEventId },
    timestampMs: 2,
  });
}

async function insertLegacyCompletedAuthorityWithCarrier(
  database: SqliteD1Database,
): Promise<void> {
  await insertParentlessToolCarrier(database, { eventSeq: 1, messageSeq: 2 });
  await database
    .prepare(
      `INSERT INTO session_message (
         content_text, created_at, created_by_account_id, id, plan_json,
         projection_format, role, segments_json, seq, session_id, session_run_id
       ) VALUES ('legacy final', 1, ?, ?, NULL, 'materialized', 'assistant', NULL, 1, ?, ?)`,
    )
    .bind(
      PUBLIC_API_TEST_IDS.ownerAccount,
      FINAL_MESSAGE_ID,
      PUBLIC_API_TEST_IDS.ownerSession,
      RUN_ID,
    )
    .run();
  await insertRuntimeEvent(database, {
    kind: "run.completed",
    occurredAt: 2,
    payload: { finalMessageId: FINAL_MESSAGE_ID, stopReason: "end_turn" },
    runId: RUN_ID,
    seq: 2,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await database
    .prepare(
      `UPDATE session_event SET semantic_hash = NULL, terminal_event_json = NULL
        WHERE run_id = ? AND event_type = 'run.completed'`,
    )
    .bind(RUN_ID)
    .run();
  await database
    .prepare(
      `UPDATE session
          SET message_seq_cursor = 2, runtime_event_seq_cursor = 2
        WHERE id = ?`,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

describe("canonical session run terminal failure", () => {
  test("returns stale when the Run advances after its authoritative read", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    await database
      .prepare(
        `UPDATE session_run
            SET started_at = NULL,
                status = 'queued',
                status_seq = status_seq + 1,
                updated_at = 1
          WHERE id = ?`,
      )
      .bind(RUN_ID)
      .run();
    const race = advanceRunAfterFirstSummaryRead(database, async () => {
      await database
        .prepare(
          `UPDATE session_run
              SET started_at = 2,
                  status = 'booting',
                  status_seq = status_seq + 1,
                  updated_at = 2
            WHERE id = ?`,
        )
        .bind(RUN_ID)
        .run();
    });
    const bindings = {
      ...(createPublicHttpTestBindings(database) as ApiBindings),
      DB: race.database,
    };

    await expect(
      recordCanonicalSessionRunFailure(bindings, {
        error: PROVISION_ERROR,
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        source: "api",
      }),
    ).resolves.toEqual({ kind: "not_failed", status: "booting" });

    expect(race.advanced()).toBe(true);
    await expect(
      database
        .prepare(
          `SELECT completed_at, error_code, started_at, status
             FROM session_run
            WHERE id = ?`,
        )
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({
      completed_at: null,
      error_code: null,
      started_at: 2,
      status: "booting",
    });
    await expect(
      database
        .prepare("SELECT status FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first(),
    ).resolves.toEqual({ status: "RUNNING" });
    expect(await readFailureEvents(database)).toEqual([]);
  });

  test("treats a concurrent failed transition as canonical success", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    const outcomes = await Promise.all([
      recordCanonicalSessionRunFailure(bindings, {
        error: DRIVER_ERROR,
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        source: "driver",
      }),
      recordCanonicalSessionRunFailure(bindings, {
        error: PROVISION_ERROR,
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        source: "api",
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).toSorted()).toEqual(["failed", "not_failed"]);
    expect(await readFailureEvents(database)).toHaveLength(1);
  });

  test("keeps one persisted driver failure when dispatch observes the terminal run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await recordDriverInstanceFailure(bindings, {
      driverInstanceId: DRIVER_ID,
      error: DRIVER_ERROR,
      sessionRunId: RUN_ID,
    });
    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });

    const run = await database
      .prepare("SELECT error_code, error_message, status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ error_code: string; error_message: string; status: string }>();

    expect(run).toEqual({
      error_code: DRIVER_ERROR.code,
      error_message: DRIVER_ERROR.message,
      status: "failed",
    });
    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: DRIVER_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("keeps one persisted provision failure when the driver reports terminal later", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });
    await recordDriverInstanceFailure(bindings, {
      driverInstanceId: DRIVER_ID,
      error: DRIVER_ERROR,
      sessionRunId: RUN_ID,
    });

    const run = await database
      .prepare("SELECT error_code, error_message, status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ error_code: string; error_message: string; status: string }>();

    expect(run).toEqual({
      error_code: PROVISION_ERROR.code,
      error_message: PROVISION_ERROR.message,
      status: "failed",
    });
    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: PROVISION_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("repairs a missing terminal failure event idempotently", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database, "failed");
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await recordCanonicalSessionRunFailure(bindings, {
      error: DRIVER_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "system",
    });
    await recordCanonicalSessionRunFailure(bindings, {
      error: DRIVER_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "system",
    });

    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: DRIVER_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("keeps the API terminal winner when the Driver uses a cached run link", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const link = await getRuntimeSessionLink(database, DRIVER_ID);

    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });

    await recordDriverInstanceFailure(bindings, {
      driverInstanceId: DRIVER_ID,
      error: DRIVER_ERROR,
      link,
      sessionRunId: RUN_ID,
    });

    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: PROVISION_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("repairs a lost terminal event after the Driver has stopped", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await database
      .prepare(
        `
          UPDATE session_run
             SET completed_at = 2,
                 error_code = ?,
                 error_details_json = '{}',
                 error_message = ?,
                 error_retryable = 0,
                 status = 'failed',
                 status_operation_id = NULL,
                 status_seq = status_seq + 1,
                 status_source = 'api',
                 updated_at = 2
           WHERE id = ?
        `,
      )
      .bind(PROVISION_ERROR.code, PROVISION_ERROR.message, RUN_ID)
      .run();
    await database
      .prepare("UPDATE session SET status = 'IDLE', updated_at = 2 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await database
      .prepare("UPDATE driver_instance SET status = ? WHERE id = ?")
      .bind("stopped", DRIVER_ID)
      .run();

    expect(await readFailureEvents(database)).toEqual([]);

    const firstRepair = await reconcileTerminalSessionRuns(bindings, {
      limit: 10,
    });
    const secondRepair = await reconcileTerminalSessionRuns(bindings, {
      limit: 10,
    });

    expect(firstRepair.reconciledRunIds).toEqual([RUN_ID]);
    expect(secondRepair.reconciledRunIds).toEqual([]);
    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: PROVISION_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("repairs a completed Run that has no final assistant", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database, "completed");
    await insertParentlessToolCarrier(database, { eventSeq: 1, messageSeq: 1 });
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await database
      .prepare("UPDATE driver_instance SET status = ? WHERE id = ?")
      .bind("stopped", DRIVER_ID)
      .run();

    const repaired = await reconcileTerminalSessionRuns(bindings, {
      limit: 10,
    });

    expect(repaired.reconciledRunIds).toEqual([RUN_ID]);
    expect(
      await database
        .prepare(
          "SELECT stream_id FROM session_event WHERE run_id = ? AND event_type = 'run.completed'",
        )
        .bind(RUN_ID)
        .first(),
    ).toEqual({ stream_id: null });
    expect(
      await database
        .prepare("SELECT id FROM session_message WHERE session_run_id = ? AND role = 'assistant'")
        .bind(RUN_ID)
        .all(),
    ).toMatchObject({ results: [{ id: RUN_ID }] });
  });

  test("repairs a completed Run from its unique sealed assistant authority", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database, "completed");
    await insertSealedAssistantAuthority(database);
    await insertParentlessToolCarrier(database, { eventSeq: 3, messageSeq: 2 });
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await database
      .prepare("UPDATE session SET status = ? WHERE id = ?")
      .bind("RUNNING", PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = ? WHERE id = ?")
      .bind("stopped", DRIVER_ID)
      .run();

    const repaired = await reconcileTerminalSessionRuns(bindings, {
      limit: 10,
    });
    await expect(
      assertCanonicalTerminalSessionRunProjection(bindings, {
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        status: "completed",
      }),
    ).resolves.toBeUndefined();
    const session = await database
      .prepare("SELECT status FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .first<{ status: string }>();
    const completedEvents = await database
      .prepare(
        `
          SELECT event_type, source_event_id
          FROM session_event
          WHERE run_id = ? AND event_type = 'run.completed'
        `,
      )
      .bind(RUN_ID)
      .all<{ event_type: string; source_event_id: string }>();

    expect(repaired.reconciledRunIds).toEqual([RUN_ID]);
    expect(session).toEqual({ status: "IDLE" });
    expect(completedEvents.results).toEqual([
      {
        event_type: "run.completed",
        source_event_id: `session-run-terminal:${RUN_ID}:run.completed`,
      },
    ]);
  });

  test("recognizes a legacy materialized assistant beside a parentless tool carrier", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database, "completed");
    await insertLegacyCompletedAuthorityWithCarrier(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expect(
      assertCanonicalTerminalSessionRunProjection(bindings, {
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        status: "completed",
      }),
    ).resolves.toBeUndefined();
  });

  test("adopts a canonical completed Run that intentionally has no final stream", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    await insertParentlessToolOutput(database, 1);
    await commitCompletedWithoutFinalStream(database);
    await database
      .prepare("UPDATE session SET status = 'RUNNING', updated_at = 1 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = ?")
      .bind(DRIVER_ID)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    const repaired = await reconcileTerminalSessionRuns(bindings, {
      limit: 10,
    });

    expect(repaired.reconciledSessionIds).toEqual([PUBLIC_API_TEST_IDS.ownerSession]);
    expect(
      await database
        .prepare("SELECT status FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first(),
    ).toEqual({ status: "IDLE" });
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM session_message WHERE session_run_id = ? AND role = 'assistant'",
        )
        .bind(RUN_ID)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await database
        .prepare("SELECT id FROM session_message WHERE session_run_id = ? AND role = 'assistant'")
        .bind(RUN_ID)
        .first(),
    ).toEqual({ id: RUN_ID });
  });

  test("does not report a newer stale Session projection as reconciled", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    await commitCompletedWithoutFinalStream(database);
    const run = await database
      .prepare("SELECT updated_at FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ updated_at: number }>();
    if (run === null) {
      throw new Error("Missing terminal Run fixture.");
    }
    await database
      .prepare("UPDATE session SET status = 'RUNNING', updated_at = ? WHERE id = ?")
      .bind(run.updated_at + 1, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = ?")
      .bind(DRIVER_ID)
      .run();

    const result = await reconcileTerminalSessionRuns(
      createPublicHttpTestBindings(database) as ApiBindings,
      { limit: 10 },
    );

    expect(result).toMatchObject({
      failures: [
        {
          message: expect.stringContaining("did not converge its current Session"),
          runId: RUN_ID,
        },
      ],
      reconciledRunIds: [],
      reconciledSessionIds: [],
    });
    await expect(
      database
        .prepare("SELECT status FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first(),
    ).resolves.toEqual({ status: "RUNNING" });
  });

  test("retries a repaired authority without changing terminal Run semantics", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    await commitCompletedWithoutFinalStream(database);
    await database
      .prepare(
        `INSERT INTO session_message (
           content_text, created_at, created_by_account_id, id, plan_json,
           projection_format, role, segments_json, seq, session_id, session_run_id
         ) VALUES ('not a carrier', 2, ?, ?, NULL, 'materialized', 'assistant', NULL, 1, ?, ?)`,
      )
      .bind(PUBLIC_API_TEST_IDS.ownerAccount, RUN_ID, PUBLIC_API_TEST_IDS.ownerSession, RUN_ID)
      .run();
    await database
      .prepare("UPDATE session SET status = 'RUNNING', updated_at = 1 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = ?")
      .bind(DRIVER_ID)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const semanticRun = await database
      .prepare(
        `SELECT completed_at, error_code, error_details_json, error_message,
                error_retryable, status, status_seq, status_source, updated_at
           FROM session_run
          WHERE id = ?`,
      )
      .bind(RUN_ID)
      .first();

    await expect(reconcileTerminalSessionRuns(bindings, { limit: 10 })).resolves.toMatchObject({
      failures: [
        {
          message: expect.stringContaining("Canonical assistant messages"),
          runId: RUN_ID,
        },
      ],
    });
    const claimedRun = await database
      .prepare(
        `SELECT completed_at, error_code, error_details_json, error_message,
                error_retryable, status, status_seq, status_source,
                terminal_reconciliation_attempted_at, updated_at
           FROM session_run
          WHERE id = ?`,
      )
      .bind(RUN_ID)
      .first<{ terminal_reconciliation_attempted_at: number }>();
    expect(claimedRun).toEqual({
      ...semanticRun,
      terminal_reconciliation_attempted_at: expect.any(Number),
    });
    const attemptedAt = claimedRun?.terminal_reconciliation_attempted_at;
    if (attemptedAt === undefined) {
      throw new Error("Missing terminal reconciliation attempt marker.");
    }
    await database.prepare("DELETE FROM session_message WHERE id = ?").bind(RUN_ID).run();
    await database
      .prepare("UPDATE session_run SET terminal_reconciliation_attempted_at = ? WHERE id = ?")
      .bind(attemptedAt - 10 * 60_000 - 1, RUN_ID)
      .run();

    await expect(reconcileTerminalSessionRuns(bindings, { limit: 10 })).resolves.toMatchObject({
      failures: [],
      reconciledSessionIds: [PUBLIC_API_TEST_IDS.ownerSession],
    });
    await expect(
      database
        .prepare("SELECT status FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first(),
    ).resolves.toEqual({ status: "IDLE" });
  });

  test("rotates a poisoned candidate behind the next repair batch", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database, "completed");
    const healthyRunId = await insertHealthyFailedRunFixture(database);
    await database
      .prepare(
        `INSERT INTO session_message (
           content_text, created_at, created_by_account_id, id, plan_json,
           projection_format, role, segments_json, seq, session_id, session_run_id
         ) VALUES ('not a carrier', 1, ?, ?, NULL, 'materialized', 'assistant', NULL, 1, ?, ?)`,
      )
      .bind(PUBLIC_API_TEST_IDS.ownerAccount, RUN_ID, PUBLIC_API_TEST_IDS.ownerSession, RUN_ID)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = ?")
      .bind(DRIVER_ID)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expect(reconcileTerminalSessionRuns(bindings, { limit: 1 })).resolves.toMatchObject({
      failures: [
        {
          message: expect.stringContaining("invalid parentless tool carrier"),
          runId: RUN_ID,
        },
      ],
      reconciledRunIds: [],
    });
    await expect(
      database
        .prepare(
          "SELECT source_event_id FROM session_event WHERE run_id = ? AND event_type = 'run.failed'",
        )
        .bind(healthyRunId)
        .first(),
    ).resolves.toBeNull();
    await expect(reconcileTerminalSessionRuns(bindings, { limit: 1 })).resolves.toMatchObject({
      failures: [],
      reconciledRunIds: [healthyRunId],
    });
    await expect(
      database
        .prepare(
          "SELECT source_event_id FROM session_event WHERE run_id = ? AND event_type = 'run.failed'",
        )
        .bind(healthyRunId)
        .first(),
    ).resolves.toEqual({
      source_event_id: createSessionRunTerminalSourceId(healthyRunId, "run.failed"),
    });
    await expect(
      database
        .prepare("SELECT last_run_id, status FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first(),
    ).resolves.toEqual({ last_run_id: healthyRunId, status: "IDLE" });
  });

  test("rotates a malformed terminal Run before parsing the next batch", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database, "failed");
    const healthyRunId = await insertHealthyFailedRunFixture(database);
    await database
      .prepare("UPDATE session_run SET error_details_json = '{' WHERE id = ?")
      .bind(RUN_ID)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = ?")
      .bind(DRIVER_ID)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expect(reconcileTerminalSessionRuns(bindings, { limit: 1 })).resolves.toMatchObject({
      failures: [{ runId: RUN_ID }],
      reconciledRunIds: [],
    });
    await expect(reconcileTerminalSessionRuns(bindings, { limit: 1 })).resolves.toMatchObject({
      failures: [],
      reconciledRunIds: [healthyRunId],
    });
  });

  test("rejects assistant rows that contradict a canonical no-final completion", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    await commitCompletedWithoutFinalStream(database);
    await database
      .prepare(
        `INSERT INTO session_message (
           content_text, created_at, created_by_account_id, id, plan_json,
           projection_format, role, segments_json, seq, session_id, session_run_id
         ) VALUES ('', 2, ?, ?, NULL, 'event_stream_v3', 'assistant', NULL, 1, ?, ?)`,
      )
      .bind(
        PUBLIC_API_TEST_IDS.ownerAccount,
        FINAL_MESSAGE_ID,
        PUBLIC_API_TEST_IDS.ownerSession,
        RUN_ID,
      )
      .run();
    await database
      .prepare("UPDATE session SET status = 'RUNNING', updated_at = 1 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = ?")
      .bind(DRIVER_ID)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expect(reconcileTerminalSessionRuns(bindings, { limit: 10 })).resolves.toMatchObject({
      failures: [
        {
          message: expect.stringContaining("Canonical assistant messages"),
          runId: RUN_ID,
        },
      ],
    });
  });

  test("rejects a terminal receipt whose semantic stream authority changed", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    await commitCompletedWithoutFinalStream(database);
    await database
      .prepare("UPDATE session_event SET stream_id = 'corrupt-progress' WHERE run_id = ?")
      .bind(RUN_ID)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await expect(
      recordCanonicalSessionRunTerminal(bindings, {
        assistantMessage: null,
        error: null,
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        source: "driver",
        status: "completed",
      }),
    ).rejects.toThrow("terminal semantic authority is invalid");
    await database
      .prepare("UPDATE session SET status = 'RUNNING', updated_at = 1 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = ?")
      .bind(DRIVER_ID)
      .run();
    await expect(reconcileTerminalSessionRuns(bindings, { limit: 10 })).resolves.toMatchObject({
      failures: [
        {
          message: expect.stringContaining("terminal semantic authority is invalid"),
          runId: RUN_ID,
        },
      ],
    });
  });

  test("refuses to invent an old terminal receipt once a newer Run owns the Session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database, "completed");
    await insertSealedAssistantAuthority(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await database
      .prepare(
        `
          INSERT INTO session_run (
            id,
            session_id,
            agent_id,
            created_by_account_id,
            trigger,
            status,
            provider,
            model,
            runtime_id,
            trace_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        PUBLIC_API_TEST_IDS.runAlt,
        PUBLIC_API_TEST_IDS.ownerSession,
        PUBLIC_API_TEST_IDS.agent,
        PUBLIC_API_TEST_IDS.ownerAccount,
        "user_prompt",
        "running",
        "openai",
        "gpt-5.4",
        "openai-runtime",
        "trace-newer-run",
        2,
        2,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.runAlt, "RUNNING", PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = ? WHERE id = ?")
      .bind("stopped", DRIVER_ID)
      .run();

    await expect(reconcileTerminalSessionRuns(bindings, { limit: 10 })).resolves.toMatchObject({
      failures: [
        {
          message: expect.stringContaining("not safely repairable"),
          runId: RUN_ID,
        },
      ],
    });

    const session = await database
      .prepare("SELECT last_run_id, status FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .first<{ last_run_id: string; status: string }>();

    expect(session).toEqual({
      last_run_id: PUBLIC_API_TEST_IDS.runAlt,
      status: "RUNNING",
    });
    const completedEvent = await database
      .prepare(
        "SELECT source_event_id FROM session_event WHERE run_id = ? AND event_type = 'run.completed'",
      )
      .bind(RUN_ID)
      .first<{ source_event_id: string }>();

    expect(completedEvent).toBeNull();
    expect(await readFailureEvents(database)).toEqual([]);
  });

  test("does not append a failure after a non-failed terminal outcome", async () => {
    for (const status of ["completed", "cancelled"] as const) {
      const database = await createPublicHttpContractDatabase();
      await insertLinkedRunFixture(database, status);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;

      await recordCanonicalSessionRunFailure(bindings, {
        error: PROVISION_ERROR,
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        source: "api",
      });

      expect(await readFailureEvents(database)).toEqual([]);
    }
  });
});
