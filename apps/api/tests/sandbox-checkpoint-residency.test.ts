import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { getRuntimeKindPolicy } from "../src/modules/runtime/domain/runtime-kind-policy";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import { createSandboxCheckpoints } from "../src/modules/runtime/infrastructure/sandbox-backup.service";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS as ids,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";

const cwd = `/workspace/se/${ids.ownerSession}`;
const priorPlatformId = "550e8400-e29b-41d4-a716-446655440001";
const priorId = encodeSandboxBackupIdForStorage(priorPlatformId);
const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mosoo-checkpoint-residency-"));
  roots.push(root);
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  database.execute(`
    UPDATE session SET kind = 'pet', last_message_at = 1, status = 'IDLE'
    WHERE id = '${ids.ownerSession}';
    INSERT INTO sandbox (id, kind, subject_kind, subject_id, status, bind_mount_ready,
      global_mounts_json, created_at, updated_at)
    VALUES ('${ids.sandbox}', 'pet', 'agent', '${ids.agent}', 'backing_up', 1, '[]', 1, 1);
    INSERT INTO sandbox_session (cloudflare_session_id, created_at, cwd, origin_json,
      sandbox_id, session_id, status, updated_at)
    VALUES ('01J0000000000000000000000Z', 1, '${cwd}', '{}',
      '${ids.sandbox}', '${ids.ownerSession}', 'closed', 1);
    INSERT INTO sandbox_backup (created_at, dir, id, keep, sandbox_id, status, ttl_seconds, updated_at)
    VALUES (1, '${cwd}', '${priorId}', 0, '${ids.sandbox}', 'ready', 315360000, 1);
  `);
  const path = (dir: string) => join(root, dir);
  const archive = (id: string) => join(root, "archives", id);
  await mkdir(archive(priorPlatformId), { recursive: true });
  await writeFile(join(archive(priorPlatformId), "private.txt"), "original Session work");
  const createdDirs: string[] = [];
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected sandbox method in checkpoint residency test.");
  };
  const sandbox: SandboxHandle = {
    configureNetworkConstraints: unavailable,
    async createBackup({ dir }) {
      const id = crypto.randomUUID();
      await cp(path(dir), archive(id), { recursive: true, verbatimSymlinks: true });
      createdDirs.push(dir);
      return { dir, id };
    },
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: unavailable,
    ensureContainerReady: unavailable,
    async exec(command) {
      try {
        const result = await execFileAsync("sh", [
          "-c",
          command.replaceAll("/workspace", path("/workspace")),
        ]);
        return { ...result, success: true, exitCode: 0 };
      } catch (error) {
        if (!(error instanceof Error) || !("stderr" in error) || typeof error.stderr !== "string") {
          throw error;
        }
        return { stdout: "", stderr: error.stderr, success: false, exitCode: 1 };
      }
    },
    getSession: unavailable,
    async mkdir(dir, options) {
      await mkdir(path(dir), options);
    },
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: unavailable,
    startProcess: unavailable,
    terminal: unavailable,
    unmountBucket: async () => {},
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
  };
  const bindings = {
    ...createPublicHttpTestBindings(database),
    runtimeSubjectHandleFactory: () => sandbox,
    SANDBOX_STATE_BUCKET: {
      async delete(keys: string[]) {
        for (const key of keys) {
          const [, id] = key.split("/");
          if (id) await rm(archive(id), { recursive: true, force: true });
        }
      },
    },
  } as unknown as ApiBindings;
  return { archive, bindings, createdDirs, database, path };
}

async function checkpoint(f: Awaited<ReturnType<typeof fixture>>) {
  await createSandboxCheckpoints(f.bindings, {
    rules: getRuntimeKindPolicy("pet").checkpoint.createOnHibernate,
    sandboxId: ids.sandbox,
  });
}

describe("checkpoint residency", () => {
  test("keeps a cold Session's real checkpoint through repeated shared-subject reclamation", async () => {
    const f = await fixture();
    // A different Session can reactivate the shared machine without restoring
    // this closed Session's directory. Hibernate must not replace its archive.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await checkpoint(f);
      await rm(f.path("/workspace"), { recursive: true, force: true });
    }
    const prior = await f.database
      .prepare("SELECT status FROM sandbox_backup WHERE id = ?")
      .bind(priorId)
      .first<{ status: string }>();
    expect(prior?.status).toBe("ready");
    const latest = await f.database
      .prepare(
        "SELECT id FROM sandbox_backup WHERE sandbox_id = ? AND dir = ? AND status = 'ready' ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .bind(ids.sandbox, cwd)
      .first<{ id: string }>();
    expect(latest?.id).toBe(priorId);
    expect(f.createdDirs).not.toContain(cwd);
    expect(await readFile(join(f.archive(priorPlatformId), "private.txt"), "utf8")).toBe(
      "original Session work",
    );
  });

  test("still checkpoints a closed Session whose working files are resident", async () => {
    const f = await fixture();
    await mkdir(f.path(cwd), { recursive: true });
    await writeFile(join(f.path(cwd), "private.txt"), "new resident work");
    await checkpoint(f);
    expect(f.createdDirs).toContain(cwd);
  });

  test.each(["active", "running", "no prior checkpoint", "newer input"])(
    "does not silently skip a missing workspace with %s",
    async (condition) => {
      const f = await fixture();
      if (condition === "active") {
        f.database.execute("UPDATE sandbox_session SET status = 'active'");
      } else if (condition === "running") {
        f.database.execute("UPDATE session SET status = 'RUNNING'");
      } else if (condition === "no prior checkpoint") {
        f.database.execute("DELETE FROM sandbox_backup");
      } else {
        f.database.execute("UPDATE session SET last_message_at = 2");
      }
      await expect(checkpoint(f)).rejects.toThrow("checkpoint");
      expect(f.createdDirs).not.toContain(cwd);
      const count = await f.database
        .prepare("SELECT COUNT(*) AS count FROM sandbox_backup WHERE created_at > 1")
        .first<{ count: number }>();
      expect(count?.count).toBe(0);
    },
  );

  test("does not prune an unchanged directory when another checkpoint is created", async () => {
    const f = await fixture();
    for (let time = 2; time <= 4; time += 1) {
      await f.database
        .prepare(
          "INSERT INTO sandbox_backup (created_at, dir, id, keep, sandbox_id, status, ttl_seconds, updated_at) VALUES (?, ?, ?, 0, ?, 'ready', 315360000, ?)",
        )
        .bind(time, cwd, encodeSandboxBackupIdForStorage(crypto.randomUUID()), ids.sandbox, time)
        .run();
    }
    await checkpoint(f);
    const retained = await f.database
      .prepare("SELECT COUNT(*) AS count FROM sandbox_backup WHERE dir = ? AND status = 'ready'")
      .bind(cwd)
      .first<{ count: number }>();
    expect(retained?.count).toBe(4);
    expect(f.createdDirs).toEqual(["/workspace/memory"]);
    expect(await readFile(join(f.archive(priorPlatformId), "private.txt"), "utf8")).toBe(
      "original Session work",
    );
  });

  test("does not mistake an invalid workspace path for a safely absent one", async () => {
    const f = await fixture();
    await mkdir(f.path("/workspace/se"), { recursive: true });
    await symlink(f.path("/missing-target"), f.path(cwd));
    await expect(checkpoint(f)).rejects.toThrow("checkpoint");
    expect(f.createdDirs).not.toContain(cwd);
  });

  test("does not skip the required workspace of an explicit checkpoint", async () => {
    const f = await fixture();
    await expect(
      createSandboxCheckpoints(f.bindings, {
        requiredSessionId: ids.ownerSession,
        rules: getRuntimeKindPolicy("pet").checkpoint.createOnHibernate,
        sandboxId: ids.sandbox,
      }),
    ).rejects.toThrow("checkpoint");
  });
});
