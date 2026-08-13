import { describe, expect, test } from "bun:test";

import { updateSessionLastRun } from "../src/modules/runtime/infrastructure/session-runs/session-run-session.repository";
import {
  createSessionRunRecordIfSessionIdle,
  setSessionRunStatus,
} from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
} from "./helpers/public-api-http-test-fixture";

async function insertSessionRun(
  database: D1Database,
  input: {
    runId: string;
    sessionId?: string;
    status: string;
  },
): Promise<void> {
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
      input.runId,
      input.sessionId ?? "01J0000000000000000000000B",
      "01J00000000000000000000009",
      "01J00000000000000000000002",
      "user_prompt",
      input.status,
      "openai",
      "gpt-5.4",
      "openai-runtime",
      `trace-${input.runId}`,
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ?, updated_at = ? WHERE id = ?")
    .bind(
      input.runId,
      input.status === "completed" ? "IDLE" : "RUNNING",
      1,
      "01J0000000000000000000000B",
    )
    .run();
}

function failSessionProjectionStatementInBatch(database: D1Database): D1Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const firstStatement = statements[0];

          if (firstStatement === undefined) {
            throw new Error("Expected a Run status statement in the D1 batch.");
          }

          const failingStatement = new Proxy(target.prepare("SELECT 1"), {
            get(statement, statementProperty, statementReceiver) {
              if (statementProperty === "run") {
                return async () => {
                  throw new Error("injected Session lifecycle projection failure");
                };
              }

              const value = Reflect.get(statement, statementProperty, statementReceiver);
              return typeof value === "function" ? value.bind(statement) : value;
            },
          });

          return target.batch([firstStatement, failingStatement]);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function advanceRunBeforeBatch(
  database: D1Database,
  input: {
    readonly runId: string;
  },
): D1Database {
  let advanced = false;

  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (!advanced) {
            advanced = true;
            await setSessionRunStatus(target, {
              runId: input.runId,
              source: "driver",
              status: "running",
            });
          }

          return target.batch(statements);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("session run lifecycle", () => {
  test("emits one structured business log for an applied terminal transition", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRun(database, {
      runId: "run-terminal-log",
      status: "running",
    });

    const originalConsoleInfo = console.info;
    const output: string[] = [];
    console.info = (...values: unknown[]) => output.push(values.map(String).join(" "));

    try {
      await setSessionRunStatus(database, {
        runId: "run-terminal-log",
        source: "driver",
        status: "completed",
      });
      await setSessionRunStatus(database, {
        runId: "run-terminal-log",
        source: "driver",
        status: "completed",
      });
    } finally {
      console.info = originalConsoleInfo;
    }

    const terminalEntries = output
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.message === "session.run.terminal");

    expect(terminalEntries).toHaveLength(1);
    expect(terminalEntries[0]).toMatchObject({
      level: "info",
      metadata: {
        errorCode: null,
        runId: "run-terminal-log",
        runtimeId: "openai-runtime",
        sessionType: "api_channel",
        source: "driver",
        status: "completed",
        traceId: "trace-run-terminal-log",
        trigger: "user_prompt",
      },
      namespace: "api",
    });
    expect(terminalEntries[0]?.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("does not let a stale terminal event revive or overwrite a completed run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRun(database, {
      runId: "run-terminal",
      status: "running",
    });

    await setSessionRunStatus(database, {
      runId: "run-terminal",
      source: "driver",
      status: "completed",
    });
    await setSessionRunStatus(database, {
      error: {
        code: "runtime.late_failure",
        details: {},
        message: "Late failure.",
        retryable: false,
      },
      runId: "run-terminal",
      source: "driver",
      status: "failed",
    });

    const row = await database
      .prepare(
        `
          SELECT error_code, status
          FROM session_run
          WHERE id = ?
        `,
      )
      .bind("run-terminal")
      .first<{
        error_code: string | null;
        status: string;
      }>();
    expect(row).toEqual({
      error_code: null,
      status: "completed",
    });
  });

  test("leaves duplicate transitions idempotent", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRun(database, {
      runId: "run-duplicate",
      status: "running",
    });

    await setSessionRunStatus(database, {
      runId: "run-duplicate",
      source: "driver",
      status: "running",
    });

    const row = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind("run-duplicate")
      .first<{ status: string }>();
    expect(row).toEqual({ status: "running" });
  });

  test("rejects new runs after the owning session is terminated", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await database
      .prepare("UPDATE session SET status = ? WHERE id = ?")
      .bind("TERMINATED", "01J0000000000000000000000B")
      .run();

    await expect(
      createSessionRunRecordIfSessionIdle(database, {
        agentId: "01J00000000000000000000009",
        createdBy: "01J00000000000000000000002",
        model: "gpt-5.4",
        provider: "openai",
        runtimeId: "openai-runtime",
        sessionId: "01J0000000000000000000000B",
        status: "queued",
        trigger: "user_prompt",
      }),
    ).rejects.toThrow();
  });

  test("rejects new runs while a runtime operation owns the session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await database
      .prepare(
        `
          UPDATE session
          SET status = ?, status_operation_id = ?
          WHERE id = ?
        `,
      )
      .bind("RESCHEDULING", "01J0000000000000000000000R", "01J0000000000000000000000B")
      .run();

    await expect(
      createSessionRunRecordIfSessionIdle(database, {
        agentId: "01J00000000000000000000009",
        createdBy: "01J00000000000000000000002",
        model: "gpt-5.4",
        provider: "openai",
        runtimeId: "openai-runtime",
        sessionId: "01J0000000000000000000000B",
        status: "queued",
        trigger: "user_prompt",
      }),
    ).rejects.toThrow();
  });

  test("session run projections expose the session as idle after completion", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    const run = await createSessionRunRecordIfSessionIdle(database, {
      agentId: "01J00000000000000000000009",
      createdBy: "01J00000000000000000000002",
      model: "gpt-5.4",
      provider: "openai",
      runtimeId: "openai-runtime",
      sessionId: "01J0000000000000000000000B",
      status: "running",
      trigger: "user_prompt",
    });
    if (run.createdRun === null) {
      throw new Error("Expected session run creation.");
    }

    await setSessionRunStatus(database, {
      runId: run.createdRun.id,
      source: "driver",
      status: "completed",
    });

    const row = await database
      .prepare(
        `
          SELECT status, status_operation_id
          FROM session
          WHERE id = ?
        `,
      )
      .bind("01J0000000000000000000000B")
      .first<{
        status: string;
        status_operation_id: string | null;
      }>();

    expect(row).toEqual({
      status: "IDLE",
      status_operation_id: null,
    });
  });

  test("rolls back a terminal Run transition when its Session projection fails", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRun(database, {
      runId: "run-atomic-terminal-projection",
      status: "running",
    });

    await expect(
      setSessionRunStatus(failSessionProjectionStatementInBatch(database), {
        runId: "run-atomic-terminal-projection",
        source: "driver",
        status: "completed",
      }),
    ).rejects.toThrow("injected Session lifecycle projection failure");

    const interrupted = await database
      .prepare(
        `
          SELECT session.status AS session_status, session_run.status AS run_status
          FROM session
          INNER JOIN session_run ON session_run.id = session.last_run_id
          WHERE session.id = ?
        `,
      )
      .bind("01J0000000000000000000000B")
      .first<{ run_status: string; session_status: string }>();

    expect(interrupted).toEqual({
      run_status: "running",
      session_status: "RUNNING",
    });

    await setSessionRunStatus(database, {
      runId: "run-atomic-terminal-projection",
      source: "driver",
      status: "completed",
    });

    const admitted = await createSessionRunRecordIfSessionIdle(database, {
      agentId: "01J00000000000000000000009",
      createdBy: "01J00000000000000000000002",
      model: "gpt-5.4",
      provider: "openai",
      runtimeId: "openai-runtime",
      sessionId: "01J0000000000000000000000B",
      status: "queued",
      trigger: "user_prompt",
    });

    expect(admitted.createdRun).not.toBeNull();
  });

  test("does not project a stale terminal transition onto a newer Run state", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRun(database, {
      runId: "run-stale-terminal-projection",
      status: "booting",
    });

    const outcome = await setSessionRunStatus(
      advanceRunBeforeBatch(database, {
        runId: "run-stale-terminal-projection",
      }),
      {
        error: {
          code: "runtime.stale_terminal",
          details: {},
          message: "The stale terminal transition must not update the Session.",
          retryable: false,
        },
        runId: "run-stale-terminal-projection",
        source: "driver",
        status: "failed",
      },
    );

    expect(outcome).toMatchObject({
      kind: "stale",
      reason: "concurrent_transition",
    });
    const current = await database
      .prepare(
        `
          SELECT session.status AS session_status, session_run.status AS run_status
          FROM session
          INNER JOIN session_run ON session_run.id = session.last_run_id
          WHERE session.id = ?
        `,
      )
      .bind("01J0000000000000000000000B")
      .first<{ run_status: string; session_status: string }>();

    expect(current).toEqual({
      run_status: "running",
      session_status: "RUNNING",
    });
  });

  test("does not revive terminated sessions from stale run projections", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRun(database, {
      runId: "run-stale-session",
      status: "running",
    });
    await database
      .prepare("UPDATE session SET status = ? WHERE id = ?")
      .bind("TERMINATED", "01J0000000000000000000000B")
      .run();

    await expect(
      updateSessionLastRun(database, {
        model: "gpt-5.4",
        provider: "openai",
        runId: "run-stale-session",
        sessionId: "01J0000000000000000000000B",
        timestampMs: 2,
      }),
    ).resolves.toBe(false);
    await setSessionRunStatus(database, {
      error: {
        code: "runtime.stale_session",
        details: {},
        message: "Stale session.",
        retryable: false,
      },
      preserveSessionLifecycle: true,
      runId: "run-stale-session",
      source: "maintenance",
      status: "failed",
    });

    const row = await database
      .prepare(
        `
          SELECT session.status AS session_status, session_run.status AS run_status
          FROM session
          INNER JOIN session_run ON session_run.id = session.last_run_id
          WHERE session.id = ?
        `,
      )
      .bind("01J0000000000000000000000B")
      .first<{ run_status: string; session_status: string }>();

    expect(row).toEqual({
      run_status: "failed",
      session_status: "TERMINATED",
    });
  });
});
