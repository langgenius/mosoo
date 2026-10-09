import { describe, expect, test } from "bun:test";

import { setSessionRunStatus } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  insertSessionRunFixture,
} from "./helpers/public-api-http-test-fixture";

const ATOMIC_TERMINAL_PROJECTION_RUN_ID = "01J0000000000000000000R001";
const DUPLICATE_RUN_ID = "01J0000000000000000000R002";
const STALE_SESSION_RUN_ID = "01J0000000000000000000R003";
const STALE_TERMINAL_PROJECTION_RUN_ID = "01J0000000000000000000R004";
const TERMINAL_RUN_ID = "01J0000000000000000000R005";
const TERMINAL_LOG_RUN_ID = "01J0000000000000000000R006";
const IDLE_PROJECTION_RUN_ID = "01J0000000000000000000R007";

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
  test("replays the original terminal observation until its durable event exists", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, { id: TERMINAL_LOG_RUN_ID, status: "running" });

    const originalConsoleInfo = console.info;
    const output: string[] = [];
    console.info = (...values: unknown[]) => output.push(values.map(String).join(" "));

    try {
      await setSessionRunStatus(database, {
        runId: TERMINAL_LOG_RUN_ID,
        source: "driver",
        status: "completed",
      });
      await setSessionRunStatus(database, {
        runId: TERMINAL_LOG_RUN_ID,
        source: "driver",
        status: "completed",
      });
    } finally {
      console.info = originalConsoleInfo;
    }

    const terminalEntries = output
      .map((entry) => JSON.parse(entry))
      .filter((entry) => entry.message === "session.run.terminal");

    expect(terminalEntries).toHaveLength(2);
    expect(terminalEntries[1]).toEqual(terminalEntries[0]);
    expect(terminalEntries[0]).toMatchObject({
      level: "info",
      metadata: {
        errorCode: null,
        runId: TERMINAL_LOG_RUN_ID,
        runtimeId: "openai-runtime",
        sessionType: "ui",
        source: "driver",
        status: "completed",
        traceId: `trace-${TERMINAL_LOG_RUN_ID}`,
        trigger: "user_prompt",
      },
      namespace: "api",
    });
    expect(terminalEntries[0]?.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("does not let a stale terminal event revive or overwrite a completed run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, { id: TERMINAL_RUN_ID, status: "running" });

    await setSessionRunStatus(database, {
      runId: TERMINAL_RUN_ID,
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
      runId: TERMINAL_RUN_ID,
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
      .bind(TERMINAL_RUN_ID)
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
    await insertSessionRunFixture(database, { id: DUPLICATE_RUN_ID, status: "running" });

    await setSessionRunStatus(database, {
      runId: DUPLICATE_RUN_ID,
      source: "driver",
      status: "running",
    });

    const row = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(DUPLICATE_RUN_ID)
      .first<{ status: string }>();
    expect(row).toEqual({ status: "running" });
  });

  test("session run projections expose the session as idle after completion", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, { id: IDLE_PROJECTION_RUN_ID, status: "running" });

    await setSessionRunStatus(database, {
      runId: IDLE_PROJECTION_RUN_ID,
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
    await insertSessionRunFixture(database, {
      id: ATOMIC_TERMINAL_PROJECTION_RUN_ID,
      status: "running",
    });

    await expect(
      setSessionRunStatus(failSessionProjectionStatementInBatch(database), {
        runId: ATOMIC_TERMINAL_PROJECTION_RUN_ID,
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
      runId: ATOMIC_TERMINAL_PROJECTION_RUN_ID,
      source: "driver",
      status: "completed",
    });

    const completed = await database
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

    expect(completed).toEqual({
      run_status: "completed",
      session_status: "IDLE",
    });
  });

  test("does not project a stale terminal transition onto a newer Run state", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, {
      id: STALE_TERMINAL_PROJECTION_RUN_ID,
      status: "booting",
    });

    const outcome = await setSessionRunStatus(
      advanceRunBeforeBatch(database, {
        runId: STALE_TERMINAL_PROJECTION_RUN_ID,
      }),
      {
        error: {
          code: "runtime.stale_terminal",
          details: {},
          message: "The stale terminal transition must not update the Session.",
          retryable: false,
        },
        runId: STALE_TERMINAL_PROJECTION_RUN_ID,
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
    await insertSessionRunFixture(database, { id: STALE_SESSION_RUN_ID, status: "running" });
    await database
      .prepare("UPDATE session SET status = ? WHERE id = ?")
      .bind("TERMINATED", "01J0000000000000000000000B")
      .run();

    await setSessionRunStatus(database, {
      error: {
        code: "runtime.stale_session",
        details: {},
        message: "Stale session.",
        retryable: false,
      },
      preserveSessionLifecycle: true,
      runId: STALE_SESSION_RUN_ID,
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
