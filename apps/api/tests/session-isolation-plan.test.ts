import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  driverInstancesTable,
  nativeResumeRefsTable,
  sandboxBackupsTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionRunsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { getAccountViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getSessionExecutionPlan } from "../src/modules/runtime/application/session-definition/session-execution.repository";
import { queueSessionRun } from "../src/modules/runtime/application/session-run.service";
import { getNativeResumeRefForRuntime } from "../src/modules/runtime/infrastructure/native-resume-ref.repository";
import { getRuntimeConversationSession } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-conversation-session-store";
import { markRuntimeSubjectCold } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-record-store";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import { buildSessionIsolationPlan } from "../src/modules/runtime/infrastructure/session-isolation-plan";
import type { TransitionStatement } from "../src/modules/runtime/infrastructure/session-isolation-plan";
import { persistSessionRuntimeEvents } from "../src/modules/sessions/infrastructure/session-runtime-event-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createApiCommandQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
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

async function fixture() {
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
      status: "completed",
      trigger: "user_prompt",
      createdByAccountId: ID.ownerAccount,
      provider: "openai",
      model: "gpt-5.4",
      runtimeId: "openai-runtime",
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
      kind: "openai_thread_id",
      runtimeId: "openai-runtime",
      value: "native-original",
      observedSessionRunId: ID.run,
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
          kind: "run.completed",
          occurredAt: new Date(NOW + 20).toISOString(),
          payload: { stopReason: "end_turn" },
          runId: ID.run,
          sessionId: ID.ownerSession,
        }),
        occurredAt: null,
        sourceEventId: null,
      },
    ],
  });
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
      completedRunId: ID.run,
      cwd: CWD,
      runtimeId: "openai-runtime",
      nativeValue: "native-original",
      sourceArchiveSha256: "a".repeat(64),
      preparedArchiveSha256: "b".repeat(64),
      rollbackArchiveSha256: "c".repeat(64),
    },
  };
  const viewer = await getAccountViewer(database, ID.ownerAccount);
  if (viewer === null) throw new Error("Fixture viewer is missing.");
  const queue = () =>
    queueSessionRun({
      bindings: createPublicHttpTestBindings(database, {
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

describe("legacy Session isolation batch", () => {
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
          protocolVersion: 4,
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
