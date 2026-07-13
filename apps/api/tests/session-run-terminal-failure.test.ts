import { describe, expect, test } from "bun:test";

import type { DriverInstanceId, SessionRunId } from "@mosoo/id";

import { recordCanonicalSessionRunFailure } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import { getRuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/session-link.repository";
import { recordDriverInstanceFailure } from "../src/modules/runtime/infrastructure/driver-instance/terminal-driver-events";
import { setSessionRunStatus } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const RUN_ID = PUBLIC_API_TEST_IDS.run as SessionRunId;
const DRIVER_ID = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
const CANONICAL_FAILURE_SOURCE_ID = `session-run-terminal:${RUN_ID}:run.failed`;
const DRIVER_ERROR = {
  code: "driver.command_failed",
  details: {},
  message: "OpenAi app-server exited with code 1.",
  retryable: false,
} as const;
const PROVISION_ERROR = {
  code: "runtime.provision_failed",
  details: {},
  message: "Driver command dispatch failed.",
  retryable: false,
} as const;

interface FailureEventRow {
  content_text: string;
  event_type: string;
  source_event_id: string;
}

async function insertLinkedRunFixture(
  database: SqliteD1Database,
  status: "booting" | "completed" | "cancelled" | "failed" = "booting",
): Promise<void> {
  await insertOwnerSession(database);
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          boot_token_expires_at,
          boot_token_hash,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      DRIVER_ID,
      1,
      new Uint8Array([1]),
      1,
      1,
      0,
      "orpc-ws",
      1,
      "openai-runtime",
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      "ready",
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
          completed_at,
          error_code,
          error_message,
          error_details_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      RUN_ID,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.deployment,
      1,
      DRIVER_ID,
      "user_prompt",
      status,
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-terminal-failure",
      1,
      status === "booting" ? null : 2,
      status === "failed" ? DRIVER_ERROR.code : null,
      status === "failed" ? DRIVER_ERROR.message : null,
      status === "failed" ? "{}" : null,
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
    .bind(RUN_ID, status === "booting" ? "RUNNING" : "IDLE", PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

async function readFailureEvents(database: SqliteD1Database): Promise<FailureEventRow[]> {
  return database
    .prepare(
      `
        SELECT content_text, event_type, source_event_id
        FROM session_event
        WHERE session_id = ? AND event_type = 'run.failed'
        ORDER BY seq
      `,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .all<FailureEventRow>()
    .then((result) => result.results ?? []);
}

describe("canonical session run terminal failure", () => {
  test("treats a concurrent failed transition as canonical success", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    const outcomes = await Promise.all([
      recordCanonicalSessionRunFailure(bindings, {
        error: DRIVER_ERROR,
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        source: "driver",
      }),
      recordCanonicalSessionRunFailure(bindings, {
        error: PROVISION_ERROR,
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        source: "api",
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["failed", "failed"]);
    expect(await readFailureEvents(database)).toHaveLength(1);
  });

  test("keeps one persisted driver failure when dispatch observes the terminal run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await recordDriverInstanceFailure(bindings, {
      driverInstanceId: DRIVER_ID,
      error: DRIVER_ERROR,
    });
    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });

    const run = await database
      .prepare("SELECT error_code, error_message, status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ error_code: string; error_message: string; status: string }>();

    expect(run).toEqual({
      error_code: DRIVER_ERROR.code,
      error_message: DRIVER_ERROR.message,
      status: "failed",
    });
    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: DRIVER_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("keeps one persisted provision failure when the driver reports terminal later", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });
    await recordDriverInstanceFailure(bindings, {
      driverInstanceId: DRIVER_ID,
      error: DRIVER_ERROR,
    });

    const run = await database
      .prepare("SELECT error_code, error_message, status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ error_code: string; error_message: string; status: string }>();

    expect(run).toEqual({
      error_code: PROVISION_ERROR.code,
      error_message: PROVISION_ERROR.message,
      status: "failed",
    });
    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: PROVISION_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("repairs a missing terminal failure event idempotently", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database, "failed");
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });
    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });

    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: DRIVER_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("repairs an API failure event from the Driver cached run link", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertLinkedRunFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const link = await getRuntimeSessionLink(database, DRIVER_ID);

    await setSessionRunStatus(database, {
      error: PROVISION_ERROR,
      runId: RUN_ID,
      source: "api",
      status: "failed",
    });
    expect(await readFailureEvents(database)).toEqual([]);

    await recordDriverInstanceFailure(bindings, {
      driverInstanceId: DRIVER_ID,
      error: DRIVER_ERROR,
      link,
    });

    expect(await readFailureEvents(database)).toEqual([
      {
        content_text: PROVISION_ERROR.message,
        event_type: "run.failed",
        source_event_id: CANONICAL_FAILURE_SOURCE_ID,
      },
    ]);
  });

  test("does not append a failure after a non-failed terminal outcome", async () => {
    for (const status of ["completed", "cancelled"] as const) {
      const database = await createPublicHttpContractDatabase();
      await insertLinkedRunFixture(database, status);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;

      await recordCanonicalSessionRunFailure(bindings, {
        error: PROVISION_ERROR,
        runId: RUN_ID,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        source: "api",
      });

      expect(await readFailureEvents(database)).toEqual([]);
    }
  });
});
