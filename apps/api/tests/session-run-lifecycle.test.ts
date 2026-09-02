import { describe, expect, test } from "bun:test";

import {
  createSessionRunRecordIfSessionIdle,
  setSessionRunStatus,
} from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const SESSION_ID = PUBLIC_API_TEST_IDS.nonOwnerSession;
const RUN_ID = "01J0000000000000000000000T";

async function insertRunningSessionRun(database: D1Database): Promise<void> {
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
      RUN_ID,
      SESSION_ID,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.nonOwnerAccount,
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      `trace-${RUN_ID}`,
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = 'RUNNING', updated_at = 1 WHERE id = ?")
    .bind(RUN_ID, SESSION_ID)
    .run();
}

function createRunInput() {
  return {
    agentId: PUBLIC_API_TEST_IDS.agent,
    createdBy: PUBLIC_API_TEST_IDS.nonOwnerAccount,
    model: "gpt-5.4",
    provider: "openai",
    runtimeId: "openai-runtime",
    sessionId: SESSION_ID,
    status: "queued" as const,
    trigger: "user_prompt" as const,
  };
}

describe("Session Run non-terminal lifecycle writer", () => {
  test("fails closed when an untyped caller attempts a terminal transition", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    await expect(
      setSessionRunStatus(database, {
        runId: RUN_ID,
        source: "driver",
        status: "completed",
      } as never),
    ).rejects.toThrow("atomic terminal projection");

    expect(
      await database
        .prepare("SELECT status, status_seq FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).toEqual({ status: "running", status_seq: 0 });
  });

  test("keeps duplicate active transitions idempotent", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    const outcome = await setSessionRunStatus(database, {
      runId: RUN_ID,
      source: "driver",
      status: "running",
    });

    expect(outcome.kind).toBe("duplicate");
    expect(
      await database
        .prepare("SELECT status, status_seq FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).toEqual({ status: "running", status_seq: 0 });
  });

  test("does not advance a current Run after its Session is terminated", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    await database
      .prepare("UPDATE session_run SET status = 'booting' WHERE id = ?")
      .bind(RUN_ID)
      .run();
    await database
      .prepare("UPDATE session SET status = 'TERMINATED' WHERE id = ?")
      .bind(SESSION_ID)
      .run();

    const outcome = await setSessionRunStatus(database, {
      runId: RUN_ID,
      source: "driver",
      status: "running",
    });

    expect(outcome.kind).toBe("stale");
    expect(
      await database
        .prepare(
          `SELECT session.status AS session_status,
                  session.status_seq AS session_status_seq,
                  session_run.status AS run_status,
                  session_run.status_seq AS run_status_seq
             FROM session
             JOIN session_run ON session_run.id = session.last_run_id
            WHERE session.id = ?`,
        )
        .bind(SESSION_ID)
        .first(),
    ).toEqual({
      run_status: "booting",
      run_status_seq: 0,
      session_status: "TERMINATED",
      session_status_seq: 0,
    });
  });

  test("rejects admission after the Session is terminated", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await database
      .prepare("UPDATE session SET status = 'TERMINATED' WHERE id = ?")
      .bind(SESSION_ID)
      .run();

    await expect(createSessionRunRecordIfSessionIdle(database, createRunInput())).rejects.toThrow();
  });

  test("rejects admission while another operation owns the Session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await database
      .prepare("UPDATE session SET status = 'RESCHEDULING', status_operation_id = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.operation, SESSION_ID)
      .run();

    await expect(createSessionRunRecordIfSessionIdle(database, createRunInput())).rejects.toThrow();
  });
});
