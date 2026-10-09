import { describe, expect, test } from "bun:test";

import { DRIVER_PROTOCOL_VERSION } from "@mosoo/agent-driver/boot";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SandboxSessionId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import {
  DRIVER_COLD_READY_TIMEOUT_MS,
  RUNTIME_SOCKET_TIMEOUT_MS,
} from "../src/modules/runtime/domain/runtime-config";
import {
  createDriverInstanceRecord,
  driverInstanceRecordMatchesBootToken,
  markDriverInstanceFailedIfBootTokenMatches,
  recordRuntimeProcessStarted,
} from "../src/modules/runtime/infrastructure/driver-instance/driver-instance-record.repository";
import { claimDriverInstanceByBootTokenHash } from "../src/modules/runtime/infrastructure/driver-instance/driver-instance-token.repository";
import {
  finalizeDriverInstance,
  markDriverInstanceConnected,
  markDriverInstanceReady,
  recordDriverInstanceHello,
} from "../src/modules/runtime/infrastructure/driver-instance/lifecycle";
import { cleanupDriverInstances } from "../src/modules/runtime/infrastructure/driver-instance/maintenance";
import type { DriverInstanceMcpGrantRecord } from "../src/modules/runtime/infrastructure/driver-instance/mcp-grants.repository";
import { provisionDriver } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-provisioning.service";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { createDriverProfile } from "./api-driver-boundary-fixtures";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_INSTANCE_ID = PLATFORM_ID_FIXTURES.driverInstance;
const SANDBOX_ID = PLATFORM_ID_FIXTURES.sandbox;
const SESSION_ID = PLATFORM_ID_FIXTURES.session;
const EXECUTION_SESSION_ID = parsePlatformId<SandboxSessionId>("01J000000000000000000000Y2");
const SESSION_RUN_ID = PLATFORM_ID_FIXTURES.sessionRun;

function createDriverInstanceRecordDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE driver_command (
      driver_instance_id text NOT NULL
    );

    CREATE TABLE sandbox_session (
      session_id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      cloudflare_session_id text NOT NULL,
      status text NOT NULL
    );

    INSERT INTO sandbox_session (session_id, sandbox_id, cloudflare_session_id, status)
    VALUES ('${SESSION_ID}', '${SANDBOX_ID}', '${EXECUTION_SESSION_ID}', 'active');

    CREATE TABLE driver_instance_mcp_grant (
      auth_type text NOT NULL,
      authorization_state text,
      can_invalidate integer NOT NULL,
      can_refresh integer NOT NULL,
      created_at integer NOT NULL,
      credential_id text,
      driver_instance_id text NOT NULL,
      project_id text NOT NULL,
      server_id text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE driver_instance (
      boot_token_expires_at integer NOT NULL,
      boot_token_hash blob NOT NULL,
      boot_token_used_at integer,
      close_code integer,
      close_reason text,
      connection_id text,
      created_at integer NOT NULL,
      command_seq_cursor integer DEFAULT 0 NOT NULL,
      driver_pid integer,
      driver_started_at integer,
      driver_version text,
      error_message text,
      expires_at integer NOT NULL,
      generation integer DEFAULT 0 NOT NULL,
      heartbeat_count integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      last_heartbeat_at integer,
      process_id text,
      protocol text NOT NULL,
      protocol_version integer NOT NULL,
      restart_count integer NOT NULL,
      runtime text NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'driver.provision' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_run (
      created_by_key_id text,
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      updated_at integer NOT NULL
    );
  `);

  return database;
}

function createBindings(database: D1Database): ApiBindings {
  return { DB: database } as ApiBindings;
}

function token(value: number): Uint8Array {
  return new Uint8Array([value]);
}

async function readDriverRecord(database: D1Database): Promise<{
  bootTokenHex: string;
  connectionId: string | null;
  errorMessage: string | null;
  generation: number;
  processId: string | null;
  status: string;
}> {
  const row = await database
    .prepare(
      `
        SELECT
          hex(boot_token_hash) AS bootTokenHex,
          connection_id AS connectionId,
          error_message AS errorMessage,
          generation,
          process_id AS processId,
          status
        FROM driver_instance
        WHERE id = '${DRIVER_INSTANCE_ID}'
      `,
    )
    .first<{
      bootTokenHex: string;
      connectionId: string | null;
      errorMessage: string | null;
      generation: number;
      processId: string | null;
      status: string;
    }>();

  if (row === null) {
    throw new Error("Driver record is missing.");
  }

  return row;
}

function insertDriverRecord(
  database: SqliteD1Database,
  input: {
    driverInstanceId?: DriverInstanceId;
    generation?: number;
    status?: string;
    updatedAt?: number;
  },
) {
  const driverInstanceId = input.driverInstanceId ?? DRIVER_INSTANCE_ID;

  database
    .prepare(
      `
        INSERT INTO driver_instance (
          boot_token_expires_at,
          boot_token_hash,
          boot_token_used_at,
          close_code,
          close_reason,
          connection_id,
          created_at,
          driver_pid,
          driver_started_at,
          driver_version,
          error_message,
          expires_at,
          generation,
          heartbeat_count,
          id,
          last_heartbeat_at,
          process_id,
          protocol,
          protocol_version,
          restart_count,
          runtime,
          sandbox_id,
          sandbox_session_id,
          status,
          status_changed_at,
          status_event,
          status_operation_id,
          status_seq,
          status_source,
          updated_at
        )
        VALUES (
          9999999999999,
          ?,
          NULL,
          NULL,
          NULL,
          NULL,
          1,
          NULL,
          NULL,
          NULL,
          NULL,
          200,
          ${input.generation ?? 0},
          0,
          '${driverInstanceId}',
          NULL,
          NULL,
          'orpc-ws',
          1,
          0,
          'openai-runtime',
          '${SANDBOX_ID}',
          '${SESSION_ID}',
          '${input.status ?? "provisioning"}',
          1,
          'driver.provision',
          NULL,
          0,
          'api',
          ${input.updatedAt ?? 1}
        )
      `,
    )
    .bind(token(1))
    .run();
}

describe("driver instance records", () => {
  for (const change of [
    `UPDATE sandbox_session SET sandbox_id = '01J000000000000000000000Y1'`,
    `UPDATE sandbox_session SET cloudflare_session_id = '01J000000000000000000000Y3'`,
    "UPDATE sandbox_session SET status = 'closed'",
    "DELETE FROM sandbox_session",
  ]) {
    test(`stale provisioning leaves driver records and commands intact: ${change}`, async () => {
      const database = createDriverInstanceRecordDatabase();
      insertDriverRecord(database, {});
      database.execute(`INSERT INTO driver_command VALUES ('${DRIVER_INSTANCE_ID}')`);
      database.execute(change);
      const before = await readDriverRecord(database);
      const input = {
        bootTokenHash: token(3),
        driverInstanceId: DRIVER_INSTANCE_ID,
        executionSessionId: EXECUTION_SESSION_ID,
        runtime: "openai-runtime" as const,
        sandboxId: SANDBOX_ID,
        sandboxSessionId: SESSION_ID,
      };

      await expect(createDriverInstanceRecord(createBindings(database), input)).rejects.toThrow(
        "malformed JSON",
      );
      expect(await readDriverRecord(database)).toEqual(before);
      expect(
        await database.prepare("SELECT COUNT(*) AS count FROM driver_command").first(),
      ).toEqual({ count: 1 });
    });
  }

  test("stale prewarm cannot insert a driver after its workspace has moved", async () => {
    const database = createDriverInstanceRecordDatabase();
    database.execute(`UPDATE sandbox_session SET sandbox_id = '01J000000000000000000000Y1'`);
    const input = {
      bootTokenHash: token(2),
      driverInstanceId: DRIVER_INSTANCE_ID,
      executionSessionId: EXECUTION_SESSION_ID,
      runtime: "openai-runtime" as const,
      sandboxId: SANDBOX_ID,
      sandboxSessionId: SESSION_ID,
    };

    await expect(createDriverInstanceRecord(createBindings(database), input)).rejects.toThrow(
      "malformed JSON",
    );
    expect(await database.prepare("SELECT COUNT(*) AS count FROM driver_instance").first()).toEqual(
      { count: 0 },
    );
  });

  const grant: DriverInstanceMcpGrantRecord = {
    authType: "none",
    authorizationState: "active",
    canInvalidate: false,
    canRefresh: false,
    credentialId: null,
    projectId: PLATFORM_ID_FIXTURES.project,
    serverId: parsePlatformId("01J000000000000000000000Y5"),
  };
  const creation = {
    bootTokenHash: token(2),
    driverInstanceId: DRIVER_INSTANCE_ID,
    executionSessionId: EXECUTION_SESSION_ID,
    mcpGrants: [grant],
    runtime: "openai-runtime" as const,
    sandboxId: SANDBOX_ID,
    sandboxSessionId: SESSION_ID,
  };

  test("grants belong to the winning claim and skipped prewarm cannot add its grants", async () => {
    const database = createDriverInstanceRecordDatabase();
    const created = await createDriverInstanceRecord(createBindings(database), creation);
    expect(created).toMatchObject({
      status: "created",
      generation: 0,
      bootTokenExpiresAt: expect.any(Number),
    });
    const before = (await database.prepare("SELECT * FROM driver_instance_mcp_grant").all())
      .results;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      project_id: grant.projectId,
      server_id: grant.serverId,
      can_invalidate: 0,
      can_refresh: 0,
    });

    const skipped = await createDriverInstanceRecord(createBindings(database), {
      ...creation,
      bootTokenHash: token(3),
      mcpGrants: [{ ...grant, serverId: parsePlatformId("01J000000000000000000000Y6") }],
    });
    expect(skipped.status).toBe("skipped");
    expect(
      (await database.prepare("SELECT * FROM driver_instance_mcp_grant").all()).results,
    ).toEqual(before);
    expect(await readDriverRecord(database)).toMatchObject({ bootTokenHex: "02", generation: 0 });
    const sameTokenRetry = await createDriverInstanceRecord(createBindings(database), {
      ...creation,
      mcpGrants: [{ ...grant, serverId: parsePlatformId("01J000000000000000000000Y7") }],
    });
    expect(sameTokenRetry.status).toBe("skipped");
    expect(
      (await database.prepare("SELECT * FROM driver_instance_mcp_grant").all()).results,
    ).toEqual(before);
  });

  // Other readiness tests mock the provisioning module. Exercise the real
  // service in a fresh process so those mocks cannot weaken these seams.
  if (process.env["MOSOO_TEST_DRIVER_BINDING_REAL_PROVISION"] === "1") {
    for (const stale of [true, false]) {
      test(`actual provisioning awaits its binding claim before any workspace access (stale=${stale})`, async () => {
        const database = createDriverInstanceRecordDatabase();
        database.execute(`
        CREATE TABLE session (id text PRIMARY KEY, kind text);
        CREATE TABLE native_resume_ref (session_id text, committed_value text, kind text, runtime_id text, value text);
      `);
        if (stale)
          database.execute(`UPDATE sandbox_session SET sandbox_id = '01J000000000000000000000Y1'`);
        let workspaceAccesses = 0;
        const stop = async (): Promise<never> => {
          workspaceAccesses++;
          throw new Error("deliberate workspace stop");
        };
        const sandbox: SandboxHandle = {
          configureNetworkConstraints: stop,
          createBackup: stop,
          createSession: stop,
          deleteSession: stop,
          destroy: stop,
          exec: stop,
          getSession: stop,
          mkdir: stop,
          mountBucket: stop,
          readFile: stop,
          restoreBackup: stop,
          setKeepAlive: stop,
          startProcess: stop,
          unmountBucket: stop,
          writeFile: stop,
        };
        const profile = createDriverProfile();
        await expect(
          provisionDriver(createBindings(database), {
            builtInTools: [],
            cloudflareSession: sandbox,
            driverInstanceId: DRIVER_INSTANCE_ID,
            profile: {
              ...profile,
              session: { ...profile.session, sandboxSessionId: EXECUTION_SESSION_ID },
            },
            requestUrl: "https://api.test/runtime",
            resolvedMcpServers: [],
            resolvedSkillCatalog: [],
            resolvedSkills: [],
            runtime: "openai-runtime",
            sandbox,
            sandboxSessionId: SESSION_ID,
            sessionRunId: null,
          }),
        ).rejects.toThrow(stale ? "malformed JSON" : "deliberate workspace stop");
        if (stale) {
          expect(workspaceAccesses).toBe(0);
          expect(
            await database.prepare("SELECT COUNT(*) AS count FROM driver_instance").first(),
          ).toEqual({ count: 0 });
        } else {
          expect(workspaceAccesses).toBeGreaterThan(0);
          expect(await readDriverRecord(database)).toMatchObject({
            generation: 0,
            status: "failed",
          });
        }
      });
    }

    test("actual provisioning keeps runtime-managed provider values out of the sandbox", async () => {
      const database = createDriverInstanceRecordDatabase();
      database.execute(
        "CREATE TABLE native_resume_ref (session_id text, committed_value text, kind text, runtime_id text, value text)",
      );
      const writes = new Map<string, string>();
      const processEnvs: Record<string, string | undefined>[] = [];
      const ok = { exitCode: 0, stderr: "", stdout: "", success: true };
      const sandbox = {
        // Every probe succeeds except the setup marker, so the setup script runs.
        exec: async (command: string) =>
          command.includes("runtime-setup-") ? { ...ok, exitCode: 1, success: false } : ok,
        mkdir: async () => {},
        startProcess: async (
          _command: string,
          options: { env?: Record<string, string | undefined> },
        ) => {
          processEnvs.push(options.env ?? {});
          return {
            getLogs: async () => "",
            getStatus: async () => "running",
            id: `process-${String(processEnvs.length)}`,
            kill: async () => {},
            pid: processEnvs.length,
            waitForExit: async () => ({ exitCode: 0 }),
          };
        },
        writeFile: async (path: string, content: string) => {
          writes.set(path, content);
        },
      } as unknown as SandboxHandle;
      const profile = createDriverProfile();

      await provisionDriver(
        {
          ...createBindings(database),
          RUNTIME_ACTION_TOKEN_SECRET: "provisioning-env-test",
        } as ApiBindings,
        {
          builtInTools: [],
          cloudflareSession: sandbox,
          driverInstanceId: DRIVER_INSTANCE_ID,
          profile: {
            ...profile,
            envVars: {
              EXISTING_ENV: "kept",
              OPENAI_API_KEY: "raw-environment-key",
              OPENCODE_CONFIG_CONTENT: '{"provider":{"openai":{"options":{"apiKey":"raw"}}}}',
            },
            network: { environmentAllowedHosts: [], networkPolicy: "full" },
            session: { ...profile.session, sandboxSessionId: EXECUTION_SESSION_ID },
            setupScript: "echo setup",
          },
          requestUrl: "https://api.test/runtime",
          resolvedMcpServers: [],
          resolvedSkillCatalog: [],
          resolvedSkills: [],
          runtime: "openai-runtime",
          sandbox,
          sandboxSessionId: SESSION_ID,
          sessionRunId: null,
        },
      );

      expect(processEnvs[0]).toEqual({ EXISTING_ENV: "kept" });
      const bootPayload = [...writes].find(([path]) => path.includes("driver-boot-payload-"));
      if (!bootPayload) throw new Error("Expected a written boot payload.");
      const variables = JSON.parse(bootPayload[1]).execution.environment.variables;
      expect(variables).toMatchObject({ EXISTING_ENV: "kept" });
      expect(variables).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
      expect(JSON.stringify(variables)).not.toContain("raw-environment-key");
    });
  } else {
    test("real provisioning binding protection survives the full-suite mocks", async () => {
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          "test",
          import.meta.path,
          "--test-name-pattern",
          "actual provisioning",
        ],
        env: { ...process.env, MOSOO_TEST_DRIVER_BINDING_REAL_PROVISION: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (status !== 0) throw new Error(`Real provisioning regression failed:\n${stdout}${stderr}`);
      expect(status).toBe(0);
    }, 10000);
  }

  test("insert-only creation does not overwrite an existing record", async () => {
    const database = createDriverInstanceRecordDatabase();
    insertDriverRecord(database, {});

    const result = await createDriverInstanceRecord(createBindings(database), {
      bootTokenHash: token(2),
      driverInstanceId: DRIVER_INSTANCE_ID,
      executionSessionId: EXECUTION_SESSION_ID,
      runtime: "openai-runtime",
      sandboxId: SANDBOX_ID,
      sandboxSessionId: SESSION_ID,
    });

    await expect(readDriverRecord(database)).resolves.toMatchObject({
      bootTokenHex: "01",
      generation: 0,
      status: "provisioning",
    });
    expect(result).toEqual({
      bootTokenExpiresAt: null,
      generation: null,
      reason: "existing-driver",
      status: "skipped",
    });
  });

  test("maintenance fails stale live driver records", async () => {
    const database = createDriverInstanceRecordDatabase();
    insertDriverRecord(database, {
      status: "ready",
      updatedAt: 1,
    });

    await cleanupDriverInstances(createBindings(database));

    await expect(readDriverRecord(database)).resolves.toMatchObject({
      errorMessage: "Runtime driver heartbeat timed out.",
      status: "failed",
    });
  });

  test("maintenance gives connecting drivers the cold ready budget", async () => {
    const database = createDriverInstanceRecordDatabase();
    insertDriverRecord(database, {
      status: "connecting",
      updatedAt: Date.now() - RUNTIME_SOCKET_TIMEOUT_MS - 1_000,
    });

    await cleanupDriverInstances(createBindings(database));

    await expect(readDriverRecord(database)).resolves.toMatchObject({
      errorMessage: null,
      status: "connecting",
    });

    database.execute(`
      UPDATE driver_instance
      SET updated_at = ${Date.now() - DRIVER_COLD_READY_TIMEOUT_MS - 1_000}
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    await cleanupDriverInstances(createBindings(database));

    await expect(readDriverRecord(database)).resolves.toMatchObject({
      errorMessage: "Runtime driver heartbeat timed out.",
      status: "failed",
    });
  });

  test("process and failure writes can be constrained to the active boot token", async () => {
    const database = createDriverInstanceRecordDatabase();
    insertDriverRecord(database, {});
    const bindings = createBindings(database);

    await expect(
      driverInstanceRecordMatchesBootToken(database, {
        bootTokenHash: token(1),
        driverInstanceId: DRIVER_INSTANCE_ID,
        generation: 0,
      }),
    ).resolves.toBe(true);
    await expect(
      recordRuntimeProcessStarted(bindings, DRIVER_INSTANCE_ID, "process-stale", {
        expectedBootTokenHash: token(9),
        expectedGeneration: 0,
      }),
    ).resolves.toBe(false);
    await expect(readDriverRecord(database)).resolves.toMatchObject({
      processId: null,
    });
    await expect(
      recordRuntimeProcessStarted(bindings, DRIVER_INSTANCE_ID, "process-current", {
        expectedBootTokenHash: token(1),
        expectedGeneration: 0,
      }),
    ).resolves.toBe(true);
    await expect(
      markDriverInstanceFailedIfBootTokenMatches(bindings, {
        bootTokenHash: token(9),
        driverInstanceId: DRIVER_INSTANCE_ID,
        errorMessage: "stale",
        generation: 0,
      }),
    ).resolves.toBe(false);
    await expect(readDriverRecord(database)).resolves.toMatchObject({
      errorMessage: null,
      processId: "process-current",
      status: "provisioning",
    });
    await expect(
      markDriverInstanceFailedIfBootTokenMatches(bindings, {
        bootTokenHash: token(1),
        driverInstanceId: DRIVER_INSTANCE_ID,
        errorMessage: "failed",
        generation: 0,
      }),
    ).resolves.toBe(true);
    await expect(readDriverRecord(database)).resolves.toMatchObject({
      errorMessage: "failed",
      status: "failed",
    });
    await expect(
      markDriverInstanceFailedIfBootTokenMatches(bindings, {
        bootTokenHash: token(1),
        driverInstanceId: DRIVER_INSTANCE_ID,
        errorMessage: "late failure",
        generation: 0,
      }),
    ).resolves.toBe(false);
    await expect(readDriverRecord(database)).resolves.toMatchObject({
      errorMessage: "failed",
      status: "failed",
    });
  });

  test("boot token ownership remains valid after a run adopts the prewarmed driver", async () => {
    const database = createDriverInstanceRecordDatabase();
    insertDriverRecord(database, {});
    database.execute(`
      INSERT INTO session_run (driver_instance_id, id, updated_at)
      VALUES ('${DRIVER_INSTANCE_ID}', '${SESSION_RUN_ID}', 1)
    `);
    const bindings = createBindings(database);

    await expect(
      driverInstanceRecordMatchesBootToken(database, {
        bootTokenHash: token(1),
        driverInstanceId: DRIVER_INSTANCE_ID,
        generation: 0,
      }),
    ).resolves.toBe(true);
    await expect(
      recordRuntimeProcessStarted(bindings, DRIVER_INSTANCE_ID, "process-adopted", {
        expectedBootTokenHash: token(1),
        expectedGeneration: 0,
      }),
    ).resolves.toBe(true);
    await expect(
      markDriverInstanceFailedIfBootTokenMatches(bindings, {
        bootTokenHash: token(1),
        driverInstanceId: DRIVER_INSTANCE_ID,
        errorMessage: "failed after adoption",
        generation: 0,
      }),
    ).resolves.toBe(true);
    await expect(readDriverRecord(database)).resolves.toMatchObject({
      errorMessage: "failed after adoption",
      processId: "process-adopted",
      status: "failed",
    });
  });

  test("records driver lifecycle transitions without accepting late hello payloads", async () => {
    const database = createDriverInstanceRecordDatabase();
    insertDriverRecord(database, {});
    const bindings = createBindings(database);

    await expect(claimDriverInstanceByBootTokenHash(bindings, token(1))).resolves.toEqual({
      driverInstanceId: DRIVER_INSTANCE_ID,
      generation: 0,
    });
    await expect(
      markDriverInstanceConnected(bindings, {
        bootTokenHash: token(1),
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
        generation: 0,
      }),
    ).resolves.toBe(true);
    await recordDriverInstanceHello(bindings, {
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
      generation: 0,
      hello: {
        capabilities: [],
        driverVersion: "driver-test",
        pid: 11,
        protocolVersion: DRIVER_PROTOCOL_VERSION,
        runtime: "openai-runtime",
        startedAt: "2026-05-08T00:00:00.000Z",
      },
    });
    await markDriverInstanceReady(bindings, {
      at: "2026-05-08T00:00:01.000Z",
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
      generation: 0,
      pid: 22,
    });
    await expect(
      recordDriverInstanceHello(bindings, {
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
        generation: 0,
        hello: {
          capabilities: [],
          driverVersion: "late-driver-test",
          pid: 99,
          protocolVersion: DRIVER_PROTOCOL_VERSION,
          runtime: "openai-runtime",
          startedAt: "2026-05-08T00:00:02.000Z",
        },
      }),
    ).resolves.toBe(false);

    const row = await database
      .prepare(
        `
          SELECT driver_pid, driver_version, status
          FROM driver_instance
          WHERE id = '${DRIVER_INSTANCE_ID}'
        `,
      )
      .first<{
        driver_pid: number | null;
        driver_version: string | null;
        status: string;
      }>();

    expect(row).toEqual({
      driver_pid: 22,
      driver_version: "driver-test",
      status: "ready",
    });
  });

  test("does not let terminal driver finalization overwrite a failed driver", async () => {
    const database = createDriverInstanceRecordDatabase();
    insertDriverRecord(database, {});
    const bindings = createBindings(database);

    await expect(
      markDriverInstanceFailedIfBootTokenMatches(bindings, {
        bootTokenHash: token(1),
        driverInstanceId: DRIVER_INSTANCE_ID,
        errorMessage: "failed first",
        generation: 0,
      }),
    ).resolves.toBe(true);
    await expect(
      finalizeDriverInstance(bindings, DRIVER_INSTANCE_ID, {
        connectionId: "connection-1",
        closeReason: "late close",
        generation: 0,
        heartbeatCount: 3,
        status: "stopped",
      }),
    ).resolves.toBe(false);

    await expect(readDriverRecord(database)).resolves.toMatchObject({
      errorMessage: "failed first",
      status: "failed",
    });
  });
});
