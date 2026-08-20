import { describe, expect, test } from "bun:test";

import { sandboxSessionsTable, sandboxesTable, sessionsTable } from "@mosoo/db";
import type { AccountId, SessionId } from "@mosoo/id";

import { fileStore } from "../src/modules/files/application/file-store";
import type {
  ExecutionSessionHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import { ensureSandboxConversationSession } from "../src/modules/runtime/infrastructure/sandbox-session/sandbox-conversation-session.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const SESSION_CWD = "/workspace/session";
const OTHER_SESSION_ID = "01J000000000000000000000Z1" as SessionId;
const PRIOR_SANDBOX_SESSION_ID = "01J000000000000000000000Z2";
const ORIGIN = {
  callerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
  entrypoint: "api",
  executionOwnerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
  type: "agent",
} as const;

interface CapturedFileWrite {
  content: string;
  encoding: string | undefined;
}

function decodeBase64(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0));
}

function createContinuationSandbox(): {
  mkdirs: string[];
  sandbox: SandboxHandle;
  writes: Map<string, CapturedFileWrite>;
} {
  const mkdirs: string[] = [];
  const writes = new Map<string, CapturedFileWrite>();
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };
  const executionSession: ExecutionSessionHandle = {
    exec: unavailable,
    mkdir: unavailable,
    readFile: unavailable,
    startProcess: unavailable,
    watch: unavailable,
    writeFile: unavailable,
  };

  return {
    mkdirs,
    sandbox: {
      configureNetworkConstraints: unavailable,
      createBackup: unavailable,
      createSession: async () => executionSession,
      deleteSession: unavailable,
      destroy: unavailable,
      exec: unavailable,
      getSession: async () => executionSession,
      async mkdir(path) {
        mkdirs.push(path);
      },
      mountBucket: unavailable,
      readFile: unavailable,
      restoreBackup: unavailable,
      setKeepAlive: unavailable,
      startProcess: unavailable,
      terminal: unavailable,
      watch: unavailable,
      async writeFile(path, content, options) {
        writes.set(path, { content, encoding: options?.encoding });
      },
      wsConnect: unavailable,
    },
    writes,
  };
}

async function createContinuationFixture(): Promise<{
  bindings: ApiBindings;
  bucket: PublicApiMemoryFileBucket;
  database: SqliteD1Database;
}> {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  const bucket = new PublicApiMemoryFileBucket();
  const bindings = createPublicHttpTestBindings(database, {
    fileBucket: bucket as unknown as R2Bucket,
  }) as ApiBindings;
  const nowMs = nowMsForTest();

  await database
    .app()
    .insert(sandboxesTable)
    .values({
      createdAt: nowMs,
      id: PUBLIC_API_TEST_IDS.sandbox,
      kind: "cattle",
      status: "active",
      subjectId: PUBLIC_API_TEST_IDS.ownerSession,
      subjectKind: "session",
      updatedAt: nowMs,
    })
    .run();
  await database
    .app()
    .insert(sessionsTable)
    .values({
      agentId: PUBLIC_API_TEST_IDS.agent,
      appId: PUBLIC_API_TEST_IDS.app,
      createdAt: nowMs,
      creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      id: OTHER_SESSION_ID,
      kind: "cattle",
      model: "model-1",
      provider: "provider-1",
      renamed: false,
      runtimeId: "claude-agent-sdk",
      status: "IDLE",
      title: "Other thread",
      updatedAt: nowMs,
    })
    .run();

  return { bindings, bucket, database };
}

async function insertClosedConversation(database: SqliteD1Database): Promise<void> {
  await database
    .app()
    .insert(sandboxSessionsTable)
    .values({
      createdAt: nowMsForTest(),
      cwd: SESSION_CWD,
      originJson: JSON.stringify(ORIGIN),
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sandboxSessionId: PRIOR_SANDBOX_SESSION_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      status: "closed",
      updatedAt: nowMsForTest(),
    })
    .run();
}

async function recordArtifact(
  bindings: ApiBindings,
  input: {
    body: string;
    path: string;
    sessionId?: SessionId;
  },
): Promise<void> {
  await fileStore.recordRuntimeOutput({
    bindings,
    body: new TextEncoder().encode(input.body),
    contentType: "text/plain",
    createdBy: PUBLIC_API_TEST_IDS.ownerAccount as AccountId,
    path: input.path,
    sessionId: input.sessionId ?? (PUBLIC_API_TEST_IDS.ownerSession as SessionId),
  });
}

describe("recycled cattle sandbox continuation", () => {
  test("restores the latest ready artifacts into the fresh session workspace", async () => {
    const { bindings, database } = await createContinuationFixture();

    // Run 1 records artifacts, including two content versions of one path.
    await recordArtifact(bindings, {
      body: "<html>v1</html>",
      path: "outputs/presentation/index.html",
    });
    await recordArtifact(bindings, {
      body: "<html>v2</html>",
      path: "outputs/presentation/index.html",
    });
    await recordArtifact(bindings, { body: "notes v1", path: "outputs/notes.md" });
    // Another thread's artifact must never leak into this session workspace.
    await recordArtifact(bindings, {
      body: "other thread",
      path: "outputs/other.txt",
      sessionId: OTHER_SESSION_ID,
    });

    // The terminal run released the sandbox and the recycle sweep closed the
    // conversation; only control-plane records remain.
    await insertClosedConversation(database);

    const { mkdirs, sandbox, writes } = createContinuationSandbox();
    const result = await ensureSandboxConversationSession(bindings, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      kind: "cattle",
      mountSessionResources: false,
      origin: ORIGIN,
      sandbox,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });

    expect(result.sandboxSessionId).not.toBe(PRIOR_SANDBOX_SESSION_ID);
    expect(result.cwd).toBe(SESSION_CWD);

    expect([...writes.keys()].toSorted()).toEqual([
      `${SESSION_CWD}/outputs/notes.md`,
      `${SESSION_CWD}/outputs/presentation/index.html`,
    ]);
    const indexWrite = writes.get(`${SESSION_CWD}/outputs/presentation/index.html`);
    expect(indexWrite?.encoding).toBe("base64");
    expect(decodeBase64(indexWrite?.content ?? "")).toBe("<html>v2</html>");
    const notesWrite = writes.get(`${SESSION_CWD}/outputs/notes.md`);
    expect(decodeBase64(notesWrite?.content ?? "")).toBe("notes v1");
    expect(mkdirs).toContain(`${SESSION_CWD}/outputs/presentation`);
  });

  test("continues without artifact writes when the session recorded none", async () => {
    const { bindings, database } = await createContinuationFixture();
    await insertClosedConversation(database);

    const { sandbox, writes } = createContinuationSandbox();
    const result = await ensureSandboxConversationSession(bindings, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      kind: "cattle",
      mountSessionResources: false,
      origin: ORIGIN,
      sandbox,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });

    expect(result.sandboxSessionId).not.toBe(PRIOR_SANDBOX_SESSION_ID);
    expect(writes.size).toBe(0);
  });

  test("fails closed when a ready artifact object is missing from storage", async () => {
    const { bindings, bucket, database } = await createContinuationFixture();
    await recordArtifact(bindings, {
      body: "<html>v1</html>",
      path: "outputs/presentation/index.html",
    });
    bucket.objects.clear();
    await insertClosedConversation(database);

    const { sandbox } = createContinuationSandbox();

    await expect(
      ensureSandboxConversationSession(bindings, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        kind: "cattle",
        mountSessionResources: false,
        origin: ORIGIN,
        sandbox,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      }),
    ).rejects.toThrow("missing from storage");
  });
});
