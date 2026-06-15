import { describe, expect, test } from "bun:test";

import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";

import { repairFinalizedTerminalDriverRunState } from "../src/modules/runtime/infrastructure/driver-instance/terminal-run-release";
import {
  createRuntimeCommandRecord,
  getRuntimeCommandRecord,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const FINALIZE_RUN_ID = "01J0000000000000000000000T" as SessionRunId;
const FINALIZE_COMMAND_ID = "01J0000000000000000000000V" as DriverCommandId;
const FINALIZE_CLOUDFLARE_SESSION_ID = "01J0000000000000000000000W";

function inputStartCommand(id: DriverCommandId): RuntimeCommand {
  return {
    commandId: id,
    input: {
      text: "continue",
    },
    kind: "input.start",
    requestId: `request-${id}`,
    runId: FINALIZE_RUN_ID,
  };
}

async function insertFinalizedDriverLeaseFixture(database: SqliteD1Database): Promise<void> {
  await insertOwnerSession(database);
  database.execute(`
    CREATE TABLE IF NOT EXISTS driver_command (
      acked_at integer,
      completed_at integer,
      delivery_connection_id text,
      driver_instance_id text NOT NULL,
      error_json text,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      issued_at integer NOT NULL,
      kind text NOT NULL,
      payload_json text NOT NULL,
      result_json text,
      seq integer NOT NULL,
      status text NOT NULL
    );
  `);
  await database
    .prepare(
      `
        INSERT INTO sandbox (
          id,
          kind,
          subject_kind,
          subject_id,
          status,
          bind_mount_ready,
          global_mounts_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.sandbox,
      "pet",
      "agent",
      PUBLIC_API_TEST_IDS.agent,
      "active",
      1,
      "[]",
      1,
      1,
    )
    .run();
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
      FINALIZE_CLOUDFLARE_SESSION_ID,
      1,
      "/workspace",
      JSON.stringify({
        callerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
        entrypoint: "api",
        executionOwnerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
        type: "agent",
      }),
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      "[]",
      "active",
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          boot_token_expires_at,
          boot_token_hash,
          connection_id,
          created_at,
          expires_at,
          heartbeat_count,
          protocol,
          protocol_version,
          runtime,
          sandbox_id,
          sandbox_session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.driverOwner,
      1,
      new Uint8Array([1]),
      "connection-finalized",
      1,
      1,
      0,
      "orpc-ws",
      1,
      "openai-runtime",
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      "stopped",
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO session_run (
          id,
          session_id,
          agent_id,
          created_by_account_id,
          deployment_version_id,
          deployment_version_number,
          driver_instance_id,
          trigger,
          status,
          provider,
          model,
          runtime_id,
          trace_id,
          started_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      FINALIZE_RUN_ID,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.deployment,
      1,
      PUBLIC_API_TEST_IDS.driverOwner,
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-finalize",
      1,
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
    .bind(FINALIZE_RUN_ID, "RUNNING", PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

describe("driver finalization repair", () => {
  test("fails active run lease and accepted commands for finalized drivers", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(FINALIZE_COMMAND_ID),
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "accepted",
    });

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "stopped",
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(FINALIZE_RUN_ID)
      .first<{ error_code: string | null; status: string }>();
    const activeLease = await database
      .prepare(
        "SELECT id FROM session_run WHERE driver_instance_id = ? AND status IN ('queued', 'booting', 'running', 'waiting_input')",
      )
      .bind(PUBLIC_API_TEST_IDS.driverOwner)
      .first<{ id: string }>();
    const command = await getRuntimeCommandRecord(
      database,
      PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      FINALIZE_COMMAND_ID,
    );

    expect(run).toEqual({
      error_code: "runtime.driver_stopped",
      status: "failed",
    });
    expect(activeLease).toBeNull();
    expect(command?.status).toBe("failed");
    expect(command?.error?.code).toBe("driver.command_driver_terminal");
  });
});
