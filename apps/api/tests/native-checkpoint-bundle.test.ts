import { afterEach, describe, expect, test } from "bun:test";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { MAX_NATIVE_CHECKPOINT_ENTRIES, parseNativeCheckpoint } from "@mosoo/agent-driver/runtime";

import {
  restoreNativeCheckpointBundle,
  verifyNativeCheckpointBundle,
} from "../src/modules/runtime/infrastructure/native-checkpoint-bundle";

const run = promisify(exec);
const checkpoint = parseNativeCheckpoint({
  formatVersion: 1,
  nativeRef: { kind: "openai_thread_id", runtimeId: "openai-runtime", value: "thread-1" },
  runId: "01J000000000000000000000G3",
});
const roots: string[] = [];
const sandbox = {
  async writeFile(path: string, content: string) {
    await writeFile(path, content);
  },
  async exec(command: string) {
    try {
      const result = await run(command);
      return { ...result, exitCode: 0, success: true };
    } catch {
      return { exitCode: 1, stderr: "verification failed", stdout: "", success: false };
    }
  },
};

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "native-checkpoint-test-"));
  roots.push(cwd);
  const bundle = join(cwd, ".state/native-checkpoints", checkpoint.runId);
  await mkdir(join(bundle, "sessions"), { recursive: true });
  const content = "last turn and tool result\n";
  await writeFile(join(bundle, "sessions/turn.jsonl"), content);
  await writeFile(
    join(bundle, "manifest.json"),
    JSON.stringify({
      ...checkpoint,
      files: [
        {
          path: "sessions/turn.jsonl",
          size: Buffer.byteLength(content),
          sha256: createHash("sha256").update(content).digest("hex"),
        },
      ],
    }),
  );
  return { cwd, bundle };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native checkpoint bundle", () => {
  test("restores the selected bundle while preserving a nonempty workspace", async () => {
    const source = await fixture();
    const destination = await fixture();
    await writeFile(join(destination.cwd, "user-work.txt"), "current edits");
    await writeFile(join(source.cwd, "user-work.txt"), "archived edits");
    let staging: string | null = null;
    await restoreNativeCheckpointBundle(
      { SANDBOX_FILE_BUCKET_LOCAL: "true" },
      {
        ...sandbox,
        async restoreBackup(backup) {
          expect(backup.id).toBe("01J000000000000000000000G4");
          expect(backup.dir).not.toBe(destination.cwd);
          expect(backup.localBucket).toBe(true);
          await access(dirname(backup.dir));
          staging = backup.dir;
          await cp(source.cwd, backup.dir, { recursive: true });
          return { dir: backup.dir, id: backup.id };
        },
      },
      { backupId: "01J000000000000000000000G4", checkpoint, cwd: destination.cwd },
    );
    expect(staging).not.toBeNull();
    await expect(access(staging!)).rejects.toThrow();
    expect(await readFile(join(destination.cwd, "user-work.txt"), "utf8")).toBe("current edits");
    expect(await readFile(join(destination.bundle, "sessions/turn.jsonl"), "utf8")).toBe(
      "last turn and tool result\n",
    );
  });

  test("rejects corrupted or unlisted native records", async () => {
    const { cwd, bundle } = await fixture();
    await writeFile(join(bundle, "sessions/turn.jsonl"), "changed");
    await expect(verifyNativeCheckpointBundle(sandbox, { checkpoint, cwd })).rejects.toThrow(
      "verification",
    );
    const extra = await fixture();
    await writeFile(join(extra.bundle, "auth.json"), "credentials");
    await expect(
      verifyNativeCheckpointBundle(sandbox, { checkpoint, cwd: extra.cwd }),
    ).rejects.toThrow("verification");
  });

  test("rejects symlinked records before reading their content", async () => {
    const { cwd, bundle } = await fixture();
    await rm(join(bundle, "sessions/turn.jsonl"));
    await symlink("/etc/passwd", join(bundle, "sessions/turn.jsonl"));
    await expect(verifyNativeCheckpointBundle(sandbox, { checkpoint, cwd })).rejects.toThrow(
      "verification",
    );
  });

  test("bounds the actual tree even when the manifest lists only one file", async () => {
    const { cwd, bundle } = await fixture();
    await Promise.all(
      Array.from({ length: MAX_NATIVE_CHECKPOINT_ENTRIES }, (_, index) =>
        mkdir(join(bundle, `empty-${index}`)),
      ),
    );
    await expect(verifyNativeCheckpointBundle(sandbox, { checkpoint, cwd })).rejects.toThrow(
      "verification",
    );
  });

  test.each(["expired", "missing archive", "wrong archive size"] as const)(
    "rejects %s before downloading or changing the current workspace",
    async (failure) => {
      const destination = await fixture();
      await writeFile(join(destination.cwd, "user-work.txt"), "current edits");
      let downloadAttempted = false;
      const bucket = {
        async get() {
          return {
            size: 100,
            async json() {
              return {
                createdAt: new Date(failure === "expired" ? 0 : Date.now()).toISOString(),
                sizeBytes: 4096,
                ttl: 3600,
              };
            },
          };
        },
        async head() {
          return failure === "missing archive" ? null : { size: 1 };
        },
      } as unknown as R2Bucket;
      await expect(
        restoreNativeCheckpointBundle(
          {
            SANDBOX_FILE_BUCKET_LOCAL: "false",
            BACKUP_BUCKET: bucket,
            BACKUP_BUCKET_NAME: "backup",
            CLOUDFLARE_ACCOUNT_ID: "account",
            R2_ACCESS_KEY_ID: "key",
            R2_SECRET_ACCESS_KEY: "secret",
          },
          {
            ...sandbox,
            async writeFile() {
              downloadAttempted = true;
            },
            async restoreBackup() {
              throw new Error("Production restore must not create a shared SDK mount.");
            },
          },
          { backupId: "01J000000000000000000000G4", checkpoint, cwd: destination.cwd },
        ),
      ).rejects.toThrow("Native checkpoint backup");
      expect(downloadAttempted).toBe(false);
      expect(await readFile(join(destination.cwd, "user-work.txt"), "utf8")).toBe("current edits");
    },
  );
});
