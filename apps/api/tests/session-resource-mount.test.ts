import { describe, expect, test } from "bun:test";

import type { RuntimeSandboxBucketMountOptions } from "../src/modules/runtime/infrastructure/runtime-sandbox-bucket-mount";
import type {
  RuntimeCommandResultHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import { ensureSessionResourcesMounted } from "../src/modules/runtime/infrastructure/session-resources/session-resource-mount.service";
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

function createBindings(input: { localBucket: boolean }): ApiBindings {
  const bindings = {
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    FILE_BUCKET_NAME: "mosoo-file",
    SANDBOX_FILE_BUCKET_LOCAL: input.localBucket ? "true" : "false",
  } satisfies RuntimeMountTestBindings;

  return bindings as ApiBindings;
}

function createSandbox(input: {
  pathExists: boolean | readonly boolean[];
  onMountBucket?: (
    bucket: string,
    mountPath: string,
    options: RuntimeSandboxBucketMountOptions,
  ) => Promise<void>;
}): SandboxHandle & {
  readonly calls: {
    exec: string[];
    mkdir: string[];
    mountBucket: {
      bucket: string;
      mountPath: string;
      options: RuntimeSandboxBucketMountOptions;
    }[];
  };
} {
  const calls = {
    exec: [] as string[],
    mkdir: [] as string[],
    mountBucket: [] as {
      bucket: string;
      mountPath: string;
      options: RuntimeSandboxBucketMountOptions;
    }[],
  };

  const probes = typeof input.pathExists === "boolean" ? [input.pathExists] : input.pathExists;

  return {
    calls,
    async configureNetworkConstraints() {},
    async createBackup() {
      return { dir: "/backup", id: "backup-1" };
    },
    async createSession() {
      throw new Error("createSession is not used in session resource mount tests.");
    },
    async deleteSession() {
      return { sessionId: "session-1", success: true, timestamp: new Date(0).toISOString() };
    },
    async destroy() {},
    async exec(command) {
      calls.exec.push(command);
      return commandResult(probes[Math.min(calls.exec.length, probes.length) - 1] ?? false);
    },
    async getSession() {
      throw new Error("getSession is not used in session resource mount tests.");
    },
    async mkdir(path) {
      calls.mkdir.push(path);
    },
    async mountBucket(bucket, mountPath, options) {
      calls.mountBucket.push({ bucket, mountPath, options });
      await input.onMountBucket?.(bucket, mountPath, options);
    },
    async readFile() {
      return { content: "", encoding: "utf8" };
    },
    async restoreBackup(backup) {
      return backup;
    },
    async setKeepAlive() {},
    async ensureContainerReady() {},
    async startProcess() {
      throw new Error("startProcess is not used in session resource mount tests.");
    },
    async unmountBucket() {
      throw new Error("unmountBucket is not used in session resource mount tests.");
    },
    async writeFile() {},
  };
}

describe("ensureSessionResourcesMounted", () => {
  test("does not remount an existing local session resource path", async () => {
    const sandbox = createSandbox({ pathExists: true });

    await ensureSessionResourcesMounted({
      bindings: createBindings({ localBucket: true }),
      sandbox,
      sessionId: "session-local",
    });

    expect(sandbox.calls.exec).toHaveLength(1);
    expect(sandbox.calls.mkdir).toEqual([]);
    expect(sandbox.calls.mountBucket).toEqual([]);
  });

  test("mounts remote bucket when mountpoint probe is not ready", async () => {
    const sandbox = createSandbox({ pathExists: false });

    await ensureSessionResourcesMounted({
      bindings: createBindings({ localBucket: false }),
      sandbox,
      sessionId: "session-remote",
    });

    expect(sandbox.calls.exec).toHaveLength(1);
    expect(sandbox.calls.mkdir).toHaveLength(1);
    expect(sandbox.calls.mountBucket).toHaveLength(1);
    expect(sandbox.calls.mountBucket[0]).toEqual({
      bucket: "mosoo-file",
      mountPath: sandbox.calls.mkdir[0],
      options: {
        credentialProxy: true,
        endpoint: "https://account-1.r2.cloudflarestorage.com",
        localBucket: false,
        prefix: "/session/session-remote/attachment/",
        provider: "r2",
        readOnly: true,
      },
    });
  });

  test("accepts a concurrent remote mount that became ready", async () => {
    const sandbox = createSandbox({
      onMountBucket: async (_bucket, mountPath) => {
        throw new Error(`InvalidMountConfigError: Mount path "${mountPath}" is already in use.`);
      },
      pathExists: [false, true],
    });

    await ensureSessionResourcesMounted({
      bindings: createBindings({ localBucket: false }),
      sandbox,
      sessionId: "session-remote",
    });

    expect(sandbox.calls.exec).toHaveLength(2);
    expect(sandbox.calls.mountBucket.map((call) => call.mountPath)).toEqual(sandbox.calls.mkdir);
  });

  test("surfaces a failed remote mount when the path is still not mounted", async () => {
    const sandbox = createSandbox({
      onMountBucket: async (_bucket, mountPath) => {
        throw new Error(`InvalidMountConfigError: Mount path "${mountPath}" is already in use.`);
      },
      pathExists: false,
    });

    await expect(
      ensureSessionResourcesMounted({
        bindings: createBindings({ localBucket: false }),
        sandbox,
        sessionId: "session-remote",
      }),
    ).rejects.toThrow("is already in use");

    expect(sandbox.calls.exec).toHaveLength(2);
    expect(sandbox.calls.mountBucket).toHaveLength(1);
  });
});
