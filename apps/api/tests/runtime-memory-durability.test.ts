import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { DriverProfileConfig } from "../src/modules/runtime/domain/driver-snapshot";
import { ensureRuntimeMemoryMounts } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-files.service";
import { prepareRuntimeSessionWorkspaceCheckpoint } from "../src/modules/runtime/infrastructure/sandbox-backup-platform";
import type { ExecutionSessionHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import { createDriverProfile } from "./api-driver-boundary-fixtures";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mosoo-memory-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  const base = createDriverProfile();
  const profile: DriverProfileConfig = {
    ...base,
    session: { ...base.session, homePath: "/workspace/se/fixture/.state/openai-runtime" },
  };
  const home = join(root, profile.session.homePath);
  const memory = join(home, "memories");
  const shared = join(workspace, "memory/openai-runtime/memories");
  // Execute the provisioning shell against real files, confined to this fixture.
  const session: Pick<ExecutionSessionHandle, "exec"> = {
    async exec(command) {
      try {
        const result = await execFileAsync("sh", [
          "-c",
          command.replaceAll("/workspace", workspace),
        ]);
        return { ...result, success: true, exitCode: 0 };
      } catch (error) {
        if (!(error instanceof Error) || !("stderr" in error) || typeof error.stderr !== "string") {
          throw error;
        }
        return { stdout: "", stderr: error.stderr, success: false, exitCode: 1 };
      }
    },
  };
  return { root, workspace, home, memory, shared, session, profile };
}

describe("Session runtime memory durability", () => {
  test("keeps new memory inside the checkpoint and preserves it after a cold copy", async () => {
    const f = await fixture();
    await ensureRuntimeMemoryMounts(f.session, f.profile);
    expect((await lstat(f.memory)).isSymbolicLink()).toBe(false);
    await writeFile(join(f.memory, "prior-work.md"), "Keep the original private working context.");
    const checkpoint = join(f.root, "checkpoint");
    await cp(join(f.workspace, "se"), checkpoint, { recursive: true, verbatimSymlinks: true });
    await rm(f.workspace, { recursive: true });
    await mkdir(f.workspace);
    await cp(checkpoint, join(f.workspace, "se"), { recursive: true, verbatimSymlinks: true });
    await ensureRuntimeMemoryMounts(f.session, f.profile);
    expect(await readFile(join(f.memory, "prior-work.md"), "utf8")).toBe(
      "Keep the original private working context.",
    );
    expect((await lstat(f.memory)).isSymbolicLink()).toBe(false);
  });

  test("preserves a restored memory directory without replacing it with shared state", async () => {
    const f = await fixture();
    await mkdir(f.memory, { recursive: true });
    await mkdir(f.shared, { recursive: true });
    await writeFile(join(f.memory, "private.md"), "this Session");
    await writeFile(join(f.shared, "other.md"), "another Session");
    await ensureRuntimeMemoryMounts(f.session, f.profile);
    expect(await readFile(join(f.memory, "private.md"), "utf8")).toBe("this Session");
    expect(await Bun.file(join(f.memory, "other.md")).exists()).toBe(false);
    expect(await readFile(join(f.shared, "other.md"), "utf8")).toBe("another Session");
  });

  for (const sourceExists of [true, false]) {
    test(`preserves and rejects an unconverted legacy memory link (source exists: ${sourceExists})`, async () => {
      const f = await fixture();
      await mkdir(f.home, { recursive: true });
      if (sourceExists) {
        await mkdir(f.shared, { recursive: true });
        await writeFile(join(f.shared, "original.md"), "Unassigned shared memory");
      }
      await symlink(f.shared, f.memory);
      await expect(ensureRuntimeMemoryMounts(f.session, f.profile)).rejects.toThrow(
        "Legacy runtime memory requires verified migration",
      );
      expect(await readlink(f.memory)).toBe(f.shared);
      if (sourceExists) {
        expect(await readFile(join(f.shared, "original.md"), "utf8")).toBe(
          "Unassigned shared memory",
        );
      } else {
        expect(await Bun.file(join(f.shared, "original.md")).exists()).toBe(false);
      }
    });
  }

  test("refuses checkpoint commit when a warm runtime still has unconverted memory", async () => {
    const f = await fixture();
    await mkdir(f.home, { recursive: true });
    await mkdir(f.shared, { recursive: true });
    await writeFile(join(f.shared, "original.md"), "Unassigned shared memory");
    await symlink(f.shared, f.memory);
    await expect(
      prepareRuntimeSessionWorkspaceCheckpoint(
        { ...f.session, async unmountBucket() {} },
        { cwd: "/workspace/se/fixture", sessionId: "fixture" },
      ),
    ).rejects.toThrow("Legacy runtime memory requires verified migration");
    expect(await readlink(f.memory)).toBe(f.shared);
    expect(await readFile(join(f.shared, "original.md"), "utf8")).toBe("Unassigned shared memory");
  });

  test("keeps isolated memory while removing ephemeral credentials for checkpoint commit", async () => {
    const f = await fixture();
    await mkdir(f.memory, { recursive: true });
    await writeFile(join(f.memory, "private.md"), "durable");
    await writeFile(join(f.home, "auth.json"), "ephemeral fixture credential");
    await prepareRuntimeSessionWorkspaceCheckpoint(
      { ...f.session, async unmountBucket() {} },
      { cwd: "/workspace/se/fixture", sessionId: "fixture" },
    );
    expect(await readFile(join(f.memory, "private.md"), "utf8")).toBe("durable");
    expect(await Bun.file(join(f.home, "auth.json")).exists()).toBe(false);
  });

  test("retains the original shared memory binding until its subject is migrated", async () => {
    const f = await fixture();
    const profile: DriverProfileConfig = {
      ...f.profile,
      kind: "pet",
      sandbox: { ...f.profile.sandbox, kind: "pet", subjectKind: "agent" },
    };
    await ensureRuntimeMemoryMounts(f.session, profile);
    await writeFile(join(f.shared, "original.md"), "legacy memory");
    await ensureRuntimeMemoryMounts(f.session, profile);
    expect(await readlink(f.memory)).toBe(f.shared);
    expect(await readFile(join(f.memory, "original.md"), "utf8")).toBe("legacy memory");
  });
});
