import { describe, expect, test } from "bun:test";

import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";

import type { RuntimeSandboxBucketMountOptions } from "../src/modules/runtime/infrastructure/runtime-sandbox-bucket-mount";
import { RuntimeSpaceMountConflictError } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-space-mount-platform";
import { ensureRuntimeSpaceMounts } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-space-mounts";
import type {
  RuntimeCommandResultHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

type RuntimeMountTestBindings = Pick<
  ApiBindings,
  "CLOUDFLARE_ACCOUNT_ID" | "FILE_BUCKET_NAME" | "SANDBOX_FILE_BUCKET_LOCAL"
>;

function commandResult(success: boolean): RuntimeCommandResultHandle {
  return {
    exitCode: success ? 0 : 1,
    stderr: "",
    stdout: "",
    success,
  };
}

function createBindings(): ApiBindings {
  const bindings = {
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    FILE_BUCKET_NAME: "mosoo-file",
    SANDBOX_FILE_BUCKET_LOCAL: "false",
  } satisfies RuntimeMountTestBindings;

  return bindings as ApiBindings;
}

function createSpaceAlias(spaceId: string): SpaceAliasBinding {
  return {
    aliasPath: `/workspace/se/session-1/space/${spaceId}`,
    globalMountPath: `/organization/sp/${spaceId}`,
    spaceId,
    spaceName: spaceId,
  };
}

function createSandbox(input?: {
  globalMountReady?: boolean;
  onMountBucket?: (
    bucket: string,
    mountPath: string,
    options: RuntimeSandboxBucketMountOptions,
  ) => Promise<void>;
}): SandboxHandle {
  return {
    async createBackup() {
      return { dir: "/backup", id: "backup-1" };
    },
    async createSession() {
      throw new Error("createSession is not used in sandbox lifecycle mount tests.");
    },
    async deleteSession() {
      return { sessionId: "session-1", success: true, timestamp: new Date(0).toISOString() };
    },
    async destroy() {},
    async exec() {
      return commandResult(input?.globalMountReady ?? true);
    },
    async getSession() {
      throw new Error("getSession is not used in sandbox lifecycle mount tests.");
    },
    async mkdir() {},
    async mountBucket(bucket, mountPath, options) {
      await input?.onMountBucket?.(bucket, mountPath, options);
    },
    async readFile() {
      return { content: "", encoding: "utf8" };
    },
    async restoreBackup(backup) {
      return backup;
    },
    async setKeepAlive() {},
    async startProcess() {
      throw new Error("startProcess is not used in sandbox lifecycle mount tests.");
    },
    async terminal() {
      return new Response();
    },
    async watch() {
      return new ReadableStream<Uint8Array>();
    },
    async writeFile() {},
    async wsConnect() {
      return new Response(null, { status: 101 });
    },
  };
}

describe("ensureRuntimeSpaceMounts", () => {
  test("does not remount a remote space already recorded on an active sandbox", async () => {
    const sandbox = createSandbox();
    const mountedSpaceIds = new Set(["space-1"]);

    await ensureRuntimeSpaceMounts({
      bindings: createBindings(),
      isCold: false,
      localBucket: false,
      mountedSpaceIds,
      spaceAliases: [createSpaceAlias("space-1")],
      subject: sandbox,
    });

    expect([...mountedSpaceIds]).toEqual(["space-1"]);
  });

  test("accepts an already mounted remote space for the same bucket prefix", async () => {
    const sandbox = createSandbox({
      onMountBucket: async (bucket, _mountPath, options) => {
        throw new Error(`mount path already in use by bucket "${bucket}:${options.prefix}"`);
      },
    });
    const mountedSpaceIds = new Set<string>();

    await ensureRuntimeSpaceMounts({
      bindings: createBindings(),
      isCold: true,
      localBucket: false,
      mountedSpaceIds,
      spaceAliases: [createSpaceAlias("space-1")],
      subject: sandbox,
    });

    expect([...mountedSpaceIds]).toEqual(["space-1"]);
  });

  test("rejects a remote space mount conflict for a different bucket prefix", async () => {
    const sandbox = createSandbox({
      globalMountReady: false,
      onMountBucket: async (bucket) => {
        throw new Error(`mount path already in use by bucket "${bucket}:/space/other/"`);
      },
    });

    await expect(
      ensureRuntimeSpaceMounts({
        bindings: createBindings(),
        isCold: true,
        localBucket: false,
        mountedSpaceIds: new Set<string>(),
        spaceAliases: [createSpaceAlias("space-1")],
        subject: sandbox,
      }),
    ).rejects.toBeInstanceOf(RuntimeSpaceMountConflictError);
  });
});
