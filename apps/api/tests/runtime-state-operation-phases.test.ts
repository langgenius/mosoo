import { describe, expect, test } from "bun:test";

import { createSessionRunTerminalSourceId } from "@mosoo/runtime-events";

import {
  completeRuntimeStateOperationPhase,
  failRuntimeStateOperationPhase,
  startRuntimeStateOperationPhase,
} from "../src/modules/runtime/application/runtime-state-operation-phases";
import type { RuntimeSessionTarget } from "../src/modules/runtime/application/runtime-state-operation-target-store";
import { recordCanonicalSessionRunTerminal } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertNonOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

function createRuntimeTarget(
  input: Omit<
    RuntimeSessionTarget,
    | "sessionRuntimeEventSeqCursor"
    | "sessionStatusOperationId"
    | "sessionStatusSeq"
    | "sessionUpdatedAt"
  > & {
    readonly sessionRuntimeEventSeqCursor?: number;
    readonly sessionStatusOperationId?: string | null;
    readonly sessionStatusSeq?: number;
    readonly sessionUpdatedAt?: number;
  },
): RuntimeSessionTarget {
  return {
    ...input,
    sessionRuntimeEventSeqCursor: input.sessionRuntimeEventSeqCursor ?? 0,
    sessionStatusOperationId: input.sessionStatusOperationId ?? null,
    sessionStatusSeq: input.sessionStatusSeq ?? 0,
    sessionUpdatedAt: input.sessionUpdatedAt ?? nowMsForTest(),
  };
}

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
      "01J0000000000000000000000N",
      "01J0000000000000000000000B",
      "01J00000000000000000000009",
      "01J00000000000000000000002",
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-operation",
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
    .bind("01J0000000000000000000000N", "RUNNING", "01J0000000000000000000000B")
    .run();
}

describe("runtime state operation phases", () => {
  test("complete cancels the run that was active before the session becomes ready", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const phase = await startRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      targetVersion: null,
      targets: [
        createRuntimeTarget({
          agentId: "01J00000000000000000000009",
          creatorAccountId: "01J00000000000000000000002",
          lastRunId: "01J0000000000000000000000N",
          sandboxId: "01J0000000000000000000000D",
          sessionId: "01J0000000000000000000000B",
          sessionStatus: "RUNNING",
        }),
      ],
    });

    await completeRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      phase,
    });

    const row = await database
      .prepare(
        `
          SELECT session.status AS session_status,
                 session.status_operation_id AS session_status_operation_id,
                 session.status_seq AS session_status_seq,
                 session_run.error_code AS run_error_code,
                 session_run.status AS run_status
          FROM session
          INNER JOIN session_run ON session_run.id = session.last_run_id
          WHERE session.id = ?
        `,
      )
      .bind("01J0000000000000000000000B")
      .first<{
        run_error_code: string | null;
        run_status: string;
        session_status: string;
        session_status_operation_id: string | null;
        session_status_seq: number;
      }>();

    expect(row).toEqual({
      run_error_code: "agent.runtime_state_operation",
      run_status: "cancelled",
      session_status: "IDLE",
      session_status_operation_id: null,
      session_status_seq: 3,
    });
  });

  test("complete writes the run cancellation snapshot when driver stop already cancelled the run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const phase = await startRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      targetVersion: null,
      targets: [
        createRuntimeTarget({
          agentId: "01J00000000000000000000009",
          creatorAccountId: "01J00000000000000000000002",
          lastRunId: "01J0000000000000000000000N",
          sandboxId: "01J0000000000000000000000D",
          sessionId: "01J0000000000000000000000B",
          sessionStatus: "RUNNING",
        }),
      ],
    });

    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      error: null,
      expectedSessionOperationId: phase.operationId,
      runId: "01J0000000000000000000000N",
      sessionId: "01J0000000000000000000000B",
      source: "driver",
      status: "cancelled",
    });

    await completeRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      phase,
    });

    const event = await database
      .prepare(
        `
          SELECT source_event_id
          FROM session_event
          WHERE session_id = ? AND source_event_id = ?
        `,
      )
      .bind(
        "01J0000000000000000000000B",
        createSessionRunTerminalSourceId("01J0000000000000000000000N", "run.cancelled"),
      )
      .first<{ source_event_id: string }>();

    expect(event?.source_event_id).toBe(
      createSessionRunTerminalSourceId("01J0000000000000000000000N", "run.cancelled"),
    );

    const row = await database
      .prepare(
        `
          SELECT session.status AS session_status,
                 session.status_operation_id AS session_status_operation_id,
                 session_run.status AS run_status
          FROM session
          INNER JOIN session_run ON session_run.id = session.last_run_id
          WHERE session.id = ?
        `,
      )
      .bind("01J0000000000000000000000B")
      .first<{
        run_status: string;
        session_status: string;
        session_status_operation_id: string | null;
      }>();

    expect(row).toEqual({
      run_status: "cancelled",
      session_status: "IDLE",
      session_status_operation_id: null,
    });
  });

  test("failure recovery writes the run cancellation snapshot when stop already cancelled the run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const phase = await startRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      targetVersion: null,
      targets: [
        createRuntimeTarget({
          agentId: "01J00000000000000000000009",
          creatorAccountId: "01J00000000000000000000002",
          lastRunId: "01J0000000000000000000000N",
          sandboxId: "01J0000000000000000000000D",
          sessionId: "01J0000000000000000000000B",
          sessionStatus: "RUNNING",
        }),
      ],
    });

    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      error: null,
      expectedSessionOperationId: phase.operationId,
      runId: "01J0000000000000000000000N",
      sessionId: "01J0000000000000000000000B",
      source: "driver",
      status: "cancelled",
    });

    await failRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      phase,
    });

    const event = await database
      .prepare(
        `
          SELECT source_event_id
          FROM session_event
          WHERE session_id = ? AND source_event_id = ?
        `,
      )
      .bind(
        "01J0000000000000000000000B",
        createSessionRunTerminalSourceId("01J0000000000000000000000N", "run.cancelled"),
      )
      .first<{ source_event_id: string }>();

    expect(event?.source_event_id).toBe(
      createSessionRunTerminalSourceId("01J0000000000000000000000N", "run.cancelled"),
    );
  });

  test("complete adopts a canonical Driver failure without rewriting its outcome", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const phase = await startRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      targetVersion: null,
      targets: [
        createRuntimeTarget({
          agentId: "01J00000000000000000000009",
          creatorAccountId: "01J00000000000000000000002",
          lastRunId: "01J0000000000000000000000N",
          sandboxId: "01J0000000000000000000000D",
          sessionId: "01J0000000000000000000000B",
          sessionStatus: "RUNNING",
        }),
      ],
    });

    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      error: {
        code: "driver.failed",
        details: {},
        message: "Driver failed while stopping.",
        retryable: true,
      },
      expectedSessionOperationId: phase.operationId,
      runId: "01J0000000000000000000000N",
      sessionId: "01J0000000000000000000000B",
      source: "driver",
      status: "failed",
    });

    await completeRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      phase,
    });

    const event = await database
      .prepare(
        `
          SELECT source_event_id
          FROM session_event
          WHERE session_id = ? AND source_event_id = ?
        `,
      )
      .bind(
        "01J0000000000000000000000B",
        createSessionRunTerminalSourceId("01J0000000000000000000000N", "run.cancelled"),
      )
      .first<{ source_event_id: string }>();

    expect(event).toBeNull();
    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind("01J0000000000000000000000N")
      .first<{ error_code: string | null; status: string }>();
    expect(run).toEqual({ error_code: "driver.failed", status: "failed" });
  });

  test("start ignores stale targets that changed after scope resolution", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);

    await database
      .prepare(
        `
          UPDATE session
          SET last_run_id = ?, status = ?, status_seq = ?
          WHERE id = ?
        `,
      )
      .bind("01J0000000000000000000000Q", "RUNNING", 1, "01J0000000000000000000000B")
      .run();

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const phase = await startRuntimeStateOperationPhase(bindings, {
      agentId: "01J00000000000000000000009",
      operation: "restartDriver",
      targetVersion: null,
      targets: [
        createRuntimeTarget({
          agentId: "01J00000000000000000000009",
          creatorAccountId: "01J00000000000000000000002",
          lastRunId: null,
          sandboxId: "01J0000000000000000000000D",
          sessionId: "01J0000000000000000000000B",
          sessionStatus: "IDLE",
        }),
      ],
    });

    expect(phase.reschedulingTargets).toEqual([]);
    const row = await database
      .prepare(
        "SELECT last_run_id, status, status_operation_id, status_seq FROM session WHERE id = ?",
      )
      .bind("01J0000000000000000000000B")
      .first<{
        last_run_id: string | null;
        status: string;
        status_operation_id: string | null;
        status_seq: number;
      }>();

    expect(row).toEqual({
      last_run_id: "01J0000000000000000000000Q",
      status: "RUNNING",
      status_operation_id: null,
      status_seq: 1,
    });
  });
});
