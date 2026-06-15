import { describe, expect, test } from "bun:test";

import { toRuntimeDiagnosticBaseValue } from "../src/modules/runtime/application/runtime-diagnostic-events";
import { buildRuntimeStateOperationEvents } from "../src/modules/runtime/application/runtime-state-operation-events";
import {
  appendRuntimeDriverRestartAttemptedEvents,
  appendRuntimeSubjectTerminatedEvents,
  broadcastRuntimeOperationEvent,
  writeRuntimeOperationInterruptedSnapshots,
  writeRuntimeOperationTimedOutSnapshots,
} from "../src/modules/runtime/application/runtime-state-operation-target-events";
import type { RuntimeSessionTarget } from "../src/modules/runtime/application/runtime-state-operation-target-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertNonOwnerSession,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";

async function insertRunningSessionRun(
  database: D1Database,
  input: {
    accountId: string;
    runId: string;
    sessionId: string;
  } = {
    accountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
    runId: PUBLIC_API_TEST_IDS.run,
    sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
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
      input.sessionId,
      PUBLIC_API_TEST_IDS.agent,
      input.accountId,
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
    .bind(input.runId, "RUNNING", input.sessionId)
    .run();
}

function createRuntimeDiagnosticTargets(): RuntimeSessionTarget[] {
  return [
    createRuntimeTarget({
      agentId: PUBLIC_API_TEST_IDS.agent,
      creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
      lastRunId: null,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      sessionStatus: "IDLE",
    }),
    createRuntimeTarget({
      agentId: PUBLIC_API_TEST_IDS.agent,
      creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      lastRunId: null,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      sessionStatus: "IDLE",
    }),
    createRuntimeTarget({
      agentId: null,
      creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
      lastRunId: null,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: "session-without-agent",
      sessionStatus: "IDLE",
    }),
  ];
}

async function insertLiveDriverInstance(
  database: D1Database,
  input: {
    driverInstanceId: string;
    sessionId: string;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          sandbox_id,
          sandbox_session_id,
          runtime,
          protocol,
          protocol_version,
          status,
          boot_token_hash,
          boot_token_expires_at,
          heartbeat_count,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.driverInstanceId,
      PUBLIC_API_TEST_IDS.sandbox,
      input.sessionId,
      "cloudflare-container",
      "driver-ws",
      1,
      "ready",
      new Uint8Array([1, 2, 3]),
      10_000,
      0,
      20_000,
      1,
      1,
    )
    .run();
}

function createRuntimeTarget(
  input: Omit<RuntimeSessionTarget, "sessionStatusOperationId" | "sessionStatusSeq">,
): RuntimeSessionTarget {
  return {
    ...input,
    sessionStatusOperationId: null,
    sessionStatusSeq: 0,
  };
}

function createExistingRuntimeDiagnosticTargets(): RuntimeSessionTarget[] {
  return createRuntimeDiagnosticTargets().filter((target) => target.agentId !== null);
}

describe("runtime state operation target events", () => {
  test("operation events carry the target deployment version", () => {
    const events = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "2026-05-08T00:00:01.000Z",
      startedAt: "2026-05-08T00:00:00.000Z",
      targetVersion: {
        id: PUBLIC_API_TEST_IDS.deployment,
        versionNumber: 1,
      },
    });

    expect(events).toEqual([
      {
        agentId: PUBLIC_API_TEST_IDS.agent,
        deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
        deploymentVersionNumber: 1,
        observedAt: "2026-05-08T00:00:00.000Z",
        operation: "restartDriver",
        status: "updating",
      },
      {
        agentId: PUBLIC_API_TEST_IDS.agent,
        deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
        deploymentVersionNumber: 1,
        observedAt: "2026-05-08T00:00:01.000Z",
        operation: "restartDriver",
        status: "ready",
      },
    ]);
  });

  test("diagnostic base values carry the target deployment version", () => {
    expect(
      toRuntimeDiagnosticBaseValue({
        agentId: PUBLIC_API_TEST_IDS.agent,
        deploymentVersion: {
          id: PUBLIC_API_TEST_IDS.deployment,
          versionNumber: 1,
        },
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      }),
    ).toEqual({
      agentId: PUBLIC_API_TEST_IDS.agent,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
    });
  });

  test("interrupt snapshots cancel running runs with an operation error", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const targets: RuntimeSessionTarget[] = [
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
        lastRunId: PUBLIC_API_TEST_IDS.run,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
        sessionStatus: "RUNNING",
      }),
    ];

    await writeRuntimeOperationInterruptedSnapshots(bindings, {
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets,
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ error_code: string | null; status: string }>();
    expect(run).toEqual({
      error_code: "agent.runtime_state_operation",
      status: "cancelled",
    });
  });

  test("interrupt snapshots persist events for each target session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    await insertRunningSessionRun(database);
    await insertRunningSessionRun(database, {
      accountId: PUBLIC_API_TEST_IDS.ownerAccount,
      runId: PUBLIC_API_TEST_IDS.runAlt,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const targets: RuntimeSessionTarget[] = [
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
        lastRunId: PUBLIC_API_TEST_IDS.run,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
        sessionStatus: "RUNNING",
      }),
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
        lastRunId: PUBLIC_API_TEST_IDS.runAlt,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        sessionStatus: "RUNNING",
      }),
    ];

    await writeRuntimeOperationInterruptedSnapshots(bindings, {
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets,
    });

    const runs = await database
      .prepare(
        `
          SELECT id, status
          FROM session_run
          ORDER BY id
        `,
      )
      .all<{ id: string; status: string }>();
    expect(runs.results).toEqual([
      { id: PUBLIC_API_TEST_IDS.run, status: "cancelled" },
      { id: PUBLIC_API_TEST_IDS.runAlt, status: "cancelled" },
    ]);
    const events = await database
      .prepare(
        `
          SELECT seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{ seq: number; session_id: string }>();
    expect(
      events.results.map((event) => ({ seq: event.seq, sessionId: event.session_id })),
    ).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
  });

  test("terminated subject events are written for target sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await appendRuntimeSubjectTerminatedEvents(bindings, {
      reason: "runtime_state_operation.recreate",
      runtimeSubjectId: PUBLIC_API_TEST_IDS.sandbox,
      targets: createRuntimeDiagnosticTargets(),
    });

    const rows = await database
      .prepare(
        `
          SELECT event_type, seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{
        event_type: string;
        seq: number;
        session_id: string;
      }>();
    expect(rows.results.map((row) => ({ seq: row.seq, sessionId: row.session_id }))).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
    expect(rows.results.every((row) => row.event_type === "runtime.sandbox.updated")).toBe(true);
  });

  test("driver restart attempted events are written for target sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    await insertLiveDriverInstance(database, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverNonOwner,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
    });
    await insertLiveDriverInstance(database, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await appendRuntimeDriverRestartAttemptedEvents(bindings, {
      targetVersion: null,
      targets: createRuntimeDiagnosticTargets(),
    });

    const rows = await database
      .prepare(
        `
          SELECT event_type, seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{
        event_type: string;
        seq: number;
        session_id: string;
      }>();
    expect(rows.results.map((row) => ({ seq: row.seq, sessionId: row.session_id }))).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
    expect(rows.results.every((row) => row.event_type === "runtime.driver.updated")).toBe(true);
  });

  test("runtime operation broadcasts events across target sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const [event] = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "2026-05-08T00:00:01.000Z",
      startedAt: "2026-05-08T00:00:00.000Z",
    });

    await broadcastRuntimeOperationEvent(bindings, {
      event,
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets: createExistingRuntimeDiagnosticTargets(),
    });

    const rows = await database
      .prepare(
        `
          SELECT event_type, seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{
        event_type: string;
        seq: number;
        session_id: string;
      }>();
    expect(rows.results.map((row) => ({ seq: row.seq, sessionId: row.session_id }))).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
    expect(rows.results.every((row) => row.event_type === "agent.task.updated")).toBe(true);
  });

  test("timed out snapshots cancel running runs and persist target events", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const targets: RuntimeSessionTarget[] = [
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
        lastRunId: PUBLIC_API_TEST_IDS.run,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
        sessionStatus: "RUNNING",
      }),
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
        lastRunId: null,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        sessionStatus: "IDLE",
      }),
    ];

    await writeRuntimeOperationTimedOutSnapshots(bindings, {
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets,
    });

    const run = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ status: string }>();
    expect(run).toEqual({ status: "cancelled" });
    const events = await database
      .prepare(
        `
          SELECT seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{ seq: number; session_id: string }>();
    expect(
      events.results.map((event) => ({ seq: event.seq, sessionId: event.session_id })),
    ).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
  });
});
