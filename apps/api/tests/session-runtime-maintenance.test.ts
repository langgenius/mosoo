import { describe, expect, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import { createRuntimeEvent, projectRuntimeEventToAgUiSessionEvents } from "@mosoo/runtime-events";
import { graphql } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import type { GraphQLContext } from "../src/adapters/graphql/graphql-context";
import {
  recreateSessionSandbox,
  restartSessionDriver,
} from "../src/modules/runtime/application/runtime-state-operations.service";
import { PREVIEW_RETENTION_MS } from "../src/modules/sessions/domain/preview-retention-policy";
import { persistSessionRuntimeEvents } from "../src/modules/sessions/infrastructure/session-runtime-event-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS as IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  insertOwnerSession,
  insertNonOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import { OWNER_VIEWER } from "./public-thread-api-fixtures";

async function setup(options: { failDestroy?: boolean } = {}) {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await insertNonOwnerSession(database);
  const siblingSandbox = createPlatformId();
  const calls: string[] = [];
  for (const [sessionId, sandboxId] of [
    [IDS.ownerSession, IDS.sandbox],
    [IDS.nonOwnerSession, siblingSandbox],
  ]) {
    await database
      .prepare(
        "UPDATE session SET agent_id = NULL, kind = 'cattle', deployment_version_id = NULL, deployment_version_number = NULL WHERE id = ?",
      )
      .bind(sessionId)
      .run();
    await database
      .prepare(`INSERT INTO sandbox (id, project_id, owner_account_id, kind, subject_kind, subject_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'cattle', 'session', ?, 'active', 1, 1)`)
      .bind(sandboxId, IDS.project, IDS.ownerAccount, sessionId)
      .run();
    await database
      .prepare(`INSERT INTO sandbox_session
      (cloudflare_session_id, created_at, cwd, origin_json, sandbox_id, session_id, status, updated_at)
      VALUES (?, 1, ?, '{}', ?, ?, 'active', 1)`)
      .bind(createPlatformId(), `/workspace/se/${sessionId}`, sandboxId, sessionId)
      .run();
    const snapshot = await database
      .prepare("SELECT plan_json FROM session_execution_snapshot WHERE session_id = ?")
      .bind(sessionId)
      .first<{ plan_json: string }>();
    const plan = JSON.parse(snapshot!.plan_json);
    plan.binding = {
      ...plan.binding,
      agentId: null,
      kind: "cattle",
      deploymentVersionId: null,
      deploymentVersionNumber: null,
    };
    plan.configJson = JSON.stringify({
      builtInTools: [],
      packageMcpServers: [],
      packageSkills: [],
      packageResolution: null,
      providerOptions: {},
    });
    await database
      .prepare("UPDATE session_execution_snapshot SET plan_json = ? WHERE session_id = ?")
      .bind(JSON.stringify(plan), sessionId)
      .run();
  }
  await database.prepare("DELETE FROM agent").run();
  database.execute(
    `CREATE TABLE native_resume_ref (session_id text PRIMARY KEY, runtime_id text, kind text, value text, observed_session_run_id text, committed_value text, committed_session_run_id text, updated_at integer)`,
  );
  const bindings = {
    ...createPublicHttpTestBindings(database),
    runtimeSubjectHandleFactory: (sandboxId: string) =>
      new Proxy(
        {
          setKeepAlive: async (value: boolean) => {
            calls.push(`keepAlive:${sandboxId}:${value}`);
          },
          destroy: async () => {
            calls.push(`destroy:${sandboxId}`);
            if (options.failDestroy) throw new Error("Simulated container destroy failure");
          },
        },
        {
          get(target, property, receiver) {
            if (
              Reflect.has(target, property) ||
              typeof property !== "string" ||
              property === "then"
            ) {
              return Reflect.get(target, property, receiver);
            }
            return async () => {
              throw new Error(`Unexpected Sandbox operation: ${property}`);
            };
          },
        },
      ),
  } as unknown as ApiBindings;
  return { bindings, calls, database, siblingSandbox };
}

const input = { projectId: IDS.project, sessionId: IDS.ownerSession };

// Change the real database after the Session CAS, before physical dispatch.
function changeAfterAdmission(database: D1Database, change: () => Promise<void>) {
  let changed = false;
  const rawStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement, query: string): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values), query);
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          if (!changed && query.startsWith('update "session"')) {
            const row = await database
              .prepare("SELECT status FROM session WHERE id = ?")
              .bind(IDS.ownerSession)
              .first<{ status: string }>();
            if (row?.status === "RESCHEDULING") {
              changed = true;
              await change();
            }
          }
          return result;
        };
      },
    });
    rawStatements.set(wrapped, statement);
    return wrapped;
  };
  const wrapped = new Proxy(database, {
    get(target, property, receiver) {
      if (property === "prepare") return (query: string) => wrap(target.prepare(query), query);
      if (property === "batch")
        return (statements: D1PreparedStatement[]) =>
          target.batch(statements.map((statement) => rawStatements.get(statement) ?? statement));
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database: wrapped, changed: () => changed };
}

async function committedBoundary(database: D1Database) {
  await database
    .prepare(`INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, trigger, status,
    provider, model, runtime_id, trace_id, created_at, started_at, completed_at, updated_at)
    VALUES (?, ?, NULL, ?, 'user_prompt', 'completed', 'openai', 'gpt-5.4', 'openai-runtime', 'maintenance', 1, 1, 2, 2)`)
    .bind(IDS.run, IDS.ownerSession, IDS.ownerAccount)
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, workspace_checkpoint_required = 1 WHERE id = ?")
    .bind(IDS.run, IDS.ownerSession)
    .run();
  await database
    .prepare(`INSERT INTO sandbox_backup (id, sandbox_id, session_run_id, dir, status, keep, ttl_seconds, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ready', 1, 315360000, 2, 2)`)
    .bind(createPlatformId(), IDS.sandbox, IDS.run, `/workspace/se/${IDS.ownerSession}`)
    .run();
  await database
    .prepare(
      "INSERT INTO native_resume_ref VALUES (?, 'openai-runtime', 'thread', 'observed-native', ?, 'committed-native', ?, 2)",
    )
    .bind(IDS.ownerSession, IDS.run, IDS.run)
    .run();
  await persistSessionRuntimeEvents(database, {
    sessionId: IDS.ownerSession,
    records: [
      {
        event: createRuntimeEvent({
          id: createPlatformId(),
          kind: "run.completed",
          occurredAt: new Date().toISOString(),
          payload: { stopReason: "end_turn" },
          runId: IDS.run,
          sessionId: IDS.ownerSession,
        }),
        occurredAt: null,
        sourceEventId: null,
      },
    ],
  });
}

describe("Session runtime maintenance", () => {
  test("recreates one direct Session without an Agent and preserves its committed state", async () => {
    const { bindings, calls, database, siblingSandbox } = await setup();
    await committedBoundary(database);
    const snapshotBefore = await database
      .prepare("SELECT * FROM session_execution_snapshot ORDER BY session_id")
      .all();
    const nativeBefore = await database.prepare("SELECT * FROM native_resume_ref").all();
    const backupBefore = await database.prepare("SELECT * FROM sandbox_backup").all();
    const result = await recreateSessionSandbox(bindings, OWNER_VIEWER, input);
    expect(result).toEqual({
      affectedSessionCount: 1,
      ok: true,
      operation: "recreateSandbox",
      sessionId: IDS.ownerSession,
    });
    expect(calls).toEqual([`keepAlive:${IDS.sandbox}:false`, `destroy:${IDS.sandbox}`]);
    expect(await database.prepare("SELECT count(*) AS n FROM agent").first()).toEqual({ n: 0 });
    expect(
      await database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(IDS.ownerSession)
        .first(),
    ).toEqual({ status: "IDLE", status_operation_id: null });
    expect(
      await database.prepare("SELECT status FROM sandbox WHERE id = ?").bind(IDS.sandbox).first(),
    ).toEqual({ status: "cold" });
    expect(
      await database
        .prepare("SELECT status FROM sandbox WHERE id = ?")
        .bind(siblingSandbox)
        .first(),
    ).toEqual({ status: "active" });
    expect(
      (await database.prepare("SELECT * FROM session_execution_snapshot ORDER BY session_id").all())
        .results,
    ).toEqual(snapshotBefore.results);
    expect((await database.prepare("SELECT * FROM native_resume_ref").all()).results).toEqual(
      nativeBefore.results,
    );
    expect((await database.prepare("SELECT * FROM sandbox_backup").all()).results).toEqual(
      backupBefore.results,
    );
    expect(
      await database.prepare("SELECT status FROM session_run WHERE id = ?").bind(IDS.run).first(),
    ).toEqual({ status: "completed" });
  });

  test.each(["backup", "history"])(
    "does not destroy a Session with an incomplete successful-turn %s",
    async (missing) => {
      const { bindings, calls, database } = await setup();
      await committedBoundary(database);
      await database
        .prepare(
          missing === "backup"
            ? "DELETE FROM sandbox_backup"
            : "DELETE FROM session_event WHERE event_type = 'run.completed'",
        )
        .run();
      await expect(recreateSessionSandbox(bindings, OWNER_VIEWER, input)).rejects.toMatchObject({
        code: "SESSION_RUN_CHECKPOINT_PENDING",
        status: 409,
      });
      expect(calls).toEqual([]);
      expect(
        await database
          .prepare("SELECT status_seq FROM session WHERE id = ?")
          .bind(IDS.ownerSession)
          .first(),
      ).toEqual({ status_seq: 0 });
    },
  );

  test.each([
    "archived",
    "terminated",
    "busy",
    "shared",
    "other_project",
    "other_owner",
    "wrong_subject",
  ])("rejects %s targets before lifecycle or physical changes", async (state) => {
    const { bindings, calls, database } = await setup();
    switch (state) {
      case "archived":
        await database
          .prepare("UPDATE session SET archived_at = 1 WHERE id = ?")
          .bind(IDS.ownerSession)
          .run();
        break;
      case "terminated":
        await database
          .prepare("UPDATE session SET status = 'TERMINATED' WHERE id = ?")
          .bind(IDS.ownerSession)
          .run();
        break;
      case "busy":
        await database
          .prepare(
            "UPDATE session SET status = 'RESCHEDULING', status_operation_id = ? WHERE id = ?",
          )
          .bind(IDS.operation, IDS.ownerSession)
          .run();
        break;
      case "shared":
        await database
          .prepare("UPDATE sandbox_session SET sandbox_id = ? WHERE session_id = ?")
          .bind(IDS.sandbox, IDS.nonOwnerSession)
          .run();
        await database
          .prepare("UPDATE session SET archived_at = 1 WHERE id = ?")
          .bind(IDS.nonOwnerSession)
          .run();
        break;
      case "other_project":
        await database
          .prepare("UPDATE sandbox SET project_id = ? WHERE id = ?")
          .bind(createPlatformId(), IDS.sandbox)
          .run();
        break;
      case "other_owner":
        await database
          .prepare("UPDATE sandbox SET owner_account_id = ? WHERE id = ?")
          .bind(IDS.nonOwnerAccount, IDS.sandbox)
          .run();
        break;
      case "wrong_subject":
        await database
          .prepare("UPDATE sandbox SET subject_id = ? WHERE id = ?")
          .bind(IDS.nonOwnerSession, IDS.sandbox)
          .run();
        break;
    }
    await expect(recreateSessionSandbox(bindings, OWNER_VIEWER, input)).rejects.toMatchObject({
      code: "SESSION_RUNTIME_OPERATION_UNAVAILABLE",
      status: 409,
    });
    expect(calls).toEqual([]);
    expect(
      await database
        .prepare("SELECT status_seq FROM session WHERE id = ?")
        .bind(IDS.ownerSession)
        .first(),
    ).toEqual({ status_seq: 0 });
  });

  test("requires the actual Project owner and rejects a Session from another Project", async () => {
    const { bindings, calls, database } = await setup();
    await expect(
      restartSessionDriver(bindings, { ...OWNER_VIEWER, id: IDS.nonOwnerAccount }, input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await database
      .prepare("UPDATE session SET project_id = ? WHERE id = ?")
      .bind(createPlatformId(), IDS.ownerSession)
      .run();
    await expect(restartSessionDriver(bindings, OWNER_VIEWER, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(calls).toEqual([]);
  });

  test.each(["binding", "exclusive_binding", "checkpoint"])(
    "rechecks %s after admission and rejects a concurrent change",
    async (change) => {
      const { bindings, calls, database, siblingSandbox } = await setup();
      await committedBoundary(database);
      const race = changeAfterAdmission(database, async () => {
        if (change === "exclusive_binding") {
          const replacement = createPlatformId();
          await database
            .prepare(`INSERT INTO sandbox (id, project_id, owner_account_id, kind, subject_kind, subject_id, status, created_at, updated_at)
          VALUES (?, ?, ?, 'cattle', 'session', ?, 'active', 1, 1)`)
            .bind(replacement, IDS.project, IDS.ownerAccount, IDS.ownerSession)
            .run();
          await database
            .prepare("UPDATE sandbox_session SET sandbox_id = ? WHERE session_id = ?")
            .bind(replacement, IDS.ownerSession)
            .run();
        } else if (change === "binding") {
          await database
            .prepare("UPDATE sandbox_session SET sandbox_id = ? WHERE session_id = ?")
            .bind(siblingSandbox, IDS.ownerSession)
            .run();
        } else {
          await database.prepare("DELETE FROM sandbox_backup").run();
        }
      });
      await expect(
        recreateSessionSandbox({ ...bindings, DB: race.database }, OWNER_VIEWER, input),
      ).rejects.toMatchObject({
        code:
          change === "checkpoint"
            ? "SESSION_RUN_CHECKPOINT_PENDING"
            : "SESSION_RUNTIME_OPERATION_UNAVAILABLE",
        status: 409,
      });
      expect(race.changed()).toBe(true);
      expect(calls).toEqual([]);
      expect(
        await database
          .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
          .bind(IDS.ownerSession)
          .first(),
      ).toEqual({ status: "IDLE", status_operation_id: null });
      expect(
        await database.prepare("SELECT status FROM sandbox WHERE id = ?").bind(IDS.sandbox).first(),
      ).toEqual({ status: "active" });
      if (change === "binding") {
        expect(
          await database
            .prepare("SELECT sandbox_id FROM sandbox_session WHERE session_id = ?")
            .bind(IDS.ownerSession)
            .first(),
        ).toEqual({ sandbox_id: siblingSandbox });
      }
    },
  );

  test("does not renew an expired debug Preview through maintenance", async () => {
    const { bindings, calls, database } = await setup();
    const stale = Date.now() - PREVIEW_RETENTION_MS - 1_000;
    await database
      .prepare(
        "UPDATE session SET type = 'preview', created_at = ?, last_message_at = NULL, metadata_json = '{}', updated_at = ? WHERE id = ?",
      )
      .bind(stale, stale, IDS.ownerSession)
      .run();
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.previewRetentionMs', ?) WHERE session_id = ?",
      )
      .bind(PREVIEW_RETENTION_MS, IDS.ownerSession)
      .run();
    const before = await database
      .prepare("SELECT * FROM session WHERE id = ?")
      .bind(IDS.ownerSession)
      .first();
    await expect(restartSessionDriver(bindings, OWNER_VIEWER, input)).rejects.toMatchObject({
      code: "SESSION_PREVIEW_EXPIRED",
    });
    expect(
      await database.prepare("SELECT * FROM session WHERE id = ?").bind(IDS.ownerSession).first(),
    ).toEqual(before);
    expect(calls).toEqual([]);
  });

  test("does not allocate a resource for an idle Session that has none", async () => {
    const { bindings, calls, database } = await setup();
    await database
      .prepare("DELETE FROM sandbox_session WHERE session_id = ?")
      .bind(IDS.ownerSession)
      .run();
    const before = await database
      .prepare("SELECT * FROM session WHERE id = ?")
      .bind(IDS.ownerSession)
      .first();
    expect(await recreateSessionSandbox(bindings, OWNER_VIEWER, input)).toMatchObject({
      affectedSessionCount: 0,
      ok: true,
    });
    expect(
      await database.prepare("SELECT * FROM session WHERE id = ?").bind(IDS.ownerSession).first(),
    ).toEqual(before);
    expect(calls).toEqual([]);
  });

  test.each(["restartSessionDriver", "recreateSessionSandbox"])(
    "exposes %s with Project and Session IDs, account authentication and no Agent",
    async (operation) => {
      const { bindings, calls } = await setup();
      const executionContext = createTestExecutionContext();
      const context: GraphQLContext = {
        ...bindings,
        bindings,
        executionContext,
        executionCtx: executionContext,
        request: new Request("https://api.example.com/api/graphql"),
        serverContext: { ...bindings, executionCtx: executionContext },
        viewer: OWNER_VIEWER,
      };
      const request = {
        schema: createGraphQLSchema(),
        source: `mutation Maintain($projectId: ULID!, $sessionId: ULID!) { ${operation}(projectId: $projectId, sessionId: $sessionId) { ok affectedSessionCount operation sessionId } }`,
        variableValues: input,
      };
      const unauthenticated = await graphql({
        ...request,
        contextValue: { ...context, viewer: null },
      });
      expect(unauthenticated.errors?.[0]?.extensions.code).toBe("UNAUTHORIZED");
      const applicationKey = await graphql({
        ...request,
        contextValue: { ...context, viewer: { ...OWNER_VIEWER, projectId: IDS.project } },
      });
      expect(applicationKey.errors?.[0]?.extensions.code).toBe("FORBIDDEN");
      expect(calls).toEqual([]);
      const response = await graphql({ ...request, contextValue: context });
      expect(response.errors).toBeUndefined();
      expect(response.data?.[operation]).toEqual({
        affectedSessionCount: 1,
        ok: true,
        operation: operation === "restartSessionDriver" ? "restartDriver" : "recreateSandbox",
        sessionId: IDS.ownerSession,
      });
    },
  );

  test("restores the Session maintenance marker after a physical failure", async () => {
    const { bindings, calls, database } = await setup({ failDestroy: true });
    await committedBoundary(database);
    await expect(recreateSessionSandbox(bindings, OWNER_VIEWER, input)).rejects.toThrow(
      "Simulated container destroy failure",
    );
    expect(calls.filter((call) => call.startsWith("destroy:"))).toEqual([`destroy:${IDS.sandbox}`]);
    expect(
      await database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(IDS.ownerSession)
        .first(),
    ).toEqual({ status: "IDLE", status_operation_id: null });
    expect(await database.prepare("SELECT committed_value FROM native_resume_ref").first()).toEqual(
      { committed_value: "committed-native" },
    );
    expect(await database.prepare("SELECT count(*) AS n FROM sandbox_backup").first()).toEqual({
      n: 1,
    });
    expect(
      await database.prepare("SELECT status FROM sandbox WHERE id = ?").bind(IDS.sandbox).first(),
    ).toEqual({ status: "destroying" });
  });

  test("uses exclusive Session ownership even if historical kind metadata remains", async () => {
    const { bindings, calls, database } = await setup();
    await committedBoundary(database);
    await database.prepare("UPDATE sandbox SET kind = 'pet' WHERE id = ?").bind(IDS.sandbox).run();
    expect(await recreateSessionSandbox(bindings, OWNER_VIEWER, input)).toMatchObject({
      affectedSessionCount: 1,
      ok: true,
    });
    expect(calls).toEqual([`keepAlive:${IDS.sandbox}:false`, `destroy:${IDS.sandbox}`]);
    expect(await database.prepare("SELECT committed_value FROM native_resume_ref").first()).toEqual(
      { committed_value: "committed-native" },
    );
    expect(await database.prepare("SELECT count(*) AS n FROM sandbox_backup").first()).toEqual({
      n: 1,
    });
  });

  test("restart cancels only the selected direct Session's active Run", async () => {
    const { bindings, calls, database } = await setup();
    for (const [sessionId, runId] of [
      [IDS.ownerSession, IDS.run],
      [IDS.nonOwnerSession, IDS.runAlt],
    ]) {
      await database
        .prepare(`INSERT INTO session_run (id, session_id, created_by_account_id, trigger, status, runtime_id, trace_id, created_at, updated_at)
        VALUES (?, ?, ?, 'user_prompt', 'running', 'openai-runtime', 'maintenance-running', 1, 1)`)
        .bind(runId, sessionId, IDS.ownerAccount)
        .run();
      await database
        .prepare("UPDATE session SET status = 'RUNNING', last_run_id = ? WHERE id = ?")
        .bind(runId, sessionId)
        .run();
    }
    expect(await restartSessionDriver(bindings, OWNER_VIEWER, input)).toMatchObject({
      affectedSessionCount: 1,
      sessionId: IDS.ownerSession,
    });
    expect(
      await database.prepare("SELECT status FROM session_run WHERE id = ?").bind(IDS.run).first(),
    ).toEqual({ status: "cancelled" });
    expect(
      await database
        .prepare("SELECT status FROM session_run WHERE id = ?")
        .bind(IDS.runAlt)
        .first(),
    ).toEqual({ status: "running" });
    expect(calls).toEqual([]);
  });

  test.each(["updating", "ready"])(
    "delivers %s lifecycle events without fabricated Agent provenance",
    (status) => {
      const events = projectRuntimeEventToAgUiSessionEvents(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "agent.task.updated",
          occurredAt: new Date().toISOString(),
          payload: { agentId: null, operation: "recreateSandbox", status },
          sessionId: IDS.ownerSession,
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "CUSTOM",
        value: { agentId: null, operation: "recreateSandbox" },
      });
    },
  );
});
