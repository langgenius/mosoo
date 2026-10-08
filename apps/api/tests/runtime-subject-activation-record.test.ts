import { describe, expect, test } from "bun:test";

import { sandboxesTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { SandboxId } from "@mosoo/id";

import {
  listInactiveRuntimeSubjects,
  repairStrandedRuntimeSubjectDeadlines,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance-store";
import {
  claimRuntimeSubjectActivation,
  ensureRuntimeSubjectId,
  getRuntimeSubjectActivationRecord,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-record-store";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS as ids,
} from "./helpers/public-api-http-test-fixture";

const scope = {
  agentId: null,
  executionOwnerUserId: ids.ownerAccount,
  projectId: ids.project,
  runtimeId: "openai-runtime",
  runtimeImagesEnabled: true,
  runtimeSubjectId: ids.sandbox,
  sessionId: ids.ownerSession,
} as const;

async function fixture() {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await database
    .prepare("UPDATE session SET agent_id = NULL WHERE id = ?")
    .bind(ids.ownerSession)
    .run();
  await database.prepare("DELETE FROM agent").run();
  return database;
}

const claim = {
  ...scope,
  accountConcurrentSandboxLimit: 5,
  claimExpiresAt: 1000,
  claimOwner: "activation",
  expectedStatus: "cold",
  now: 10,
} as const;

describe("exclusive Session execution ownership", () => {
  test("allocates and reuses a real Session without creating an Agent", async () => {
    const database = await fixture();
    expect(await ensureRuntimeSubjectId(database, scope)).toBe(ids.sandbox);
    await database
      .prepare("UPDATE sandbox SET kind = 'pet', last_backup_id = 'legacy-pointer'")
      .run();
    expect(await ensureRuntimeSubjectId(database, scope)).toBe(ids.sandbox);
    const record = await getRuntimeSubjectActivationRecord(database, ids.sandbox);
    expect(record).toMatchObject({
      id: ids.sandbox,
      ownerAccountId: ids.ownerAccount,
      projectId: ids.project,
      subjectId: ids.ownerSession,
      subjectKind: "session",
      foreignSessionCount: 0,
    });
    expect(record).not.toHaveProperty("lastBackup");
    expect(await database.prepare("SELECT count(*) AS count FROM sandbox").first()).toEqual({
      count: 1,
    });
    expect(await database.prepare("SELECT count(*) AS count FROM agent").first()).toEqual({
      count: 0,
    });
  });

  test("requires the actual Session and Project owner before allocating", async () => {
    const database = await fixture();
    for (const forged of [
      { ...scope, executionOwnerUserId: ids.nonOwnerAccount },
      { ...scope, projectId: createPlatformId() },
      { ...scope, sessionId: ids.nonOwnerSession },
    ]) {
      await expect(ensureRuntimeSubjectId(database, forged)).rejects.toThrow(
        "authority is unavailable",
      );
    }
    expect(await database.prepare("SELECT count(*) AS count FROM sandbox").first()).toEqual({
      count: 0,
    });
  });

  test("discovers and preserves an old shared binding even without an explicit Sandbox id", async () => {
    const database = await fixture();
    await ensureRuntimeSubjectId(database, scope);
    await database
      .prepare("UPDATE sandbox SET subject_kind = 'agent', subject_id = ?, kind = 'pet'")
      .bind(ids.agent)
      .run();
    await database
      .prepare(`INSERT INTO sandbox_session
      (session_id, sandbox_id, cloudflare_session_id, cwd, origin_json, status, created_at, updated_at)
      VALUES (?, ?, ?, '/workspace', '{}', 'closed', 1, 1)`)
      .bind(ids.ownerSession, ids.sandbox, ids.ownerSession)
      .run();
    const before = await database.prepare("SELECT * FROM sandbox").all();
    const { runtimeSubjectId: _explicitId, ...implicit } = scope;
    await expect(ensureRuntimeSubjectId(database, implicit)).rejects.toThrow(
      "verified exclusive execution binding",
    );
    expect(await database.prepare("SELECT * FROM sandbox").all()).toEqual(before);
  });

  test("never replaces a recorded Session binding whose resource row is missing", async () => {
    const database = await fixture();
    await database
      .prepare(`INSERT INTO sandbox_session
      (session_id, sandbox_id, cloudflare_session_id, cwd, origin_json, status, created_at, updated_at)
      VALUES (?, ?, ?, '/workspace', '{}', 'closed', 1, 1)`)
      .bind(ids.ownerSession, ids.sandbox, ids.ownerSession)
      .run();
    const before = await database.prepare("SELECT * FROM sandbox_session").all();
    await expect(ensureRuntimeSubjectId(database, scope)).rejects.toThrow(
      "has no recorded resource",
    );
    expect(await database.prepare("SELECT count(*) AS count FROM sandbox").first()).toEqual({
      count: 0,
    });
    expect(await database.prepare("SELECT * FROM sandbox_session").all()).toEqual(before);
  });

  test("a closed foreign peer blocks both activation and idle reclamation", async () => {
    const database = await fixture();
    await insertNonOwnerSession(database);
    await ensureRuntimeSubjectId(database, scope);
    await database
      .prepare(`INSERT INTO sandbox_session
      (session_id, sandbox_id, cloudflare_session_id, cwd, origin_json, status, created_at, updated_at)
      VALUES (?, ?, ?, '/workspace', '{}', 'closed', 1, 1)`)
      .bind(ids.nonOwnerSession, ids.sandbox, ids.nonOwnerSession)
      .run();
    expect(
      (await getRuntimeSubjectActivationRecord(database, ids.sandbox))?.foreignSessionCount,
    ).toBe(1);
    await expect(ensureRuntimeSubjectId(database, scope)).rejects.toThrow(
      "verified exclusive execution binding",
    );
    expect(await claimRuntimeSubjectActivation(database, claim)).toBe(false);
    await database.prepare("UPDATE sandbox SET status = 'active', inactive_deadline_at = 1").run();
    expect(await listInactiveRuntimeSubjects(database, { limit: 10, now: 10 })).toEqual([]);
  });

  test("does not choose arbitrarily between duplicate historical kind tuples", async () => {
    const database = await fixture();
    await ensureRuntimeSubjectId(database, scope);
    const row = await database.app().select().from(sandboxesTable).get();
    if (!row) throw new Error("Sandbox fixture was not allocated.");
    await database
      .app()
      .insert(sandboxesTable)
      .values({
        ...row,
        id: createPlatformId<SandboxId>(),
        kind: "pet",
      })
      .run();
    await expect(ensureRuntimeSubjectId(database, scope)).rejects.toThrow("binding is ambiguous");
    expect(await database.prepare("SELECT count(*) AS count FROM sandbox").first()).toEqual({
      count: 2,
    });
  });

  test("rechecks Project authority atomically when the activation claim is acquired", async () => {
    const database = await fixture();
    await ensureRuntimeSubjectId(database, scope);
    await database
      .prepare("UPDATE project SET owner_account_id = ? WHERE id = ?")
      .bind(ids.nonOwnerAccount, ids.project)
      .run();
    const before = await database.prepare("SELECT * FROM sandbox").all();
    expect(await claimRuntimeSubjectActivation(database, claim)).toBe(false);
    expect(await database.prepare("SELECT * FROM sandbox").all()).toEqual(before);
  });

  test("repairs an idle exclusive Session regardless of an inert kind label", async () => {
    const database = await fixture();
    await ensureRuntimeSubjectId(database, scope);
    await database
      .prepare("UPDATE sandbox SET kind = 'pet', status = 'active', inactive_deadline_at = NULL")
      .run();
    expect(await repairStrandedRuntimeSubjectDeadlines(database, { now: 10 })).toBe(1);
    expect(await listInactiveRuntimeSubjects(database, { limit: 10, now: 300010 })).toEqual([
      { id: ids.sandbox },
    ]);
    await database
      .prepare(
        "UPDATE sandbox SET subject_kind = 'agent', subject_id = ?, inactive_deadline_at = NULL",
      )
      .bind(ids.agent)
      .run();
    const before = await database.prepare("SELECT * FROM sandbox").all();
    expect(await repairStrandedRuntimeSubjectDeadlines(database, { now: 20 })).toBe(0);
    expect(await database.prepare("SELECT * FROM sandbox").all()).toEqual(before);
  });
});
