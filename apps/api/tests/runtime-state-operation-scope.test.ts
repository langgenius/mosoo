import { describe, expect, test } from "bun:test";

import {
  resolveRuntimeOperationScope,
  selectAdmittedRuntimeOperationSubjects,
} from "../src/modules/runtime/application/runtime-state-operation-subjects";
import type { RuntimeSessionTarget } from "../src/modules/runtime/application/runtime-state-operation-target-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createRuntimeOperationScopeDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      creator_account_id text NOT NULL,
      last_run_id text,
      status text NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      archived_at integer
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      subject_kind text NOT NULL
    );

    CREATE TABLE sandbox_session (
      session_id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL
    );

    INSERT INTO sandbox (id, subject_kind)
    VALUES
      ('01J0000000000000000000000D', 'session'),
      ('sandbox-2', 'session');

    INSERT INTO session (
      id,
      agent_id,
      creator_account_id,
      last_run_id,
      status,
      archived_at
    )
    VALUES
      ('session-1', '01J00000000000000000000009', 'creator-1', 'run-1', 'RUNNING', NULL),
      ('session-2', '01J00000000000000000000009', 'creator-1', NULL, 'IDLE', NULL),
      ('session-archived', '01J00000000000000000000009', 'creator-1', NULL, 'RUNNING', 1),
      ('session-other-agent', 'agent-2', 'creator-2', NULL, 'RUNNING', NULL);

    INSERT INTO sandbox_session (session_id, sandbox_id, status)
    VALUES
      ('session-1', '01J0000000000000000000000D', 'active'),
      ('session-2', '01J0000000000000000000000D', 'active'),
      ('session-archived', '01J0000000000000000000000D', 'active'),
      ('session-other-agent', 'sandbox-2', 'active');
  `);

  return database;
}

describe("runtime state operation scope", () => {
  test("resolves leased runtime subjects and targets", async () => {
    const database = createRuntimeOperationScopeDatabase();

    const scope = await resolveRuntimeOperationScope(database, {
      id: "01J00000000000000000000009",
      kind: "cattle",
    });

    expect(scope.subjects.map((subject) => subject.runtimeSubjectId)).toEqual([
      "01J0000000000000000000000D",
    ]);
    expect(scope.targets.map((target) => target.sessionId).toSorted()).toEqual([
      "session-1",
      "session-2",
    ]);
    expect(scope.targets.find((target) => target.sessionId === "session-1")).toMatchObject({
      agentId: "01J00000000000000000000009",
      creatorAccountId: "creator-1",
      lastRunId: "run-1",
      sandboxId: "01J0000000000000000000000D",
      sessionStatus: "RUNNING",
    });
  });

  test("selects session-scoped subjects only from admitted target snapshots", () => {
    const targets = [
      createRuntimeTarget({ sandboxId: "01J0000000000000000000000D", sessionId: "session-1" }),
      createRuntimeTarget({ sandboxId: "sandbox-2", sessionId: "session-2" }),
    ];

    expect(
      selectAdmittedRuntimeOperationSubjects({
        admittedTargets: [targets[0]],
        scope: "session",
        subjects: [
          { runtimeSubjectId: "01J0000000000000000000000D", targets: [] },
          { runtimeSubjectId: "sandbox-2", targets: [] },
        ],
        targets,
      }),
    ).toEqual([{ runtimeSubjectId: "01J0000000000000000000000D", targets: [targets[0]] }]);
  });

  test("rejects partially admitted stable subject operations", () => {
    const targets = [
      createRuntimeTarget({ sandboxId: "01J0000000000000000000000D", sessionId: "session-1" }),
      createRuntimeTarget({ sandboxId: "01J0000000000000000000000D", sessionId: "session-2" }),
    ];

    expect(() =>
      selectAdmittedRuntimeOperationSubjects({
        admittedTargets: [targets[0]],
        scope: "agent",
        subjects: [{ runtimeSubjectId: "01J0000000000000000000000D", targets: [] }],
        targets,
      }),
    ).toThrow("Runtime operation target admission changed concurrently.");
  });
});

function createRuntimeTarget(input: {
  readonly sandboxId: string;
  readonly sessionId: string;
}): RuntimeSessionTarget {
  return {
    agentId: "01J00000000000000000000009",
    creatorAccountId: "creator-1",
    lastRunId: null,
    sandboxId: input.sandboxId,
    sessionId: input.sessionId,
    sessionStatus: "IDLE",
    sessionStatusOperationId: null,
    sessionStatusSeq: 0,
  };
}
