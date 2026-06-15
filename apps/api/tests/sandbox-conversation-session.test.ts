import { describe, expect, mock, test } from "bun:test";

import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSessionStatus } from "@mosoo/contracts/sandbox";
import { isPlatformId } from "@mosoo/id";

import type {
  ExecutionSessionHandle,
  RuntimeCommandResultHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

mock.module("@cloudflare/sandbox", () => ({
  getSandbox: () => {
    throw new Error("getSandbox is not used in conversation session tests.");
  },
}));

const { ensureSandboxConversationSession } =
  await import("../src/modules/runtime/infrastructure/sandbox-session/sandbox-conversation-session.service");

const ORIGIN = {
  callerUserId: "01J00000000000000000000001",
  entrypoint: "api",
  executionOwnerUserId: "01J00000000000000000000001",
  type: "agent",
} as const;

function commandResult(): RuntimeCommandResultHandle {
  return {
    exitCode: 0,
    stderr: "",
    stdout: "",
    success: true,
  };
}

function failedCommandResult(): RuntimeCommandResultHandle {
  return {
    exitCode: 1,
    stderr: "",
    stdout: "",
    success: false,
  };
}

function createConversationSessionDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      status text DEFAULT 'active' NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'runtime_subject.active' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      cloudflare_session_id text NOT NULL,
      created_at integer NOT NULL,
      cwd text NOT NULL,
      origin_json text NOT NULL,
      sandbox_id text NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      space_aliases_json text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_backup (
      created_at integer NOT NULL,
      dir text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL
    );
  `);

  database.execute(`
    INSERT INTO sandbox (id, inactive_deadline_at, updated_at)
    VALUES ('01J0000000000000000000000D', NULL, 1);
  `);

  return database;
}

async function insertConversationSession(
  database: D1Database,
  input: {
    readonly status: SandboxSessionStatus;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox_session (
          cloudflare_session_id,
          created_at,
          cwd,
          origin_json,
          sandbox_id,
          session_id,
          space_aliases_json,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "01J00000000000000000000001",
      1,
      "/workspace/se/session-1",
      JSON.stringify(ORIGIN),
      "01J0000000000000000000000D",
      "session-1",
      "[]",
      input.status,
      1,
    )
    .run();
}

async function insertConversationBackup(database: D1Database): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox_backup (
          created_at,
          dir,
          id,
          sandbox_id,
          status
        )
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .bind(
      1,
      "/workspace/se/session-1",
      "01J00000000000000000000002",
      "01J0000000000000000000000D",
      "ready",
    )
    .run();
}

async function readConversationSession(database: D1Database): Promise<{
  cloudflare_session_id: string;
  cwd: string;
  status: string;
}> {
  const row = await database
    .prepare(
      `
        SELECT cloudflare_session_id, cwd, status
        FROM sandbox_session
        WHERE session_id = ?
      `,
    )
    .bind("session-1")
    .first<{
      cloudflare_session_id: string;
      cwd: string;
      status: string;
    }>();

  if (row === null) {
    throw new Error("Conversation session row is missing.");
  }

  return row;
}

function createExecutionSession(options: { cwdHasContent: boolean }): ExecutionSessionHandle {
  return {
    async exec() {
      return options.cwdHasContent ? commandResult() : failedCommandResult();
    },
    async mkdir() {},
    async readFile() {
      return { content: "", encoding: "utf8" };
    },
    async startProcess() {
      throw new Error("startProcess is not used in conversation session tests.");
    },
    async watch() {
      return new ReadableStream<Uint8Array>();
    },
    async writeFile() {},
  };
}

function createSandbox(options: { cwdHasContent?: boolean } = {}): SandboxHandle {
  const executionSession = createExecutionSession({
    cwdHasContent: options.cwdHasContent ?? true,
  });

  return {
    ...executionSession,
    async createBackup() {
      return { dir: "/backup", id: "backup-1" };
    },
    async createSession() {
      return executionSession;
    },
    async deleteSession() {
      return { sessionId: "session-1", success: true, timestamp: new Date(0).toISOString() };
    },
    async destroy() {},
    async getSession() {
      return executionSession;
    },
    async mountBucket() {},
    async restoreBackup(backup) {
      return backup;
    },
    async setKeepAlive() {},
    async terminal() {
      return new Response();
    },
    async wsConnect() {
      return new Response(null, { status: 101 });
    },
  };
}

function createBindings(database: D1Database): ApiBindings {
  return { DB: database } as ApiBindings;
}

function createInput(sandbox: SandboxHandle, kind: AgentKind = "pet") {
  return {
    currentAppAccessSnapshot: { entries: [] },
    kind,
    mountSessionResources: false,
    origin: ORIGIN,
    sandbox,
    sandboxId: "01J0000000000000000000000D",
    sessionId: "session-1",
    spaceAliases: [],
  };
}

describe("ensureSandboxConversationSession", () => {
  test("reuses an active session without preparing directories", async () => {
    const database = createConversationSessionDatabase();
    await insertConversationSession(database, { status: "active" });
    const sandbox = createSandbox();

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox),
    );

    expect(result.sandboxSessionId).toBe("01J00000000000000000000001");
    await expect(readConversationSession(database)).resolves.toEqual({
      cloudflare_session_id: "01J00000000000000000000001",
      cwd: "/workspace/se/session-1",
      status: "active",
    });
  });

  test("creates a missing conversation session record", async () => {
    const database = createConversationSessionDatabase();
    const sandbox = createSandbox();

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox),
    );

    expect(isPlatformId(result.sandboxSessionId)).toBe(true);
    await expect(readConversationSession(database)).resolves.toEqual({
      cloudflare_session_id: result.sandboxSessionId,
      cwd: result.cwd,
      status: "active",
    });
  });

  test("continues a closed cattle session with a new execution session id", async () => {
    const database = createConversationSessionDatabase();
    await insertConversationSession(database, { status: "closed" });
    const sandbox = createSandbox();

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox, "cattle"),
    );

    expect(result.sandboxSessionId).not.toBe("01J00000000000000000000001");
    expect(isPlatformId(result.sandboxSessionId)).toBe(true);

    await expect(readConversationSession(database)).resolves.toMatchObject({
      cloudflare_session_id: result.sandboxSessionId,
      status: "active",
    });
  });

  test("continues a closed pet session through the stable restore path", async () => {
    const database = createConversationSessionDatabase();
    await insertConversationSession(database, { status: "closed" });
    await insertConversationBackup(database);
    const sandbox = createSandbox({ cwdHasContent: false });

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox, "pet"),
    );

    expect(result.sandboxSessionId).toBe("01J00000000000000000000001");
    await expect(readConversationSession(database)).resolves.toMatchObject({
      cloudflare_session_id: "01J00000000000000000000001",
      status: "active",
    });
  });
});
