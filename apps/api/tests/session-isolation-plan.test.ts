import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  driverInstancesTable,
  nativeResumeRefsTable,
  sandboxBackupsTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionRunsTable,
} from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxSessionId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { SandboxMigrationFence } from "../src/adapters/durable-objects/sandbox-migration-fence";
import { getAccountViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getSessionExecutionPlan } from "../src/modules/runtime/application/session-definition/session-execution.repository";
import { queueSessionRun } from "../src/modules/runtime/application/session-run.service";
import { getNativeResumeRefForRuntime } from "../src/modules/runtime/infrastructure/native-resume-ref.repository";
import {
  ensureRuntimeConversationSessionRecord,
  getRuntimeConversationSession,
  recordRuntimeConversationSessionActive,
  recordRuntimeConversationSessionClosed,
  recordRuntimeConversationSessionError,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-conversation-session-store";
import {
  claimRuntimeSubjectActivation,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-record-store";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import { getSandboxBackupObjectKeys } from "../src/modules/runtime/infrastructure/sandbox-backup-platform";
import {
  claimSessionIsolationCohort,
  readSessionIsolationCohort,
  releaseSessionIsolationCohort,
} from "../src/modules/runtime/infrastructure/session-isolation-claim.repository";
import {
  advanceSessionIsolationExecution,
  inspectSessionIsolationExecution,
  prepareSessionIsolationExecution,
  requestSessionIsolationRollback,
} from "../src/modules/runtime/infrastructure/session-isolation-execution";
import type { SessionIsolationExecutionPlatform } from "../src/modules/runtime/infrastructure/session-isolation-execution";
import { buildSessionIsolationPlan } from "../src/modules/runtime/infrastructure/session-isolation-plan";
import type { TransitionStatement } from "../src/modules/runtime/infrastructure/session-isolation-plan";
import { PREVIEW_RETENTION_MS } from "../src/modules/sessions/domain/preview-retention-policy";
import { admitPreviewFileActivity } from "../src/modules/sessions/infrastructure/preview-retention.repository";
import { sessionIsolationClaimOwner } from "../src/modules/sessions/infrastructure/session-isolation-barrier.repository";
import { persistSessionRuntimeEvents } from "../src/modules/sessions/infrastructure/session-runtime-event-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createApiCommandQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertNonOwnerSession,
  insertOwnerSession,
  nowMsForTest,
  PUBLIC_API_TEST_IDS as ID,
  SqliteD1Database,
} from "./helpers/public-api-http-test-fixture";

const CWD = `/workspace/se/${ID.ownerSession}`;
const NOW = nowMsForTest();
const SOURCE_BACKUP = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440001");
const EMPTY_BACKUP = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440002");
const NEW_BACKUP = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440003");
const ROLLBACK_BACKUP = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440004");
const TARGET_SANDBOX = "01J000000000000000000000Y1";
const EXECUTION_ID = "01J000000000000000000000Y2";
const NEXT_EXECUTION_ID = "01J000000000000000000000Y3";
const ROLLBACK_EXECUTION_ID = "01J000000000000000000000Y4";
const TABLES = [
  "session",
  "sandbox",
  "sandbox_session",
  "native_resume_ref",
  "session_execution_snapshot",
  "session_run",
  "sandbox_backup",
  "agent",
  "agent_deployment_version",
  "driver_instance",
  "session_message",
  "session_event",
  "api_command",
];

async function execute(database: D1Database, statements: TransitionStatement[]) {
  return database.batch(
    statements.map((statement) => database.prepare(statement.sql).bind(...statement.params)),
  );
}

async function dump(database: D1Database) {
  return Promise.all(
    TABLES.map(
      async (name) => (await database.prepare(`SELECT * FROM ${name} ORDER BY 1,2`).all()).results,
    ),
  );
}

async function fixture(
  options: {
    nativeTerminal?: "completed" | "failed";
    earlierObservation?: boolean;
    archived?: boolean;
  } = {},
) {
  const runtimeId = options.nativeTerminal ? "acp-fallback" : "openai-runtime";
  const terminalStatus = options.nativeTerminal ?? "completed";
  const database = await createPublicHttpContractDatabase();
  // Runtime fixtures omit inert storage columns. An operator's SELECT * still
  // contains the immutable migration history, including its Project rename.
  database.execute(
    readFileSync(
      new URL("../../../pkgs/db/drizzle/0001_bound-capability-run-provenance.sql", import.meta.url),
      "utf8",
    ),
  );
  const projectRename = readFileSync(
    new URL("../../../pkgs/db/drizzle/0012_rename_app_to_project.sql", import.meta.url),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .find((statement) => statement.includes("RENAME COLUMN `bound_capability_app_id`"));
  if (!projectRename) throw new Error("Historical Run column rename is missing.");
  database.execute(projectRename);
  await insertOwnerSession(database);
  if (options.nativeTerminal) {
    for (const table of ["session", "agent", "agent_deployment_version"]) {
      await database.prepare(`UPDATE ${table} SET runtime_id = ?`).bind(runtimeId).run();
    }
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.binding.runtimeId', ?)",
      )
      .bind(runtimeId)
      .run();
  }
  // Reuse the real native-ref table and additive columns, not a guessed schema.
  const baseline = readFileSync(
    new URL("../../../pkgs/db/drizzle/0000_baseline.sql", import.meta.url),
    "utf8",
  );
  const nativeSchema = baseline.match(/CREATE TABLE `native_resume_ref` \([\s\S]+?\n\);/u)?.[0];
  if (!nativeSchema) throw new Error("Native-ref migration is missing.");
  database.execute(nativeSchema);
  database.execute(
    readFileSync(
      new URL("../../../pkgs/db/drizzle/0011_cattle-terminal-checkpoints.sql", import.meta.url),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .slice(0, 2)
      .join("\n"),
  );
  const db = database.app();
  await db
    .insert(sandboxesTable)
    .values({
      id: ID.sandbox,
      agentId: ID.agent,
      projectId: ID.project,
      ownerAccountId: ID.ownerAccount,
      kind: "pet",
      subjectKind: "agent",
      subjectId: ID.agent,
      status: "cold",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  await db
    .insert(sandboxSessionsTable)
    .values({
      sessionId: ID.ownerSession,
      sandboxId: ID.sandbox,
      sandboxSessionId: EXECUTION_ID,
      cwd: CWD,
      status: "closed",
      originJson: JSON.stringify({
        callerUserId: ID.ownerAccount,
        executionOwnerUserId: ID.ownerAccount,
        entrypoint: "api",
        type: "agent",
      }),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  await db
    .insert(sessionRunsTable)
    .values({
      id: ID.run,
      sessionId: ID.ownerSession,
      agentId: ID.agent,
      status: terminalStatus,
      trigger: "user_prompt",
      createdByAccountId: ID.ownerAccount,
      provider: "openai",
      model: "gpt-5.4",
      runtimeId,
      deploymentVersionId: ID.deployment,
      deploymentVersionNumber: 1,
      traceId: "fixture-trace",
      startedAt: NOW,
      completedAt: NOW + 20,
      createdAt: NOW,
      updatedAt: NOW + 20,
    })
    .run();
  await db
    .insert(nativeResumeRefsTable)
    .values({
      sessionId: ID.ownerSession,
      kind: options.nativeTerminal ? "acp_session_id" : "openai_thread_id",
      runtimeId,
      value: "native-original",
      observedSessionRunId: options.earlierObservation ? ID.runAlt : ID.run,
      observedDriverInstanceId: ID.driverOwner,
      createdAt: NOW,
      updatedAt: NOW + 20,
    })
    .run();
  for (const [id, offset] of [
    [SOURCE_BACKUP, 30],
    [EMPTY_BACKUP, 40],
  ] as const) {
    await db
      .insert(sandboxBackupsTable)
      .values({
        id,
        sandboxId: ID.sandbox,
        dir: CWD,
        status: "ready",
        keep: false,
        ttlSeconds: 31_536_000,
        createdAt: NOW + offset,
        updatedAt: NOW + offset,
      })
      .run();
  }
  await database
    .prepare("UPDATE session SET last_run_id = ?, last_message_at = ? WHERE id = ?")
    .bind(ID.run, NOW + 20, ID.ownerSession)
    .run();
  await persistSessionRuntimeEvents(database, {
    sessionId: ID.ownerSession,
    records: [
      {
        event: createRuntimeEvent({
          id: createPlatformId(),
          kind: terminalStatus === "failed" ? "run.failed" : "run.completed",
          occurredAt: new Date(NOW + 20).toISOString(),
          payload:
            terminalStatus === "failed"
              ? { error: { code: "runtime.failed", message: "Preserved original failure." } }
              : { stopReason: "end_turn" },
          runId: ID.run,
          sessionId: ID.ownerSession,
        }),
        occurredAt: null,
        sourceEventId: null,
      },
    ],
  });
  if (options.archived) {
    await database
      .prepare("UPDATE session SET archived_at = ? WHERE id = ?")
      .bind(NOW + 25, ID.ownerSession)
      .run();
  }
  const select = (table: string, column: string, id: string) =>
    database.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).bind(id).first();
  const source = {
    session: await select("session", "id", ID.ownerSession),
    sandbox: await select("sandbox", "id", ID.sandbox),
    workspace: await select("sandbox_session", "session_id", ID.ownerSession),
    native: await select("native_resume_ref", "session_id", ID.ownerSession),
    snapshot: await select("session_execution_snapshot", "session_id", ID.ownerSession),
    run: await select("session_run", "id", ID.run),
    sourceBackup: await select("sandbox_backup", "id", SOURCE_BACKUP),
    latestBackup: await select("sandbox_backup", "id", EMPTY_BACKUP),
    agent: await select("agent", "id", ID.agent),
    deployment: await select("agent_deployment_version", "id", ID.deployment),
  };
  const input = {
    source,
    preparedAt: NOW + 50,
    destination: {
      sandboxId: TARGET_SANDBOX,
      executionSessionId: NEXT_EXECUTION_ID,
      rollbackExecutionSessionId: ROLLBACK_EXECUTION_ID,
      backupId: NEW_BACKUP,
      rollbackBackupId: ROLLBACK_BACKUP,
    },
    // Synthetic evidence only; this test does not claim remote archives exist.
    workspaceEvidence: {
      sessionId: ID.ownerSession,
      sourceBackupId: SOURCE_BACKUP,
      ...(terminalStatus === "failed" ? { terminalRunId: ID.run } : { completedRunId: ID.run }),
      cwd: CWD,
      runtimeId,
      nativeValue: "native-original",
      sourceArchiveSha256: "a".repeat(64),
      preparedArchiveSha256: "b".repeat(64),
      rollbackArchiveSha256: "c".repeat(64),
      ...(options.nativeTerminal
        ? {
            terminalEvidence: {
              version: 1,
              runId: ID.run,
              status: terminalStatus,
              completedAt: NOW + 20,
              observedRunId: options.earlierObservation ? ID.runAlt : ID.run,
              sourceRevision: "2bda2d940acf382dfc718745619ecc54797ce793",
              driverRevision: "16e47258aab1ac1d9dde3cd9d55f6374a4ce9a50",
              harnessVersion: "1.18.4",
              nativeLoadImage:
                "sha256:e2e1722e39655ae4e46d86bbce49888fbc62c74e8d748a6f5dd2f4a8b2f49eac",
              nativeLoadReceiptSha256: "d".repeat(64),
              canonicalHistoryReceiptSha256: "e".repeat(64),
              workspaceReceiptSha256: "f".repeat(64),
              nativeRowsSha256: "1".repeat(64),
              canonicalTextCount: 2,
              matchedCanonicalTextCount: 2,
              nativeTextCount: 2,
              replayedNativeTextCount: 2,
              nativeMessageRowsPreserved: true,
              nativePartRowsPreserved: true,
              workspaceFilesPreserved: true,
            },
          }
        : {}),
    },
  };
  const viewer = await getAccountViewer(database, ID.ownerAccount);
  if (viewer === null) throw new Error("Fixture viewer is missing.");
  const queue = (requestDatabase: D1Database = database) =>
    queueSessionRun({
      bindings: createPublicHttpTestBindings(requestDatabase, {
        apiCommandQueue: createApiCommandQueueStub(),
      }) as ApiBindings,
      executionContext: null,
      requestUrl: "https://api.example.com/api/graphql",
      viewer,
      input: {
        accessViewer: viewer,
        attachmentIds: [],
        clientRequestId: "conversion-race",
        prompt: "Continue the same Session.",
        session: {
          agent_id: ID.agent,
          project_id: ID.project,
          deployment_version_id: ID.deployment,
          deployment_version_number: 1,
          id: ID.ownerSession,
          model: "gpt-5.4",
          provider: "openai",
          runtime_id: "openai-runtime",
        },
      },
    });
  return { database, input, queue, plan: buildSessionIsolationPlan(input) };
}

async function insertUnattributedActivePeer(
  database: SqliteD1Database,
  sandboxId: string,
  relationship: "workspace" | "stopped-driver" | "failed-driver" | "unrelated",
) {
  await insertNonOwnerSession(database);
  await database
    .prepare("UPDATE session SET agent_id = NULL, status = 'RUNNING', last_run_id = ? WHERE id = ?")
    .bind(ID.runAlt, ID.nonOwnerSession)
    .run();
  if (relationship === "workspace") {
    await database
      .prepare(
        "INSERT INTO sandbox_session (session_id, sandbox_id, cloudflare_session_id, cwd, origin_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'closed', ?, ?)",
      )
      .bind(
        ID.nonOwnerSession,
        sandboxId,
        "01J000000000000000000000Z5",
        `/workspace/se/${ID.nonOwnerSession}`,
        JSON.stringify({
          callerUserId: ID.nonOwnerAccount,
          executionOwnerUserId: ID.ownerAccount,
          entrypoint: "api",
          type: "agent",
        }),
        NOW,
        NOW,
      )
      .run();
  }
  const driverStatus =
    relationship === "stopped-driver"
      ? "stopped"
      : relationship === "failed-driver"
        ? "failed"
        : null;
  if (driverStatus !== null) {
    await database
      .app()
      .insert(driverInstancesTable)
      .values({
        id: ID.driverNonOwner,
        sandboxId,
        sandboxSessionId: ID.nonOwnerSession,
        runtime: "openai-runtime",
        protocol: "orpc-ws",
        protocolVersion: 5,
        bootTokenHash: new Uint8Array([7, 8, 9]),
        bootTokenExpiresAt: NOW + 60_000,
        expiresAt: NOW + 60_000,
        heartbeatCount: 0,
        status: driverStatus,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  }
  await database
    .app()
    .insert(sessionRunsTable)
    .values({
      id: ID.runAlt,
      agentId: null,
      sessionId: ID.nonOwnerSession,
      createdByAccountId: ID.nonOwnerAccount,
      status:
        driverStatus === null ? "queued" : driverStatus === "stopped" ? "running" : "waiting_input",
      driverInstanceId: driverStatus === null ? null : ID.driverNonOwner,
      trigger: "user_prompt",
      traceId: "unattributed-active-peer",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

describe("legacy Session isolation batch", () => {
  test("verified archived ACP copies retain their archive boundary and reject concurrent reopening", async () => {
    const { database, plan } = await fixture({
      nativeTerminal: "completed",
      earlierObservation: true,
      archived: true,
    });
    await execute(database, plan.forward);
    expect(
      await database
        .prepare("SELECT archived_at FROM session WHERE id = ?")
        .bind(ID.ownerSession)
        .first("archived_at"),
    ).toBe(NOW + 25);
    await execute(database, plan.rollback);
    expect(
      await database
        .prepare("SELECT archived_at FROM session WHERE id = ?")
        .bind(ID.ownerSession)
        .first("archived_at"),
    ).toBe(NOW + 25);
    const pending = await fixture({
      nativeTerminal: "completed",
      earlierObservation: true,
      archived: true,
    });
    await pending.database
      .prepare("UPDATE session SET archived_at = NULL WHERE id = ?")
      .bind(ID.ownerSession)
      .run();
    const before = await dump(pending.database);
    await expect(execute(pending.database, pending.plan.forward)).rejects.toThrow();
    expect(await dump(pending.database)).toEqual(before);
  });

  test.each(["completed", "failed"] as const)(
    "imports a verified ACP %s boundary with an older native observation and preserves its Run through rollback",
    async (nativeTerminal) => {
      const { database, plan } = await fixture({ nativeTerminal, earlierObservation: true });
      const originalRun = await database
        .prepare("SELECT * FROM session_run WHERE id = ?")
        .bind(ID.run)
        .first();
      const originalEvents = await database
        .prepare("SELECT * FROM session_event WHERE run_id = ? ORDER BY id")
        .bind(ID.run)
        .all();
      await execute(database, plan.forward);
      expect(
        await database.prepare("SELECT * FROM session_run WHERE id = ?").bind(ID.run).first(),
      ).toEqual(originalRun);
      expect(
        await database
          .prepare("SELECT * FROM session_event WHERE run_id = ? ORDER BY id")
          .bind(ID.run)
          .all(),
      ).toEqual(originalEvents);
      expect(
        await getNativeResumeRefForRuntime(database, {
          runtimeId: "acp-fallback",
          sessionId: ID.ownerSession,
        }),
      ).toEqual({ kind: "acp_session_id", runtimeId: "acp-fallback", value: "native-original" });
      const associatedRun = nativeTerminal === "completed" ? ID.run : null;
      expect(
        await database
          .prepare("SELECT committed_session_run_id FROM native_resume_ref WHERE session_id = ?")
          .bind(ID.ownerSession)
          .first("committed_session_run_id"),
      ).toBe(associatedRun);
      expect(
        await database
          .prepare("SELECT session_run_id FROM sandbox_backup WHERE id = ?")
          .bind(NEW_BACKUP)
          .first("session_run_id"),
      ).toBe(associatedRun);
      await execute(database, plan.rollback);
      expect(
        await database.prepare("SELECT * FROM session_run WHERE id = ?").bind(ID.run).first(),
      ).toEqual(originalRun);
      expect(
        await database
          .prepare("SELECT * FROM session_event WHERE run_id = ? ORDER BY id")
          .bind(ID.run)
          .all(),
      ).toEqual(originalEvents);
      expect(
        await database
          .prepare("SELECT * FROM native_resume_ref WHERE session_id = ?")
          .bind(ID.ownerSession)
          .first(),
      ).toEqual(plan.before.native);
    },
  );

  test("requires matching ACP receipts and refuses incomplete canonical history", async () => {
    const { input } = await fixture({ nativeTerminal: "failed" });
    const evidence = input.workspaceEvidence.terminalEvidence;
    if (!evidence) throw new Error("Fixture terminal evidence is missing.");
    for (const mutation of [
      { status: "completed" },
      { runId: ID.runAlt },
      { observedRunId: ID.runAlt },
      { completedAt: NOW },
      { canonicalTextCount: 0 },
      { matchedCanonicalTextCount: 1 },
      { replayedNativeTextCount: 1 },
      { nativeMessageRowsPreserved: false },
      { nativePartRowsPreserved: false },
      { workspaceFilesPreserved: false },
      { nativeLoadReceiptSha256: "missing" },
      { canonicalHistoryReceiptSha256: "missing" },
      { nativeLoadImage: "another-image" },
      { harnessVersion: "old" },
    ]) {
      expect(() =>
        buildSessionIsolationPlan({
          ...input,
          workspaceEvidence: {
            ...input.workspaceEvidence,
            terminalEvidence: { ...evidence, ...mutation },
          },
        }),
      ).toThrow();
    }
    expect(() =>
      buildSessionIsolationPlan({
        ...input,
        workspaceEvidence: { ...input.workspaceEvidence, terminalEvidence: undefined },
      }),
    ).toThrow();
  });

  test("ACP conversion checks persisted failure and rejects changes after qualification atomically", async () => {
    const { database, plan } = await fixture({ nativeTerminal: "failed" });
    await database
      .prepare("UPDATE session_event SET event_type = 'run.completed' WHERE run_id = ?")
      .bind(ID.run)
      .run();
    const before = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow();
    expect(await dump(database)).toEqual(before);
    await database
      .prepare("UPDATE session_event SET event_type = 'run.failed' WHERE run_id = ?")
      .bind(ID.run)
      .run();
    await database
      .prepare("UPDATE native_resume_ref SET observed_session_run_id = ? WHERE session_id = ?")
      .bind(ID.runAlt, ID.ownerSession)
      .run();
    const changed = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow();
    expect(await dump(database)).toEqual(changed);
  });

  for (const phase of ["forward", "rollback-source", "rollback-destination"] as const) {
    test.each(["workspace", "stopped-driver", "failed-driver"] as const)(
      `${phase} rejects an active Run linked by %s without Agent provenance`,
      async (relationship) => {
        const { database, plan } = await fixture();
        if (phase !== "forward") await execute(database, plan.forward);
        await insertUnattributedActivePeer(
          database,
          phase === "rollback-destination" ? TARGET_SANDBOX : ID.sandbox,
          relationship,
        );
        const before = await dump(database);
        const batch = phase === "forward" ? plan.forward : plan.rollback;
        await expect(execute(database, batch)).rejects.toThrow();
        expect(await dump(database)).toEqual(before);

        // A terminal Run no longer leases the resource. Keep its original
        // Driver, workspace and history; only normal drain changes eligibility.
        await database
          .prepare("UPDATE session_run SET status = 'cancelled' WHERE id = ?")
          .bind(ID.runAlt)
          .run();
        await expect(execute(database, batch)).resolves.toBeDefined();
      },
    );
  }

  test("an unrelated direct Run does not block a different resource's conversion", async () => {
    const { database, plan } = await fixture();
    await insertUnattributedActivePeer(database, ID.sandbox, "unrelated");
    await expect(execute(database, plan.forward)).resolves.toBeDefined();
    await expect(execute(database, plan.rollback)).resolves.toBeDefined();
    expect(
      await database
        .prepare("SELECT status FROM session_run WHERE id = ?")
        .bind(ID.runAlt)
        .first("status"),
    ).toBe("queued");
  });

  test("accepts a completed recycle operation without copying its operation ID into the new subject", async () => {
    const { database, input } = await fixture();
    await database
      .prepare("UPDATE sandbox SET status = 'destroying', status_operation_id = ? WHERE id = ?")
      .bind(ID.operation, ID.sandbox)
      .run();
    expect(
      await markRuntimeSubjectCold(database, {
        clearBackups: false,
        expectedStatus: "destroying",
        operationId: ID.operation,
        runtimeSubjectId: ID.sandbox,
        source: "maintenance",
      }),
    ).toBe(true);
    const sandbox = await database
      .prepare("SELECT * FROM sandbox WHERE id = ?")
      .bind(ID.sandbox)
      .first();
    const plan = buildSessionIsolationPlan({ ...input, source: { ...input.source, sandbox } });
    expect(plan.before.sandbox.status_operation_id).toBe(ID.operation);
    expect(plan.after.sandbox.status_operation_id).toBeNull();
    await execute(database, plan.forward);
    await execute(database, plan.rollback);
    expect(
      await database.prepare("SELECT * FROM sandbox WHERE id = ?").bind(ID.sandbox).first(),
    ).toEqual(sandbox);
  });

  test("derives missing historical Sandbox ownership from the bound Agent and delegated identity", async () => {
    const { database, input } = await fixture();
    await database
      .prepare("UPDATE sandbox SET agent_id = NULL, project_id = NULL, owner_account_id = NULL")
      .run();
    const sandbox = await database
      .prepare("SELECT * FROM sandbox WHERE id = ?")
      .bind(ID.sandbox)
      .first();
    const plan = buildSessionIsolationPlan({ ...input, source: { ...input.source, sandbox } });
    expect(plan.after.sandbox).toMatchObject({
      agent_id: ID.agent,
      project_id: ID.project,
      owner_account_id: ID.ownerAccount,
    });
    await execute(database, plan.forward);
    await execute(database, plan.rollback);
    expect(
      await database.prepare("SELECT * FROM sandbox WHERE id = ?").bind(ID.sandbox).first(),
    ).toEqual(sandbox);
  });

  test.each(["agent_id", "project_id", "owner_account_id"])(
    "rejects conflicting non-null Sandbox %s",
    async (column) => {
      const { input } = await fixture();
      expect(() =>
        buildSessionIsolationPlan({
          ...input,
          source: {
            ...input.source,
            sandbox: { ...input.source.sandbox, [column]: ID.outsiderAccount },
          },
        }),
      ).toThrow("Source ownership does not match");
    },
  );

  test("guards and preserves retired physical Run columns through the full migration chain", async () => {
    const { database: fixtureDatabase, input } = await fixture();
    const database = new SqliteD1Database();
    const migrations = new URL("../../../pkgs/db/drizzle/", import.meta.url);
    for (const filename of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .toSorted()) {
      database.execute(readFileSync(new URL(filename, migrations), "utf8"));
    }
    const rows = await dump(fixtureDatabase);
    await database.batch([
      database.prepare("PRAGMA defer_foreign_keys = ON"),
      ...rows.flatMap((tableRows, index) =>
        tableRows.map((row) => {
          const columns = Object.keys(row);
          return database
            .prepare(
              `INSERT INTO ${TABLES[index]} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            )
            .bind(...columns.map((column) => row[column]));
        }),
      ),
    ]);
    await database
      .prepare("UPDATE session_run SET bound_capability_binding_name = 'original-binding'")
      .run();
    const run = await database
      .prepare("SELECT * FROM session_run WHERE id = ?")
      .bind(ID.run)
      .first();
    const physicalInput = { ...input, source: { ...input.source, run } };
    const plan = buildSessionIsolationPlan(physicalInput);
    expect(plan.before.run.bound_capability_binding_name).toBe("original-binding");
    await database
      .prepare("UPDATE session_run SET bound_capability_binding_name = 'changed-after-plan'")
      .run();
    const changed = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow();
    expect(await dump(database)).toEqual(changed);
    await database
      .prepare("UPDATE session_run SET bound_capability_binding_name = 'original-binding'")
      .run();
    await execute(database, plan.forward);
    await execute(database, plan.rollback);
    expect(
      await database.prepare("SELECT * FROM session_run WHERE id = ?").bind(ID.run).first(),
    ).toEqual(run);
    const incompleteRun = { ...run };
    delete incompleteRun.bound_capability_binding_name;
    expect(() =>
      buildSessionIsolationPlan({
        ...physicalInput,
        source: { ...physicalInput.source, run: incompleteRun },
      }),
    ).toThrow("complete before-image");
  });

  test("publishes one coherent continuation and rolls back through a verified replacement source", async () => {
    const { database, plan } = await fixture();
    const originalPlan = await getSessionExecutionPlan(database, ID.ownerSession);
    const originalNative = await getNativeResumeRefForRuntime(database, {
      sessionId: ID.ownerSession,
      runtimeId: "openai-runtime",
    });
    const originalWorkspace = await getRuntimeConversationSession(database, ID.ownerSession);
    expect(originalWorkspace?.latestReadyBackup?.id).toBe(EMPTY_BACKUP);
    await execute(database, plan.forward);
    const isolatedPlan = await getSessionExecutionPlan(database, ID.ownerSession);
    expect(isolatedPlan).toEqual({
      ...originalPlan,
      binding: { ...originalPlan.binding, kind: "cattle" },
      configJson: plan.before.deployment?.config_json,
    });
    expect(isolatedPlan.recoveryRetentionMs).toBeUndefined();
    expect(
      await getNativeResumeRefForRuntime(database, {
        sessionId: ID.ownerSession,
        runtimeId: "openai-runtime",
      }),
    ).toEqual(originalNative);
    expect(await getRuntimeConversationSession(database, ID.ownerSession)).toEqual({
      ...originalWorkspace,
      sandboxId: TARGET_SANDBOX,
      sandboxSessionId: NEXT_EXECUTION_ID,
      workspaceCheckpointRequired: true,
      latestReadyBackup: { id: NEW_BACKUP, dir: CWD },
    });
    expect(
      await database
        .prepare("SELECT keep FROM sandbox_backup WHERE id IN (?, ?)")
        .bind(SOURCE_BACKUP, EMPTY_BACKUP)
        .raw(),
    ).toEqual([[1], [1]]);
    await execute(database, plan.rollback);
    expect(await getSessionExecutionPlan(database, ID.ownerSession)).toEqual(originalPlan);
    expect(
      await getNativeResumeRefForRuntime(database, {
        sessionId: ID.ownerSession,
        runtimeId: "openai-runtime",
      }),
    ).toEqual(originalNative);
    expect(await getRuntimeConversationSession(database, ID.ownerSession)).toEqual({
      ...originalWorkspace,
      sandboxSessionId: ROLLBACK_EXECUTION_ID,
      latestReadyBackup: { id: ROLLBACK_BACKUP, dir: CWD },
    });
    expect(
      await database
        .prepare("SELECT id FROM sandbox WHERE id = ?")
        .bind(TARGET_SANDBOX)
        .first("id"),
    ).toBe(TARGET_SANDBOX);
  });

  test("a real admission winning first rejects the entire conversion without touching its work", async () => {
    const { database, plan, queue } = await fixture();
    const admitted = await queue();
    expect(admitted.run.status).toBe("queued");
    const state = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow();
    expect(await dump(database)).toEqual(state);
  });

  test("a real admission after conversion uses the committed binding and prevents rollback", async () => {
    const { database, plan, queue } = await fixture();
    await execute(database, plan.forward);
    const admitted = await queue();
    expect(admitted.run.status).toBe("queued");
    expect(
      await database
        .prepare("SELECT session_id FROM session_run WHERE id = ?")
        .bind(admitted.run.id)
        .first("session_id"),
    ).toBe(ID.ownerSession);
    expect((await getRuntimeConversationSession(database, ID.ownerSession))?.sandboxId).toBe(
      TARGET_SANDBOX,
    );
    expect(
      (
        await getNativeResumeRefForRuntime(database, {
          sessionId: ID.ownerSession,
          runtimeId: "openai-runtime",
        })
      )?.value,
    ).toBe("native-original");
    const state = await dump(database);
    await expect(execute(database, plan.rollback)).rejects.toThrow();
    expect(await dump(database)).toEqual(state);
  });

  test.each([
    ["archival", "UPDATE session SET archived_at = 1"],
    ["native cursor", "UPDATE native_resume_ref SET value = 'different-native'"],
    ["configuration", "UPDATE agent SET config_json = '{}'"],
    ["snapshot", "UPDATE session_execution_snapshot SET plan_json = '{}'"],
    ["delegated identity", "UPDATE sandbox_session SET origin_json = '{}'"],
    [
      "execution instance",
      "UPDATE sandbox_session SET cloudflare_session_id = '01J000000000000000000000Z1'",
    ],
    ["subject activation", "UPDATE sandbox SET status = 'restoring'"],
    ["subject operation", "UPDATE sandbox SET status_operation_id = '01J000000000000000000000Z3'"],
    ["subject claim", "UPDATE sandbox SET claim_owner = 'prewarm'"],
    ["operation", "UPDATE session SET status_operation_id = '01J000000000000000000000Z2'"],
    ["source pruning", `UPDATE sandbox_backup SET status = 'pruned' WHERE id = '${SOURCE_BACKUP}'`],
    ["completion history", "DELETE FROM session_event"],
    [
      "new ready backup",
      `UPDATE sandbox_backup SET created_at = created_at + 100 WHERE id = '${EMPTY_BACKUP}'`,
    ],
  ])("a changed %s rejects every conversion write", async (_label, mutation) => {
    const { database, plan } = await fixture();
    database.execute(mutation);
    const state = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow();
    expect(await dump(database)).toEqual(state);
  });

  test("a failure after destination creation rolls back the whole batch", async () => {
    const { database, plan } = await fixture();
    database.execute(
      "CREATE TRIGGER fail_native_commit BEFORE UPDATE ON native_resume_ref BEGIN SELECT RAISE(ABORT, 'injected native failure'); END;",
    );
    const state = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow("injected native failure");
    expect(await dump(database)).toEqual(state);
  });

  test("rollback rejects a source machine that became active", async () => {
    const { database, plan } = await fixture();
    await execute(database, plan.forward);
    await database
      .prepare("UPDATE sandbox SET status = 'active' WHERE id = ?")
      .bind(ID.sandbox)
      .run();
    const state = await dump(database);
    await expect(execute(database, plan.rollback)).rejects.toThrow();
    expect(await dump(database)).toEqual(state);
  });

  test.each(["provisioning", "connecting", "ready", "stopping"] as const)(
    "a %s Driver prevents conversion even when the Sandbox row is cold",
    async (status) => {
      const { database, plan } = await fixture();
      await database
        .app()
        .insert(driverInstancesTable)
        .values({
          id: ID.driverOwner,
          sandboxId: ID.sandbox,
          sandboxSessionId: EXECUTION_ID,
          runtime: "openai-runtime",
          protocol: "orpc-ws",
          protocolVersion: 5,
          bootTokenHash: new Uint8Array([1, 2, 3]),
          bootTokenExpiresAt: NOW + 60_000,
          expiresAt: NOW + 60_000,
          heartbeatCount: 0,
          status,
          createdAt: NOW,
          updatedAt: NOW,
        })
        .run();
      const state = await dump(database);
      await expect(execute(database, plan.forward)).rejects.toThrow();
      expect(await dump(database)).toEqual(state);
    },
  );

  test("refuses an ambiguous latest backup under the existing timestamp-only reader", async () => {
    const { database, plan } = await fixture();
    await database
      .app()
      .insert(sandboxBackupsTable)
      .values({
        id: ROLLBACK_BACKUP,
        sandboxId: ID.sandbox,
        dir: CWD,
        status: "ready",
        keep: false,
        ttlSeconds: 31_536_000,
        createdAt: NOW + 40,
        updatedAt: NOW + 40,
      })
      .run();
    const state = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow();
    expect(await dump(database)).toEqual(state);
  });

  test("replayed conversion and rollback batches cannot overwrite their replacement bindings", async () => {
    const { database, plan } = await fixture();
    await execute(database, plan.forward);
    const converted = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow();
    expect(await dump(database)).toEqual(converted);
    await execute(database, plan.rollback);
    const restored = await dump(database);
    await expect(execute(database, plan.rollback)).rejects.toThrow();
    await expect(execute(database, plan.forward)).rejects.toThrow();
    expect(await dump(database)).toEqual(restored);
  });

  test("preserves opaque snapshot fields and requires archive evidence for the exact continuation", async () => {
    const { input, database } = await fixture();
    const snapshot = input.source.snapshot;
    if (!snapshot) throw new Error("Fixture snapshot is missing.");
    const rawPlan = JSON.parse(String(snapshot.plan_json));
    rawPlan.futureCapability = { revision: 2 };
    rawPlan.binding.futureBinding = "keep";
    snapshot.plan_json = JSON.stringify(rawPlan);
    await database
      .prepare("UPDATE session_execution_snapshot SET plan_json = ?")
      .bind(snapshot.plan_json)
      .run();
    const plan = buildSessionIsolationPlan(input);
    await execute(database, plan.forward);
    const converted = JSON.parse(
      String(
        await database
          .prepare("SELECT plan_json FROM session_execution_snapshot")
          .first("plan_json"),
      ),
    );
    expect(converted.futureCapability).toEqual({ revision: 2 });
    expect(converted.binding.futureBinding).toBe("keep");
    expect(() =>
      buildSessionIsolationPlan({
        ...input,
        workspaceEvidence: { ...input.workspaceEvidence, nativeValue: "another-context" },
      }),
    ).toThrow("Workspace evidence");
    expect(() =>
      buildSessionIsolationPlan({
        ...input,
        destination: { ...input.destination, rollbackExecutionSessionId: EXECUTION_ID },
      }),
    ).toThrow("identifiers must be fresh");
  });

  test("rejects an unfrozen configuration rather than using today's Agent settings", async () => {
    const { input } = await fixture();
    expect(() =>
      buildSessionIsolationPlan({ ...input, source: { ...input.source, deployment: null } }),
    ).toThrow("Original immutable configuration");
  });
});

const ISOLATION_OPERATION = parsePlatformId<RuntimeOperationId>(
  ID.operation,
  "isolation operation",
);

function observeIsolationAdmission(database: D1Database, onBlocked: () => Promise<void> | void) {
  let notified = false;
  return new Proxy(database, {
    get(target, property) {
      if (property === "batch") {
        return async <T>(statements: D1PreparedStatement[]) => {
          const results = await target.batch<T>(statements);
          const last = results.at(-1)?.results[0];
          if (
            !notified &&
            typeof last === "object" &&
            last !== null &&
            "status_operation_id" in last &&
            last.status_operation_id === ISOLATION_OPERATION
          ) {
            notified = true;
            await onBlocked();
          }
          return results;
        };
      }
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

describe("Session isolation cohort admission", () => {
  test("claims all legacy peers atomically, retries its owner and rejects a released revision", async () => {
    const { database } = await fixture();
    await insertNonOwnerSession(database);
    const cohort = await readSessionIsolationCohort(database, ID.sandbox);
    expect(cohort.sessions.map((s) => s.id).toSorted()).toEqual(
      [ID.nonOwnerSession, ID.ownerSession].toSorted(),
    );
    const input = { cohort, operationId: ISOLATION_OPERATION, now: NOW + 45 };
    await claimSessionIsolationCohort(database, input);
    const held = await dump(database);
    await expect(
      ensureRuntimeConversationSessionRecord(database, {
        cwd: `/workspace/se/${ID.nonOwnerSession}`,
        now: NOW + 46,
        originJson: "{}",
        runtimeSubjectId: ID.sandbox,
        sessionId: ID.nonOwnerSession,
      }),
    ).rejects.toThrow("malformed JSON");
    await claimSessionIsolationCohort(database, input);
    expect(await dump(database)).toEqual(held);
    await expect(
      releaseSessionIsolationCohort(database, {
        ...input,
        operationId: createPlatformId<RuntimeOperationId>(),
      }),
    ).rejects.toThrow("malformed JSON");
    expect(await dump(database)).toEqual(held);
    await releaseSessionIsolationCohort(database, { ...input, now: NOW + 55 });
    const released = await dump(database);
    await expect(claimSessionIsolationCohort(database, input)).rejects.toThrow("malformed JSON");
    expect(await dump(database)).toEqual(released);
  });

  test("a newly admitted Run wins without cancellation or partial claims", async () => {
    const { database, queue } = await fixture();
    const cohort = await readSessionIsolationCohort(database, ID.sandbox);
    await queue();
    const before = await dump(database);
    await expect(
      claimSessionIsolationCohort(database, {
        cohort,
        operationId: ISOLATION_OPERATION,
        now: NOW + 45,
      }),
    ).rejects.toThrow();
    expect(await dump(database)).toEqual(before);
  });

  test("a new peer or changed namespace invalidates the complete cohort before any claim", async () => {
    for (const change of ["peer", "namespace"] as const) {
      const { database } = await fixture();
      const cohort = await readSessionIsolationCohort(database, ID.sandbox);
      if (change === "peer") await insertNonOwnerSession(database);
      else await database.prepare("UPDATE sandbox SET sandbox_binding = 'SandboxOpenAI'").run();
      const before = await dump(database);
      await expect(
        claimSessionIsolationCohort(database, {
          cohort,
          operationId: ISOLATION_OPERATION,
          now: NOW + 45,
        }),
      ).rejects.toThrow();
      expect(await dump(database)).toEqual(before);
    }
  });

  test("actual resource leases block a claim despite absent provenance and terminal Drivers", async () => {
    for (const relationship of ["workspace", "stopped-driver", "failed-driver"] as const) {
      const { database } = await fixture();
      await insertUnattributedActivePeer(database, ID.sandbox, relationship);
      const cohort = await readSessionIsolationCohort(database, ID.sandbox);
      const before = await dump(database);
      await expect(
        claimSessionIsolationCohort(database, {
          cohort,
          operationId: ISOLATION_OPERATION,
          now: NOW + 45,
        }),
      ).rejects.toThrow();
      expect(await dump(database)).toEqual(before);
    }
  });

  test("release retains the whole claim while an actual resource lease is unresolved", async () => {
    for (const relationship of ["workspace", "stopped-driver", "failed-driver"] as const) {
      const { database } = await fixture();
      const cohort = await readSessionIsolationCohort(database, ID.sandbox);
      const claim = { cohort, operationId: ISOLATION_OPERATION, now: NOW + 45 };
      await claimSessionIsolationCohort(database, claim);
      await insertUnattributedActivePeer(database, ID.sandbox, relationship);
      const before = await dump(database);
      await expect(releaseSessionIsolationCohort(database, claim)).rejects.toThrow(
        "malformed JSON",
      );
      expect(await dump(database)).toEqual(before);
      await database
        .prepare("UPDATE session_run SET status = 'completed' WHERE id = ?")
        .bind(ID.runAlt)
        .run();
      await releaseSessionIsolationCohort(database, { ...claim, now: NOW + 55 });
      expect(
        await database
          .prepare("SELECT status_operation_id FROM session WHERE id = ?")
          .bind(ID.ownerSession)
          .first("status_operation_id"),
      ).toBeNull();
    }
  });

  test("file activity continues while held and invalidates a stale plan without losing its renewal", async () => {
    const { database, input } = await fixture();
    await database
      .prepare("UPDATE session SET type = 'preview', metadata_json = '{}' WHERE id = ?")
      .bind(ID.ownerSession)
      .run();
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.previewRetentionMs', ?) WHERE session_id = ?",
      )
      .bind(PREVIEW_RETENTION_MS, ID.ownerSession)
      .run();
    const cohort = await readSessionIsolationCohort(database, ID.sandbox);
    const claim = { cohort, operationId: ISOLATION_OPERATION, now: NOW + 45 };
    await claimSessionIsolationCohort(database, claim);
    const plan = buildSessionIsolationPlan({
      ...input,
      operationId: ISOLATION_OPERATION,
      source: {
        ...input.source,
        session: await database
          .prepare("SELECT * FROM session WHERE id = ?")
          .bind(ID.ownerSession)
          .first(),
        sandbox: await database
          .prepare("SELECT * FROM sandbox WHERE id = ?")
          .bind(ID.sandbox)
          .first(),
        snapshot: await database
          .prepare("SELECT * FROM session_execution_snapshot WHERE session_id = ?")
          .bind(ID.ownerSession)
          .first(),
      },
    });
    await admitPreviewFileActivity(database, ID.ownerSession, NOW + 48);
    const renewed = await dump(database);
    await expect(execute(database, plan.forward)).rejects.toThrow("malformed JSON");
    expect(await dump(database)).toEqual(renewed);
    await releaseSessionIsolationCohort(database, { ...claim, now: NOW + 55 });
    expect(
      await database
        .prepare(
          "SELECT json_extract(metadata_json, '$.preview_last_activity_at') AS activity FROM session WHERE id = ?",
        )
        .bind(ID.ownerSession)
        .first("activity"),
    ).toBe(NOW + 48);
    expect((await getRuntimeConversationSession(database, ID.ownerSession))?.sandboxId).toBe(
      ID.sandbox,
    );
  });

  test("non-expiring claims reject activation, maintenance and late binding callbacks", async () => {
    const { database } = await fixture();
    const cohort = await readSessionIsolationCohort(database, ID.sandbox);
    await claimSessionIsolationCohort(database, {
      cohort,
      operationId: ISOLATION_OPERATION,
      now: NOW + 45,
    });
    const before = await dump(database);
    expect(
      await claimRuntimeSubjectActivation(database, {
        runtimeSubjectId: ID.sandbox,
        agentId: ID.agent,
        projectId: ID.project,
        executionOwnerUserId: ID.ownerAccount,
        accountConcurrentSandboxLimit: 50,
        claimExpiresAt: NOW + 999_999,
        claimOwner: "ordinary-activation",
        expectedStatus: "cold",
        now: NOW + 100_000,
      }),
    ).toBe(false);
    expect(
      await markRuntimeSubjectOperationStarted(database, {
        runtimeSubjectId: ID.sandbox,
        operationId: createPlatformId<RuntimeOperationId>(),
        status: "destroying",
      }),
    ).toBe(false);
    const binding = {
      sessionId: ID.ownerSession,
      runtimeSubjectId: ID.sandbox,
      expectedSandboxSessionId: parsePlatformId<SandboxSessionId>(
        EXECUTION_ID,
        "execution session",
      ),
      now: NOW + 46,
    };
    await expect(
      recordRuntimeConversationSessionActive(database, {
        ...binding,
        sandboxSessionId: parsePlatformId<SandboxSessionId>(
          NEXT_EXECUTION_ID,
          "new execution session",
        ),
        cwd: CWD,
      }),
    ).rejects.toThrow();
    await recordRuntimeConversationSessionClosed(database, {
      ...binding,
      inactiveDeadlineAt: NOW + 70,
    });
    await recordRuntimeConversationSessionError(database, {
      ...binding,
      errorCode: "runtime.subject_activation_failed",
      message: "late callback",
    });
    expect(await dump(database)).toEqual(before);
  });

  for (const direction of ["forward", "rollback"] as const) {
    test(`input waits through ${direction} and is admitted once on the same Session`, async () => {
      const { database, input, queue } = await fixture();
      const cohort = await readSessionIsolationCohort(database, ID.sandbox);
      const claim = { cohort, operationId: ISOLATION_OPERATION, now: NOW + 45 };
      await claimSessionIsolationCohort(database, claim);
      const blocked = Promise.withResolvers<void>();
      const pending = queue(observeIsolationAdmission(database, () => blocked.resolve()));
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await blocked.promise;
      expect(settled).toBe(false);
      expect(await database.prepare("SELECT COUNT(*) n FROM session_run").first("n")).toBe(1);
      const plan = buildSessionIsolationPlan({
        ...input,
        operationId: ISOLATION_OPERATION,
        source: {
          ...input.source,
          session: await database
            .prepare("SELECT * FROM session WHERE id = ?")
            .bind(ID.ownerSession)
            .first(),
          sandbox: await database
            .prepare("SELECT * FROM sandbox WHERE id = ?")
            .bind(ID.sandbox)
            .first(),
        },
      });
      await execute(database, plan.forward);
      expect(plan.after.sandbox.claim_owner).toBe(sessionIsolationClaimOwner(ISOLATION_OPERATION));
      if (direction === "rollback") await execute(database, plan.rollback);
      await releaseSessionIsolationCohort(database, { ...claim, now: NOW + 55 });
      const result = await pending;
      expect(result.sessionState.sessionId).toBe(ID.ownerSession);
      expect(result.run.model).toBe("gpt-5.4");
      expect(await database.prepare("SELECT COUNT(*) n FROM session_run").first("n")).toBe(2);
      expect(
        await database
          .prepare("SELECT COUNT(*) n FROM session_message WHERE role = 'user'")
          .first("n"),
      ).toBe(1);
      expect((await getRuntimeConversationSession(database, ID.ownerSession))?.sandboxId).toBe(
        direction === "rollback" ? ID.sandbox : TARGET_SANDBOX,
      );
      expect(
        (await getRuntimeConversationSession(database, ID.ownerSession))?.latestReadyBackup?.id,
      ).toBe(direction === "rollback" ? ROLLBACK_BACKUP : NEW_BACKUP);
      expect(
        (
          await getNativeResumeRefForRuntime(database, {
            sessionId: ID.ownerSession,
            runtimeId: "openai-runtime",
          })
        )?.value,
      ).toBe("native-original");
    });
  }

  test("release before the caller sees its failed admission still retries the same input", async () => {
    const { database, queue } = await fixture();
    const cohort = await readSessionIsolationCohort(database, ID.sandbox);
    const claim = { cohort, operationId: ISOLATION_OPERATION, now: NOW + 45 };
    await claimSessionIsolationCohort(database, claim);
    const result = await queue(
      observeIsolationAdmission(database, () =>
        releaseSessionIsolationCohort(database, { ...claim, now: NOW + 55 }),
      ),
    );
    expect(result.sessionState.sessionId).toBe(ID.ownerSession);
    expect(await database.prepare("SELECT COUNT(*) n FROM session_run").first("n")).toBe(2);
    expect(
      await database
        .prepare("SELECT COUNT(*) n FROM session_message WHERE role = 'user'")
        .first("n"),
    ).toBe(1);
  });
});

function localExecutionPlatform() {
  const records = new Map<string, ReturnType<typeof createFence>>();
  const objects = new Map<string, string>();
  const objectExpiresAt = new Map<string, number>();
  for (const [id, hash] of [
    [SOURCE_BACKUP, "a"],
    [NEW_BACKUP, "b"],
    [ROLLBACK_BACKUP, "c"],
  ]) {
    const [archive, metadata] = getSandboxBackupObjectKeys(id);
    objects.set(archive, hash.repeat(64));
    objects.set(metadata, "d".repeat(64));
  }
  function createFence() {
    const storage = new Map<string, unknown>();
    const container = {
      running: false,
      monitor: async () => {},
      destroy: async () => {
        container.running = false;
      },
    };
    let reset = false;
    const context = {
      storage: {
        get: async (key: string) => storage.get(key),
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
        sync: async () => {},
      },
      container,
      blockConcurrencyWhile: async <T>(action: () => Promise<T>) => action(),
      abort: () => {
        reset = true;
        throw new Error("synthetic actor reset");
      },
    };
    return {
      container,
      fence: new SandboxMigrationFence(context),
      async begin(claim: { operationId: string; revision: number }) {
        try {
          return await this.fence.begin(claim);
        } finally {
          if (reset) {
            reset = false;
            this.fence = new SandboxMigrationFence(context);
          }
        }
      },
    };
  }
  const resource = (id: string) => {
    let result = records.get(id);
    if (!result) {
      result = createFence();
      records.set(id, result);
    }
    return result;
  };
  let loseReleaseResponse = false;
  const platform: SessionIsolationExecutionPlatform = {
    async inspect(r) {
      const state = resource(r.sandboxId);
      return {
        ...(await state.fence.inspect()),
        state: state.container.running ? "running" : "stopped",
        observedAt: Date.now(),
      };
    },
    begin: (r, claim) => resource(r.sandboxId).begin(claim),
    stop: (r, claim) => resource(r.sandboxId).fence.stop(claim),
    async release(r, claim) {
      await resource(r.sandboxId).fence.release(claim);
      if (loseReleaseResponse) {
        loseReleaseResponse = false;
        throw new Error("lost release response");
      }
    },
    async verifyObject(key, hash, metadata) {
      if (objects.get(key) !== hash) throw new Error("missing or changed recovery object");
      const expiresAt = objectExpiresAt.get(key);
      if (
        metadata &&
        expiresAt !== undefined &&
        expiresAt < Math.max(metadata.minimumExpiresAt, Date.now() + 60_000)
      ) {
        throw new Error("recovery object does not cover the required lifetime");
      }
    },
  };
  return {
    platform,
    objects,
    objectExpiresAt,
    loseReleaseResponse: () => {
      loseReleaseResponse = true;
    },
  };
}

async function executionFixture(options: Parameters<typeof fixture>[0] = {}) {
  const state = await fixture(options);
  const resources = localExecutionPlatform();
  const request = {
    operationId: ISOLATION_OPERATION,
    cohort: await readSessionIsolationCohort(state.database, ID.sandbox),
    plan: state.input,
    metadataHashes: { source: "d".repeat(64), prepared: "d".repeat(64), rollback: "d".repeat(64) },
  };
  const step = (database: D1Database = state.database) =>
    advanceSessionIsolationExecution(database, resources.platform, ISOLATION_OPERATION);
  const finish = async () => {
    for (let attempt = 0; attempt < 6; attempt++) if ((await step()).phase === "complete") return;
    throw new Error("isolation did not finish within its bounded phase sequence");
  };
  return { ...state, ...resources, request, step, finish };
}

function loseNextBatchResponse(database: D1Database) {
  let lost = false;
  return new Proxy(database, {
    get(target, property) {
      if (property === "batch")
        return async <T>(statements: D1PreparedStatement[]) => {
          const result = await target.batch<T>(statements);
          if (!lost) {
            lost = true;
            throw new Error("lost database response");
          }
          return result;
        };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

async function atFixtureTime(action: () => Promise<void>) {
  const clock = spyOn(Date, "now").mockReturnValue(NOW + 100);
  try {
    await action();
  } finally {
    clock.mockRestore();
  }
}

describe("Resumable Session isolation execution", () => {
  for (const decision of ["forward", "rollback"] as const) {
    test.each(["completed", "failed"] as const)(
      `${decision} of a verified archived ACP %s boundary retains archival and terminal history through claim release`,
      async (nativeTerminal) => {
        const f = await executionFixture({
          nativeTerminal,
          archived: true,
          earlierObservation: true,
        });
        const run = await f.database
          .prepare("SELECT * FROM session_run WHERE id = ?")
          .bind(ID.run)
          .first();
        await expect(
          prepareSessionIsolationExecution(f.database, f.platform, {
            ...f.request,
            cohort: {
              ...f.request.cohort,
              sessions: f.request.cohort.sessions.map((member) => ({
                ...member,
                archivedAt: null,
              })),
            },
          }),
        ).rejects.toThrow("Reviewed isolation cohort");
        await prepareSessionIsolationExecution(f.database, f.platform, f.request);
        if (decision === "rollback") {
          await f.step();
          await f.step();
          await requestSessionIsolationRollback(f.database, ISOLATION_OPERATION);
        }
        await f.finish();
        expect(
          await f.database
            .prepare("SELECT archived_at,kind,status_operation_id FROM session WHERE id = ?")
            .bind(ID.ownerSession)
            .first(),
        ).toEqual({
          archived_at: NOW + 25,
          kind: decision === "forward" ? "cattle" : "pet",
          status_operation_id: null,
        });
        expect(
          await f.database.prepare("SELECT * FROM session_run WHERE id = ?").bind(ID.run).first(),
        ).toEqual(run);
      },
    );
  }

  test("an unexpired source may have been created before its D1 row was recorded", () =>
    atFixtureTime(async () => {
      const f = await executionFixture();
      const backup = f.input.source.sourceBackup!;
      f.objectExpiresAt.set(
        getSandboxBackupObjectKeys(SOURCE_BACKUP)[1],
        Number(backup["created_at"]) + Number(backup["ttl_seconds"]) * 1000 - 2673,
      );
      await prepareSessionIsolationExecution(f.database, f.platform, f.request);
      await f.finish();
      expect((await getRuntimeConversationSession(f.database, ID.ownerSession))?.sandboxId).toBe(
        TARGET_SANDBOX,
      );
    }));

  for (const target of ["prepared", "rollback", "expired source"] as const) {
    test(`${target} recovery must cover its required lifetime before preparation`, () =>
      atFixtureTime(async () => {
        const f = await executionFixture();
        const plan = buildSessionIsolationPlan(f.input);
        const backup = target === "rollback" ? plan.rollbackBackup : plan.after.sourceBackup;
        f.objectExpiresAt.set(
          getSandboxBackupObjectKeys(
            target === "expired source" ? SOURCE_BACKUP : String(backup["id"]),
          )[1],
          target === "expired source"
            ? Date.now() - 1
            : Number(backup["created_at"]) + Number(backup["ttl_seconds"]) * 1000 - 1,
        );
        const before = await dump(f.database);
        await expect(
          prepareSessionIsolationExecution(f.database, f.platform, f.request),
        ).rejects.toThrow("required lifetime");
        expect(await dump(f.database)).toEqual(before);
      }));
  }

  test("holds input through conversion and releases it once with an atomic completion receipt", async () => {
    const f = await executionFixture();
    expect((await prepareSessionIsolationExecution(f.database, f.platform, f.request)).phase).toBe(
      "prepared",
    );
    await f.step();
    let blocked!: () => void;
    const waiting = new Promise<void>((resolve) => {
      blocked = resolve;
    });
    const admitted = f.queue(observeIsolationAdmission(f.database, blocked));
    await waiting;
    expect(
      await f.database
        .prepare("SELECT kind FROM session WHERE id = ?")
        .bind(ID.ownerSession)
        .first("kind"),
    ).toBe("pet");
    expect((await f.step()).phase).toBe("converted");
    expect(
      await f.database
        .prepare("SELECT status_operation_id FROM session WHERE id = ?")
        .bind(ID.ownerSession)
        .first("status_operation_id"),
    ).toBe(ISOLATION_OPERATION);
    await f.finish();
    expect((await admitted).sessionState.sessionId).toBe(ID.ownerSession);
    expect(await f.database.prepare("SELECT COUNT(*) n FROM session_run").first("n")).toBe(2);
    expect(
      await f.database
        .prepare("SELECT COUNT(*) n FROM session_message WHERE role = 'user'")
        .first("n"),
    ).toBe(1);
    expect(
      await f.database
        .prepare("SELECT status FROM api_command WHERE kind = 'session_isolation'")
        .first("status"),
    ).toBe("succeeded");
    const after = await dump(f.database);
    await f.step();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    expect(await dump(f.database)).toEqual(after);
  });

  test("lost D1 conversion acknowledgement resumes from the committed phase", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await f.step();
    await expect(f.step(loseNextBatchResponse(f.database))).rejects.toThrow(
      "lost database response",
    );
    expect((await inspectSessionIsolationExecution(f.database, ISOLATION_OPERATION)).phase).toBe(
      "converted",
    );
    await f.finish();
    expect(
      await f.database
        .prepare("SELECT COUNT(*) n FROM sandbox_backup WHERE id = ?")
        .bind(NEW_BACKUP)
        .first("n"),
    ).toBe(1);
  });

  test("lost physical release and final D1 acknowledgements never reacquire an already live Session", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await f.step();
    await f.step();
    await f.step();
    f.loseReleaseResponse();
    await expect(f.step()).rejects.toThrow("lost release response");
    expect((await inspectSessionIsolationExecution(f.database, ISOLATION_OPERATION)).phase).toBe(
      "releasing",
    );
    await expect(f.step(loseNextBatchResponse(f.database))).rejects.toThrow(
      "lost database response",
    );
    await f.queue();
    const before = await dump(f.database);
    expect((await f.step()).phase).toBe("complete");
    expect(await dump(f.database)).toEqual(before);
    await expect(requestSessionIsolationRollback(f.database, ISOLATION_OPERATION)).rejects.toThrow(
      "release has begun",
    );
  });

  test("rollback preserves concurrent file activity and renaming while restoring the native reader", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await f.step();
    await f.step();
    await f.database
      .prepare(
        "UPDATE session SET metadata_json = ?, title = ?, renamed = 1, updated_at = ? WHERE id = ?",
      )
      .bind('{"preview_last_activity_at":12345}', "new user title", NOW + 100, ID.ownerSession)
      .run();
    await f.database
      .prepare("UPDATE agent SET prompt = ?, model = ?, updated_at = ? WHERE id = ?")
      .bind("new draft instructions", "new-draft-model", NOW + 100, ID.agent)
      .run();
    await requestSessionIsolationRollback(f.database, ISOLATION_OPERATION);
    await f.finish();
    expect(
      await f.database
        .prepare("SELECT kind, metadata_json, title, renamed, updated_at FROM session WHERE id = ?")
        .bind(ID.ownerSession)
        .first(),
    ).toEqual({
      kind: "pet",
      metadata_json: '{"preview_last_activity_at":12345}',
      title: "new user title",
      renamed: 1,
      updated_at: NOW + 100,
    });
    const restored = await getRuntimeConversationSession(f.database, ID.ownerSession);
    expect(restored?.sandboxSessionId).toBe(ROLLBACK_EXECUTION_ID);
    expect(
      await f.database
        .prepare("SELECT COUNT(*) n FROM sandbox_backup WHERE id = ?")
        .bind(ROLLBACK_BACKUP)
        .first("n"),
    ).toBe(1);
    expect(
      (
        await getNativeResumeRefForRuntime(f.database, {
          sessionId: ID.ownerSession,
          runtimeId: "openai-runtime",
        })
      )?.value,
    ).toBe("native-original");
    expect((await getSessionExecutionPlan(f.database, ID.ownerSession))?.binding.model).toBe(
      "gpt-5.4",
    );
    expect(
      await f.database
        .prepare("SELECT model FROM agent WHERE id = ?")
        .bind(ID.agent)
        .first("model"),
    ).toBe("new-draft-model");
  });

  test("changed archive prevents conversion and explicit abort releases only newly reserved state", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await f.step();
    f.objects.clear();
    await expect(f.step()).rejects.toThrow("missing or changed recovery object");
    expect(
      await f.database
        .prepare("SELECT kind FROM session WHERE id = ?")
        .bind(ID.ownerSession)
        .first("kind"),
    ).toBe("pet");
    await requestSessionIsolationRollback(f.database, ISOLATION_OPERATION);
    await f.finish();
    expect(
      await f.database
        .prepare("SELECT COUNT(*) n FROM sandbox WHERE id = ?")
        .bind(TARGET_SANDBOX)
        .first("n"),
    ).toBe(0);
    expect(await f.database.prepare("SELECT COUNT(*) n FROM sandbox_backup").first("n")).toBe(2);
    expect(
      await f.database
        .prepare("SELECT status_operation_id FROM session WHERE id = ?")
        .bind(ID.ownerSession)
        .first("status_operation_id"),
    ).toBeNull();
  });

  test("a changed execution field prevents rollback without overwriting the winning state", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await f.step();
    await f.step();
    await requestSessionIsolationRollback(f.database, ISOLATION_OPERATION);
    await f.database
      .prepare("UPDATE session SET model = 'changed-model' WHERE id = ?")
      .bind(ID.ownerSession)
      .run();
    const before = await dump(f.database);
    await expect(f.step()).rejects.toThrow("changed execution state");
    expect(await dump(f.database)).toEqual(before);
  });

  test("rollback requires its verified copy even when a forward archive is no longer usable", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await f.step();
    await f.step();
    await requestSessionIsolationRollback(f.database, ISOLATION_OPERATION);
    const [rollbackArchive, rollbackMetadata] = getSandboxBackupObjectKeys(ROLLBACK_BACKUP);
    f.objects.clear();
    await expect(f.step()).rejects.toThrow("missing or changed recovery object");
    expect((await inspectSessionIsolationExecution(f.database, ISOLATION_OPERATION)).phase).toBe(
      "converted",
    );
    f.objects.set(rollbackArchive, "c".repeat(64));
    f.objects.set(rollbackMetadata, "d".repeat(64));
    await f.finish();
    expect(
      (await getRuntimeConversationSession(f.database, ID.ownerSession))?.latestReadyBackup?.id,
    ).toBe(ROLLBACK_BACKUP);
  });

  test("preparation is immutable and a new peer prevents the whole claim", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await expect(
      prepareSessionIsolationExecution(f.database, f.platform, {
        ...f.request,
        metadataHashes: { ...f.request.metadataHashes, source: "e".repeat(64) },
      }),
    ).rejects.toThrow("input is immutable");
    await insertNonOwnerSession(f.database);
    const before = await dump(f.database);
    await expect(f.step()).rejects.toThrow();
    expect(await dump(f.database)).toEqual(before);
    await requestSessionIsolationRollback(f.database, ISOLATION_OPERATION);
    await f.finish();
    expect(
      await f.database
        .prepare("SELECT COUNT(*) n FROM sandbox WHERE id = ?")
        .bind(TARGET_SANDBOX)
        .first("n"),
    ).toBe(0);
  });
});

describe("Isolation execution conflicts", () => {
  test("a rollback decision prevents a concurrently stopping forward worker from converting", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await f.step();
    let reached!: () => void;
    let resume!: () => void;
    const stopping = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resumeStop = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const originalStop = f.platform.stop;
    let first = true;
    f.platform.stop = async (resource, claim) => {
      const result = await originalStop(resource, claim);
      if (first) {
        first = false;
        reached();
        await resumeStop;
      }
      return result;
    };
    const concurrent = f.step();
    await stopping;
    await requestSessionIsolationRollback(f.database, ISOLATION_OPERATION);
    resume();
    await expect(concurrent).rejects.toThrow();
    expect(
      (await inspectSessionIsolationExecution(f.database, ISOLATION_OPERATION)).direction,
    ).toBe("rollback");
    expect(
      await f.database
        .prepare("SELECT kind FROM session WHERE id = ?")
        .bind(ID.ownerSession)
        .first("kind"),
    ).toBe("pet");
    await f.finish();
    expect(
      await f.database
        .prepare("SELECT COUNT(*) n FROM sandbox WHERE id = ?")
        .bind(TARGET_SANDBOX)
        .first("n"),
    ).toBe(0);
  });

  test("a destination collision atomically leaves the source and the other resource untouched", async () => {
    const f = await executionFixture();
    await prepareSessionIsolationExecution(f.database, f.platform, f.request);
    await execute(f.database, [f.plan.forward[1]]);
    const before = await dump(f.database);
    await expect(f.step()).rejects.toThrow();
    expect(await dump(f.database)).toEqual(before);
    await requestSessionIsolationRollback(f.database, ISOLATION_OPERATION);
    await f.finish();
    expect(
      await f.database
        .prepare("SELECT COUNT(*) n FROM sandbox WHERE id = ?")
        .bind(TARGET_SANDBOX)
        .first("n"),
    ).toBe(1);
    expect(
      await f.platform.inspect({ sandboxId: TARGET_SANDBOX, binding: "Sandbox", revision: 0 }),
    ).toMatchObject({ operationId: null, revision: 0 });
  });
});
