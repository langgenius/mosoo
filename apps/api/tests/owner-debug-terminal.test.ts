import { describe, expect, test } from "bun:test";

import {
  SANDBOX_CACHE_PATH,
  SANDBOX_MEMORY_PATH,
  SANDBOX_SESSION_ROOT,
} from "@mosoo/agent-driver/paths";
import type { AccountId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { connectOwnerDebugTerminalWebSocket } from "../src/modules/runtime/application/owner-debug-terminal.service";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { API_ERROR_CODE } from "../src/platform/errors";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount as AccountId,
  imageUrl: null,
  name: "Owner",
};

function ownerDebugTerminalRequest(): Request {
  return new Request("https://api.example.com/api/agent/test/owner-debug-terminal/ws", {
    headers: new Headers([["Upgrade", "websocket"]]),
  });
}

interface TerminalSpy {
  createSessionCalls: { cwd?: string; id?: string }[];
  handle: SandboxHandle;
  mkdirCalls: string[];
  sessionDisposeCalls: number;
  setKeepAliveCalls: boolean[];
  subjectDisposeCalls: number;
}

function createTerminalSandboxHandleSpy(): TerminalSpy {
  const mkdirCalls: string[] = [];
  const setKeepAliveCalls: boolean[] = [];
  const createSessionCalls: { cwd?: string; id?: string }[] = [];
  let sessionDisposeCalls = 0;
  let subjectDisposeCalls = 0;
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };
  const sessionResponse = new Response("ok", { status: 200 });

  const handle = {
    activateRuntimeSubjectIncarnation: async () => {},
    configureNetworkConstraints: async () => {},
    createBackup: unavailable,
    createRuntimeSubjectBackup: unavailable,
    createSession: async (options) => {
      createSessionCalls.push({ cwd: options?.cwd, id: options?.id });
      return {
        [Symbol.dispose]: () => {
          sessionDisposeCalls++;
        },
        exec: unavailable,
        mkdir: unavailable,
        readFile: unavailable,
        startProcess: unavailable,
        terminal: async () => sessionResponse,
        watch: unavailable,
        writeFile: unavailable,
      } as unknown as Awaited<ReturnType<SandboxHandle["createSession"]>>;
    },
    deleteSession: unavailable,
    destroy: unavailable,
    destroyRuntimeSubjectIncarnation: unavailable,
    exec: unavailable,
    getSession: unavailable,
    inspectRuntimeSubjectIncarnation: unavailable,
    mkdir: async (path) => {
      mkdirCalls.push(path);
    },
    mountBucket: unavailable,
    markRuntimeSubjectIncarnationReady: async () => {},
    readFile: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: async (value) => {
      setKeepAliveCalls.push(value);
    },
    startProcess: unavailable,
    terminal: async () => sessionResponse,
    unmountBucket: unavailable,
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
    [Symbol.dispose]: () => {
      subjectDisposeCalls++;
    },
  } as unknown as SandboxHandle;

  return {
    createSessionCalls,
    handle,
    mkdirCalls,
    get sessionDisposeCalls() {
      return sessionDisposeCalls;
    },
    setKeepAliveCalls,
    get subjectDisposeCalls() {
      return subjectDisposeCalls;
    },
  };
}

describe("owner debug terminal", () => {
  test("returns an explicit conflict for Cattle agents", async () => {
    const database = await createPublicHttpContractDatabase();
    await database
      .prepare("UPDATE agent SET kind = ? WHERE id = ?")
      .bind("cattle", PUBLIC_API_TEST_IDS.agent)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expect(
      connectOwnerDebugTerminalWebSocket(bindings, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        executionContext: createTestExecutionContext(),
        request: ownerDebugTerminalRequest(),
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toMatchObject({
      code: API_ERROR_CODE.ownerDebugTerminalUnavailable,
      status: 409,
    });
  });

  test("activates the sandbox before opening the terminal session", async () => {
    const database = await createPublicHttpContractDatabase();
    const spy = createTerminalSandboxHandleSpy();
    const bindings = {
      ...createPublicHttpTestBindings(database),
      runtimeSubjectHandleFactory: () => spy.handle,
    } as unknown as ApiBindings;

    await connectOwnerDebugTerminalWebSocket(bindings, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      executionContext: createTestExecutionContext(),
      request: ownerDebugTerminalRequest(),
      viewer: OWNER_VIEWER,
    });

    expect(
      await database
        .prepare("SELECT status FROM sandbox WHERE subject_id = ?")
        .bind(PUBLIC_API_TEST_IDS.agent)
        .first(),
    ).toEqual({ status: "active" });
    expect(spy.setKeepAliveCalls).toEqual([true]);
    expect(new Set(spy.mkdirCalls)).toEqual(
      new Set([SANDBOX_CACHE_PATH, SANDBOX_MEMORY_PATH, SANDBOX_SESSION_ROOT]),
    );
    expect(spy.createSessionCalls).toHaveLength(1);
    expect(spy.createSessionCalls[0]?.cwd).toBe("/workspace");
    expect(spy.sessionDisposeCalls).toBe(1);
    expect(spy.subjectDisposeCalls).toBe(1);
  });
});
