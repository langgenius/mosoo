import { describe, expect, test } from "bun:test";

import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";

import {
  createRuntimeSpaceObjectKey,
  joinRuntimeSandboxSpacePath,
  resolveRuntimeSpacePath,
} from "../src/modules/runtime/infrastructure/runtime-space-paths";
import { ensureRuntimeSpaceMounts } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-space-mounts";
import type {
  ExecutionSessionHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import { syncSandboxSpaceTreesToCanonical } from "../src/modules/runtime/infrastructure/sandbox-space-file-sync.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

type RuntimeMountTestBindings = Pick<
  ApiBindings,
  "CLOUDFLARE_ACCOUNT_ID" | "FILE_BUCKET_NAME" | "SANDBOX_FILE_BUCKET_LOCAL"
>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Condition was not reached.");
}

function createAlias(spaceId: string): SpaceAliasBinding {
  return {
    aliasPath: `/spaces/${spaceId}`,
    globalMountPath: `/mnt/${spaceId}`,
    spaceId,
    spaceName: spaceId,
  };
}

function createExecutionSessionHandle(execCommands: string[]): ExecutionSessionHandle {
  return {
    exec: async (command: string) => {
      execCommands.push(command);
      return {
        exitCode: 0,
        stderr: "",
        stdout: "",
        success: true,
      };
    },
    mkdir: async () => {},
    readFile: async () => {
      throw new Error("readFile is not used in runtime space mount tests.");
    },
    startProcess: async () => {
      throw new Error("startProcess is not used in runtime space mount tests.");
    },
    watch: async () => new ReadableStream<Uint8Array>(),
    writeFile: async () => {},
  };
}

describe("runtime space mounts", () => {
  test("resolves runtime space paths through the Space file path owner", () => {
    const aliases = [createAlias("space-a")];

    expect(resolveRuntimeSpacePath(aliases, "/mnt/space-a/docs/notes.txt")).toEqual({
      relativePath: "docs/notes.txt",
      spaceId: "space-a",
    });
    expect(resolveRuntimeSpacePath(aliases, "/spaces/space-a/docs/notes.txt")).toEqual({
      relativePath: "docs/notes.txt",
      spaceId: "space-a",
    });
    expect(resolveRuntimeSpacePath(aliases, "/mnt/space-a")).toEqual({
      relativePath: "",
      spaceId: "space-a",
    });
    expect(resolveRuntimeSpacePath(aliases, "/workspace/docs/notes.txt")).toBeNull();

    for (const path of [
      "/mnt/space-a/docs//notes.txt",
      "/mnt/space-a/docs/../notes.txt",
      "/mnt/space-a/docs/%2f/notes.txt",
      String.raw`/mnt/space-a/docs\notes.txt`,
      "/mnt/space-a/docs/notes.txt/",
      "/mnt/space-a/docs/notes.txt ",
    ]) {
      expect(() => resolveRuntimeSpacePath(aliases, path)).toThrow(
        "Runtime Space file path must be normalized before sync.",
      );
    }

    expect(() =>
      resolveRuntimeSpacePath(
        [
          {
            ...createAlias("space-a"),
            globalMountPath: "/mnt/space-a/..",
          },
        ],
        "/mnt/space-a/../docs/../notes.txt",
      ),
    ).toThrow("Runtime Space mount path must not contain traversal segments.");
  });

  test("apps runtime space paths only after canonical admission", () => {
    expect(
      createRuntimeSpaceObjectKey({
        relativePath: "docs/notes.txt",
        spaceId: "space-a",
      }),
    ).toBe("space/space-a/docs/notes.txt");
    expect(joinRuntimeSandboxSpacePath("/mnt/space-a", "docs/notes.txt")).toBe(
      "/mnt/space-a/docs/notes.txt",
    );

    for (const relativePath of [
      "",
      "/docs/notes.txt",
      "docs/notes.txt ",
      "docs/../notes.txt",
      String.raw`docs\notes.txt`,
    ]) {
      expect(() =>
        createRuntimeSpaceObjectKey({
          relativePath,
          spaceId: "space-a",
        }),
      ).toThrow("Runtime Space file path must be normalized before projection.");
      expect(() => joinRuntimeSandboxSpacePath("/mnt/space-a", relativePath)).toThrow(
        "Runtime Space file path must be normalized before projection.",
      );
    }

    expect(() => joinRuntimeSandboxSpacePath("/mnt/space-a/..", "docs/../notes.txt")).toThrow(
      "Runtime Space mount path must not contain traversal segments.",
    );
  });

  test("rejects unsafe runtime Space mount roots before sandbox listing", async () => {
    await expect(
      syncSandboxSpaceTreesToCanonical({
        bindings: {
          DB: {} as D1Database,
          FILE_BUCKET: {
            delete: async () => {},
            get: async () => null,
            put: async () => null,
          },
        },
        executionOwnerUserId: "user-1",
        sandbox: createExecutionSessionHandle([]),
        spaceAliases: [
          {
            ...createAlias("space-a"),
            globalMountPath: "/mnt/space-a/..",
          },
        ],
      }),
    ).rejects.toThrow("Runtime Space mount path must not contain traversal segments.");
  });

  test("starts independent cold space mounts before awaiting the first mount", async () => {
    const mountPromises: Deferred<void>[] = [];
    const mountedPaths: string[] = [];
    const succeeded: string[] = [];
    const subject: SandboxHandle = {
      async createBackup() {
        return { dir: "/backup", id: "backup-1" };
      },
      async createSession() {
        throw new Error("createSession is not used in runtime space mount tests.");
      },
      async deleteSession() {
        return { sessionId: "session-1", success: true, timestamp: new Date(0).toISOString() };
      },
      async destroy() {},
      exec: async () => {
        return {
          exitCode: 0,
          stderr: "",
          stdout: "",
          success: true,
        };
      },
      async getSession() {
        throw new Error("getSession is not used in runtime space mount tests.");
      },
      mkdir: async () => {},
      mountBucket: async (_bucket: string, path: string) => {
        const deferred = createDeferred<void>();
        mountPromises.push(deferred);
        mountedPaths.push(path);
        await deferred.promise;
      },
      async readFile() {
        return { content: "", encoding: "utf8" };
      },
      async restoreBackup(backup) {
        return backup;
      },
      async setKeepAlive() {},
      async startProcess() {
        throw new Error("startProcess is not used in runtime space mount tests.");
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
    const aliases = [createAlias("space-a"), createAlias("space-b")];
    const mountedSpaceIds = new Set<string>();
    const bindings = {
      CLOUDFLARE_ACCOUNT_ID: "account",
      FILE_BUCKET_NAME: "bucket",
      SANDBOX_FILE_BUCKET_LOCAL: "false",
    } satisfies RuntimeMountTestBindings;
    const mounting = ensureRuntimeSpaceMounts({
      bindings: bindings as ApiBindings,
      isCold: true,
      localBucket: false,
      mountedSpaceIds,
      onMountSucceeded: async (alias) => {
        succeeded.push(alias.spaceId);
      },
      spaceAliases: aliases,
      subject,
    });

    await waitFor(() => mountedPaths.length === 2);

    expect(mountedPaths).toEqual(["/mnt/space-a", "/mnt/space-b"]);
    expect(succeeded).toEqual([]);

    for (const deferred of mountPromises) {
      deferred.resolve(undefined);
    }

    await mounting;

    expect([...mountedSpaceIds].toSorted()).toEqual(["space-a", "space-b"]);
    expect(succeeded.toSorted()).toEqual(["space-a", "space-b"]);
  });
});
