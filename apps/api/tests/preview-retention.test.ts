import { describe, expect, test } from "bun:test";

import { fileRecordsTable, fileUploadsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, SessionId, UploadId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { insertAdmittedFileUpload } from "../src/modules/files/infrastructure/file-upload-admission.repository";
import { listAgentSessions } from "../src/modules/sessions/application/agent-session-query.service";
import {
  cleanupExpiredPreviewSessions,
  deleteSessionCascade,
  repairStaleSessionDeleteCleanups,
} from "../src/modules/sessions/application/session-cleanup.service";
import { PREVIEW_RETENTION_MS } from "../src/modules/sessions/domain/preview-retention-policy";
import {
  admitPreviewFileActivity,
  assertPreviewAvailable,
  expiredPreviewPredicate,
} from "../src/modules/sessions/infrastructure/preview-retention.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { getAppDatabase } from "../src/platform/db/drizzle";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";

const SESSION = parsePlatformId<SessionId>(PUBLIC_API_TEST_IDS.ownerSession, "test session");
const OWNER = parsePlatformId<AccountId>(PUBLIC_API_TEST_IDS.ownerAccount, "test owner");
const START = Date.parse("2026-08-01T00:00:00Z");
const DEADLINE = START + PREVIEW_RETENTION_MS;

async function fixture() {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await database
    .prepare(
      "UPDATE session SET type = 'preview', created_at = ?, last_message_at = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(START, START, SESSION)
    .run();
  await database
    .prepare(
      "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.previewRetentionMs', ?) WHERE session_id = ?",
    )
    .bind(PREVIEW_RETENTION_MS, SESSION)
    .run();
  let destroyCount = 0;
  let failDestroy = false;
  const bindings = {
    ...createPublicHttpTestBindings(database),
    MOSOO_DEPLOYMENT_MODE: "cloud",
    Session: {
      idFromName: (id: string) => id,
      get: () => ({
        destroy: async () => {
          destroyCount += 1;
          if (failDestroy) throw new Error("Interrupted cleanup");
        },
      }),
    },
  } as ApiBindings;
  return {
    database,
    bindings,
    destroyed: () => destroyCount,
    interrupt: (value: boolean) => {
      failDestroy = value;
    },
  };
}

async function isExpired(database: D1Database, nowMs = DEADLINE) {
  const db = getAppDatabase(database);
  return Boolean(
    await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, SESSION), expiredPreviewPredicate(db, nowMs)))
      .get(),
  );
}

async function admitUpload(database: D1Database, nowMs: number) {
  const fileId = createPlatformId<FileId>();
  const uploadId = createPlatformId<UploadId>();
  const admitted = await insertAdmittedFileUpload(
    database,
    {
      committed: false,
      createdAt: nowMs,
      createdByAccountId: OWNER,
      etag: null,
      expiresAt: nowMs + 86_400_000,
      id: fileId,
      mimeType: "text/plain",
      name: "input.txt",
      objectKey: `test/${fileId}`,
      ownerId: SESSION,
      ownerKind: "session",
      parentPath: "/",
      path: `/input-${fileId}.txt`,
      purpose: "session_attachment",
      scopeId: SESSION,
      scopeKind: "session",
      sessionKind: "attachment",
      size: 4,
      status: "pending",
      updatedAt: nowMs,
      version: 1,
    },
    {
      contentType: "text/plain",
      createdAt: nowMs,
      createdByAccountId: OWNER,
      expectedSize: 4,
      expiresAt: nowMs + 86_400_000,
      fileId,
      id: uploadId,
      ifMatchEtag: null,
      multipartUploadId: null,
      overwrite: false,
      partSize: null,
      scopeId: SESSION,
      scopeKind: "session",
      status: "pending",
      strategy: "single_put",
      updatedAt: nowMs,
    },
  );
  return { admitted, fileId, uploadId };
}

describe("Cloud Preview inactivity lifecycle", () => {
  test("looks up a selected Preview beyond the first page and omits it only when expired", async () => {
    const { database } = await fixture();
    const now = Date.now();
    await database
      .prepare("UPDATE session SET created_at = ?, updated_at = ? WHERE id = ?")
      .bind(now - 1000, now - 1000, SESSION)
      .run();
    const existing = await database
      .app()
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, SESSION))
      .get();
    if (!existing) throw new Error("Fixture missing");
    const newer = createPlatformId<SessionId>();
    await database
      .app()
      .insert(sessionsTable)
      .values({ ...existing, id: newer, createdAt: now, updatedAt: now })
      .run();
    const viewer = {
      id: OWNER,
      email: "owner@example.com",
      emailVerified: true,
      name: "Owner",
      imageUrl: null,
    };
    const input = {
      agentId: existing.agentId,
      projectId: existing.projectId,
      archived: false,
      participantOnly: true,
      type: "preview" as const,
      limit: 1,
    };
    expect((await listAgentSessions(database, viewer, input)).nodes.map((node) => node.id)).toEqual(
      [newer],
    );
    expect(
      (await listAgentSessions(database, viewer, { ...input, sessionId: SESSION })).nodes.map(
        (node) => node.id,
      ),
    ).toEqual([SESSION]);
    await database
      .prepare("UPDATE session SET created_at = ? WHERE id = ?")
      .bind(now - PREVIEW_RETENTION_MS, SESSION)
      .run();
    expect(
      (await listAgentSessions(database, viewer, { ...input, sessionId: SESSION })).nodes,
    ).toEqual([]);
    // An ID filter never bypasses the Agent boundary.
    await database
      .prepare("UPDATE session SET agent_id = ? WHERE id = ?")
      .bind(createPlatformId(), newer)
      .run();
    expect(
      (await listAgentSessions(database, viewer, { ...input, sessionId: newer })).nodes,
    ).toEqual([]);
  });

  test("continues until the exact 30-day boundary; maintenance timestamps do not renew it", async () => {
    const { database } = await fixture();
    expect(await isExpired(database, DEADLINE - 1)).toBe(false);
    await assertPreviewAvailable(database, SESSION, DEADLINE - 1);
    await database
      .prepare("UPDATE session SET updated_at = ? WHERE id = ?")
      .bind(DEADLINE, SESSION)
      .run();
    expect(await isExpired(database)).toBe(true);
    await expect(assertPreviewAvailable(database, SESSION, DEADLINE)).rejects.toMatchObject({
      code: "SESSION_PREVIEW_EXPIRED",
    });
  });

  test("does not enroll historical Previews or formal Sessions by inference", async () => {
    const { database } = await fixture();
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_remove(plan_json, '$.previewRetentionMs') WHERE session_id = ?",
      )
      .bind(SESSION)
      .run();
    expect(await isExpired(database, DEADLINE + PREVIEW_RETENTION_MS)).toBe(false);
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.previewRetentionMs', ?) WHERE session_id = ?",
      )
      .bind(PREVIEW_RETENTION_MS, SESSION)
      .run();
    await database.prepare("UPDATE session SET type = 'ui' WHERE id = ?").bind(SESSION).run();
    expect(await isExpired(database)).toBe(false);
  });

  test("preserves API provenance even when the Session still has a Preview label", async () => {
    const { database } = await fixture();
    await database
      .prepare("UPDATE session SET metadata_json = ? WHERE id = ?")
      .bind(JSON.stringify({ public_api: { source: "public_api" } }), SESSION)
      .run();
    expect(await isExpired(database)).toBe(false);
    await database
      .prepare("UPDATE session SET metadata_json = '{}' WHERE id = ?")
      .bind(SESSION)
      .run();
    await database
      .prepare(
        "INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, created_by_key_id, trigger, status, trace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'user_prompt', 'completed', 'test', ?, ?)",
      )
      .bind(
        PUBLIC_API_TEST_IDS.run,
        SESSION,
        PUBLIC_API_TEST_IDS.agent,
        OWNER,
        PUBLIC_API_TEST_IDS.patOwner,
        START,
        START,
      )
      .run();
    expect(await isExpired(database)).toBe(false);
  });

  test("recent failed work renews debugging; an active Run prevents cleanup even with stale Session state", async () => {
    const { database, bindings, destroyed } = await fixture();
    await database
      .prepare(
        "INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, trigger, status, trace_id, created_at, completed_at, updated_at) VALUES (?, ?, ?, ?, 'user_prompt', 'failed', 'test', ?, ?, ?)",
      )
      .bind(
        PUBLIC_API_TEST_IDS.run,
        SESSION,
        PUBLIC_API_TEST_IDS.agent,
        OWNER,
        START,
        DEADLINE - 1,
        DEADLINE - 1,
      )
      .run();
    expect(await isExpired(database)).toBe(false);
    await database
      .prepare(
        "UPDATE session_run SET status = 'running', completed_at = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(START, PUBLIC_API_TEST_IDS.run)
      .run();
    expect(await cleanupExpiredPreviewSessions(bindings, { limit: 20, nowMs: DEADLINE })).toBe(0);
    expect(destroyed()).toBe(0);
  });

  test("an admitted file survives a stale cleanup selection and renews activity after file deletion", async () => {
    const { database, bindings, destroyed } = await fixture();
    const upload = await admitUpload(database, DEADLINE - 1);
    expect(upload.admitted).toBe(true);
    expect(await deleteSessionCascade(bindings, SESSION, { expiredPreviewAtMs: DEADLINE })).toEqual(
      [],
    );
    expect(destroyed()).toBe(0);
    await database
      .app()
      .delete(fileUploadsTable)
      .where(eq(fileUploadsTable.id, upload.uploadId))
      .run();
    await database
      .app()
      .delete(fileRecordsTable)
      .where(eq(fileRecordsTable.id, upload.fileId))
      .run();
    expect(await isExpired(database)).toBe(false);
    expect(await isExpired(database, DEADLINE - 1 + PREVIEW_RETENTION_MS)).toBe(true);
  });

  test("rejects an upload at expiry without leaving either row or renewing the deadline", async () => {
    const { database } = await fixture();
    const upload = await admitUpload(database, DEADLINE);
    expect(upload.admitted).toBe(false);
    expect(
      await database
        .app()
        .select()
        .from(fileRecordsTable)
        .where(eq(fileRecordsTable.id, upload.fileId))
        .get(),
    ).toBeUndefined();
    expect(
      await database
        .app()
        .select()
        .from(fileUploadsTable)
        .where(eq(fileUploadsTable.id, upload.uploadId))
        .get(),
    ).toBeUndefined();
    expect(await isExpired(database)).toBe(true);
  });

  test("protects admitted upload leases; maintenance expiry alone is not debugging", async () => {
    const { database } = await fixture();
    const upload = await admitUpload(database, START);
    await database
      .app()
      .update(fileUploadsTable)
      .set({ expiresAt: DEADLINE + 1 })
      .where(eq(fileUploadsTable.id, upload.uploadId))
      .run();
    expect(await isExpired(database)).toBe(false);
    await database
      .app()
      .update(fileUploadsTable)
      .set({ status: "expired", updatedAt: DEADLINE })
      .where(eq(fileUploadsTable.id, upload.uploadId))
      .run();
    await database
      .app()
      .update(fileRecordsTable)
      .set({ status: "deleting", updatedAt: DEADLINE })
      .where(eq(fileRecordsTable.id, upload.fileId))
      .run();
    expect(await isExpired(database)).toBe(true);
  });

  test("file mutation admission renews once, preserves metadata, and cannot revive a claimed cleanup", async () => {
    const { database, bindings, interrupt } = await fixture();
    await database
      .prepare("UPDATE session SET metadata_json = '{\"example\":true}' WHERE id = ?")
      .bind(SESSION)
      .run();
    await admitPreviewFileActivity(database, SESSION, DEADLINE - 1);
    expect(
      await database
        .prepare(
          "SELECT json_extract(metadata_json, '$.example') AS kept FROM session WHERE id = ?",
        )
        .bind(SESSION)
        .first(),
    ).toEqual({ kept: 1 });
    interrupt(true);
    const later = DEADLINE - 1 + PREVIEW_RETENTION_MS;
    expect(await cleanupExpiredPreviewSessions(bindings, { limit: 20, nowMs: later })).toBe(0);
    await expect(admitPreviewFileActivity(database, SESSION, DEADLINE)).rejects.toThrow();
    expect((await admitUpload(database, DEADLINE)).admitted).toBe(false);
  });

  test("self-host maintenance leaves Previews alone; Cloud retries an interrupted terminal cleanup", async () => {
    const { database, bindings, interrupt, destroyed } = await fixture();
    expect(
      await cleanupExpiredPreviewSessions(
        { ...bindings, MOSOO_DEPLOYMENT_MODE: "self_hosted" },
        { limit: 20, nowMs: DEADLINE },
      ),
    ).toBe(0);
    expect(destroyed()).toBe(0);
    interrupt(true);
    expect(await cleanupExpiredPreviewSessions(bindings, { limit: 20, nowMs: DEADLINE })).toBe(0);
    expect(
      await database.prepare("SELECT status FROM session WHERE id = ?").bind(SESSION).first(),
    ).toEqual({ status: "TERMINATED" });
    interrupt(false);
    expect(
      await repairStaleSessionDeleteCleanups(bindings, {
        limit: 20,
        staleUpdatedAtLte: Date.now() + 1_000,
      }),
    ).toBe(1);
    expect(
      await database.prepare("SELECT id FROM session WHERE id = ?").bind(SESSION).first(),
    ).toBeNull();
  });
});
