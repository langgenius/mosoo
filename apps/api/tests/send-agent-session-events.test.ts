import { describe, expect, test } from "bun:test";

import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";

import { dispatchQueuedSessionRun } from "../src/modules/runtime/application/session-runs/dispatch-queued-run.service";
import { sendAgentSessionEvents } from "../src/modules/runtime/application/session-runs/send-agent-session-events.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  insertOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

type PublicApiTestDatabase = Awaited<ReturnType<typeof createPublicHttpContractDatabase>>;

function createQueuedRunExecutionPlan() {
  return {
    binding: {
      agentId: PUBLIC_API_TEST_IDS.agent,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      kind: "pet",
      model: "gpt-5.4",
      prompt: "Help.",
      provider: "openai",
      runtimeId: "openai-runtime",
    },
    builtInTools: createDefaultAgentBuiltInTools(),
    environment: {
      allowMcpServers: true,
      allowPackageManagers: true,
      allowedHostsJson: "[]",
      envVarsJson: "[]",
      environmentId: PUBLIC_API_TEST_IDS.environment,
      environmentName: "Default",
      networkPolicy: "full",
      packagesJson: "[]",
      revisionId: PUBLIC_API_TEST_IDS.environmentRevision,
      setupScript: "",
    },
    skills: [],
    tools: [],
  };
}

async function insertQueuedRunFixture(
  database: PublicApiTestDatabase,
  input: {
    nowMs: number;
    runId: string;
    traceId: string;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT OR REPLACE INTO session_execution_snapshot (
          session_id,
          plan_json,
          created_at
        )
        VALUES (?, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.ownerSession,
      JSON.stringify(createQueuedRunExecutionPlan()),
      input.nowMs,
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
          trigger,
          status,
          provider,
          model,
          runtime_id,
          trace_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.runId,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.deployment,
      1,
      "user_prompt",
      "queued",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      input.traceId,
      input.nowMs,
      input.nowMs,
    )
    .run();
}

async function insertSessionFileRecord(
  database: PublicApiTestDatabase,
  input: {
    etag: string | null;
    fileId: string;
    mimeType: string;
    name: string;
    nowMs: number;
    sessionKind: "artifact" | "attachment";
    size: number;
    status: "deleting" | "ready";
  },
): Promise<void> {
  const purpose = input.sessionKind === "artifact" ? "session_artifact" : "session_attachment";
  const parentPath = `${input.sessionKind}/${input.fileId}`;
  const path = `${parentPath}/${input.name}`;

  await database
    .prepare(
      `
        INSERT INTO file_record (
          id,
          scope_kind,
          scope_id,
          session_kind,
          status,
          name,
          path,
          parent_path,
          object_key,
          owner_id,
          owner_kind,
          purpose,
          expires_at,
          mime_type,
          size,
          etag,
          committed,
          version,
          created_by_account_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.fileId,
      "session",
      PUBLIC_API_TEST_IDS.ownerSession,
      input.sessionKind,
      input.status,
      input.name,
      path,
      parentPath,
      `session/${PUBLIC_API_TEST_IDS.ownerSession}/${path}`,
      PUBLIC_API_TEST_IDS.ownerSession,
      "session",
      purpose,
      null,
      input.mimeType,
      input.size,
      input.etag,
      1,
      1,
      PUBLIC_API_TEST_IDS.ownerAccount,
      input.nowMs,
      input.nowMs,
    )
    .run();
}

describe("send agent session events", () => {
  test("returns user message response summaries", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);

    const response = await sendAgentSessionEvents({
      bindings: createPublicHttpTestBindings(database) as ApiBindings,
      executionContext: createTestExecutionContext(),
      input: {
        events: [
          {
            attachmentIds: [],
            clientRequestId: "client-1",
            text: "Run the checklist.",
            type: "user_message",
          },
        ],
        appId: PUBLIC_API_TEST_IDS.app,
        sessionId: "01J0000000000000000000000C",
      },
      requestUrl: "https://api.example.com/api/v1/sessions/01J0000000000000000000000C/events",
      viewer: {
        email: "owner@example.com",
        emailVerified: true,
        id: "01J00000000000000000000001",
        imageUrl: null,
        name: "Owner",
      },
    });

    const eventRun = response.events[0]?.run;

    expect(eventRun).not.toBeNull();
    expect(response.session.lastRun?.id).toBe(eventRun?.id);
    expect(response.session.lastMessageAt).not.toBeNull();
    expect(response.session.status).toBe("RUNNING");
  });

  test("rejects run attachmentIds before queueing when the file is not a session attachment", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await database
      .prepare(
        `
          INSERT INTO file_record (
            id,
            scope_kind,
            scope_id,
            session_kind,
            status,
            name,
            path,
            parent_path,
            object_key,
            owner_id,
            owner_kind,
            purpose,
            expires_at,
            mime_type,
            size,
            etag,
            committed,
            version,
            created_by_account_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        PUBLIC_API_TEST_IDS.fileAlt,
        "session",
        PUBLIC_API_TEST_IDS.ownerSession,
        "artifact",
        "ready",
        "summary.md",
        `artifact/${PUBLIC_API_TEST_IDS.fileAlt}/summary.md`,
        `artifact/${PUBLIC_API_TEST_IDS.fileAlt}`,
        `session/${PUBLIC_API_TEST_IDS.ownerSession}/artifact/${PUBLIC_API_TEST_IDS.fileAlt}/summary.md`,
        PUBLIC_API_TEST_IDS.ownerSession,
        "session",
        "session_artifact",
        null,
        "text/markdown",
        23,
        null,
        1,
        1,
        PUBLIC_API_TEST_IDS.ownerAccount,
        1,
        1,
      )
      .run();

    await expect(
      sendAgentSessionEvents({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        executionContext: createTestExecutionContext(),
        input: {
          events: [
            {
              attachmentIds: [PUBLIC_API_TEST_IDS.fileAlt],
              clientRequestId: "client-1",
              text: "Run the checklist.",
              type: "user_message",
            },
          ],
          appId: PUBLIC_API_TEST_IDS.app,
          sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        },
        requestUrl: `https://api.example.com/api/v1/sessions/${PUBLIC_API_TEST_IDS.ownerSession}/events`,
        viewer: {
          email: "owner@example.com",
          emailVerified: true,
          id: PUBLIC_API_TEST_IDS.ownerAccount,
          imageUrl: null,
          name: "Owner",
        },
      }),
    ).rejects.toThrow("is not available for this session");

    const rows = await database
      .prepare(
        `
          SELECT
            (SELECT count(*) FROM session_run) AS run_count,
            (SELECT count(*) FROM session_message) AS message_count
        `,
      )
      .first<{ message_count: number; run_count: number }>();

    expect(rows).toEqual({
      message_count: 0,
      run_count: 0,
    });
  });

  test("skips stale queued delivery before hydrating its context", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    const nowMs = nowMsForTest();
    const traceId = "stale-dispatch-trace";

    await insertQueuedRunFixture(database, {
      nowMs,
      runId: PUBLIC_API_TEST_IDS.run,
      traceId,
    });
    await database
      .prepare("UPDATE session_run SET status = 'booting' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .run();

    await expect(
      dispatchQueuedSessionRun({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        input: {
          attachmentIds: [PUBLIC_API_TEST_IDS.file],
          prompt: "This duplicate delivery must not hydrate.",
          queuedAtMs: nowMs,
          session: {
            app_id: PUBLIC_API_TEST_IDS.app,
            id: PUBLIC_API_TEST_IDS.ownerSession,
          },
          sessionRunId: PUBLIC_API_TEST_IDS.run,
          traceId,
        },
        requestUrl: `https://api.example.com/api/v1/sessions/${PUBLIC_API_TEST_IDS.ownerSession}/events`,
        viewer: {
          email: "owner@example.com",
          emailVerified: true,
          id: PUBLIC_API_TEST_IDS.ownerAccount,
          imageUrl: null,
          name: "Owner",
        },
      }),
    ).resolves.toEqual([]);

    const row = await database
      .prepare("SELECT status, error_code FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ error_code: string | null; status: string }>();

    expect(row).toEqual({
      error_code: null,
      status: "booting",
    });
  });

  test("rejects queued dispatch when a previously valid attachment is no longer session-ready", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    const nowMs = nowMsForTest();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const executionPlan = {
      binding: {
        agentId: PUBLIC_API_TEST_IDS.agent,
        deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
        deploymentVersionNumber: 1,
        kind: "pet",
        model: "gpt-5.4",
        prompt: "Help.",
        provider: "openai",
        runtimeId: "openai-runtime",
      },
      builtInTools: createDefaultAgentBuiltInTools(),
      environment: {
        allowMcpServers: true,
        allowPackageManagers: true,
        allowedHostsJson: "[]",
        envVarsJson: "[]",
        environmentId: PUBLIC_API_TEST_IDS.environment,
        environmentName: "Default",
        networkPolicy: "full",
        packagesJson: "[]",
        revisionId: PUBLIC_API_TEST_IDS.environmentRevision,
        setupScript: "",
      },
      skills: [],
      tools: [],
    };

    await database
      .prepare(
        `
          INSERT OR REPLACE INTO session_execution_snapshot (
            session_id,
            plan_json,
            created_at
          )
          VALUES (?, ?, ?)
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession, JSON.stringify(executionPlan), nowMs)
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
            trigger,
            status,
            provider,
            model,
            runtime_id,
            trace_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        PUBLIC_API_TEST_IDS.run,
        PUBLIC_API_TEST_IDS.ownerSession,
        PUBLIC_API_TEST_IDS.agent,
        PUBLIC_API_TEST_IDS.ownerAccount,
        PUBLIC_API_TEST_IDS.deployment,
        1,
        "user_prompt",
        "queued",
        "openai",
        "gpt-5.4",
        "openai-runtime",
        "dispatch-attachment-trace",
        nowMs,
        nowMs,
      )
      .run();
    await database
      .prepare(
        `
          INSERT INTO file_record (
            id,
            scope_kind,
            scope_id,
            session_kind,
            status,
            name,
            path,
            parent_path,
            object_key,
            owner_id,
            owner_kind,
            purpose,
            expires_at,
            mime_type,
            size,
            etag,
            committed,
            version,
            created_by_account_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        PUBLIC_API_TEST_IDS.file,
        "session",
        PUBLIC_API_TEST_IDS.ownerSession,
        "attachment",
        "ready",
        "launch-note.txt",
        `attachment/${PUBLIC_API_TEST_IDS.file}/launch-note.txt`,
        `attachment/${PUBLIC_API_TEST_IDS.file}`,
        `session/${PUBLIC_API_TEST_IDS.ownerSession}/attachment/${PUBLIC_API_TEST_IDS.file}/launch-note.txt`,
        PUBLIC_API_TEST_IDS.ownerSession,
        "session",
        "session_attachment",
        null,
        "text/plain",
        13,
        "etag-attachment",
        1,
        1,
        PUBLIC_API_TEST_IDS.ownerAccount,
        nowMs,
        nowMs,
      )
      .run();

    await database
      .prepare("UPDATE file_record SET status = ?, updated_at = ? WHERE id = ?")
      .bind("deleting", nowMs + 1, PUBLIC_API_TEST_IDS.file)
      .run();

    await expect(
      dispatchQueuedSessionRun({
        bindings,
        input: {
          attachmentIds: [PUBLIC_API_TEST_IDS.file],
          prompt: "Use the attached file.",
          queuedAtMs: nowMs,
          session: {
            app_id: PUBLIC_API_TEST_IDS.app,
            id: PUBLIC_API_TEST_IDS.ownerSession,
          },
          sessionRunId: PUBLIC_API_TEST_IDS.run,
          traceId: "dispatch-attachment-trace",
        },
        requestUrl: `https://api.example.com/api/v1/sessions/${PUBLIC_API_TEST_IDS.ownerSession}/events`,
        viewer: {
          email: "owner@example.com",
          emailVerified: true,
          id: PUBLIC_API_TEST_IDS.ownerAccount,
          imageUrl: null,
          name: "Owner",
        },
      }),
    ).rejects.toThrow("is not available for this session");

    const row = await database
      .prepare("SELECT status, error_code, error_message FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ error_code: string | null; error_message: string | null; status: string }>();

    expect(row).toMatchObject({
      error_code: "runtime.context_hydration_failed",
      status: "failed",
    });
    expect(row?.error_message).toContain("is not available for this session");
  });

  test("rejects queued dispatch when a ready artifact is forged as an attachment", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    const nowMs = nowMsForTest();
    const traceId = "dispatch-artifact-trace";
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await insertQueuedRunFixture(database, {
      nowMs,
      runId: PUBLIC_API_TEST_IDS.run,
      traceId,
    });
    await insertSessionFileRecord(database, {
      etag: null,
      fileId: PUBLIC_API_TEST_IDS.fileAlt,
      mimeType: "text/markdown",
      name: "summary.md",
      nowMs,
      sessionKind: "artifact",
      size: 23,
      status: "ready",
    });

    await expect(
      dispatchQueuedSessionRun({
        bindings,
        input: {
          attachmentIds: [PUBLIC_API_TEST_IDS.fileAlt],
          prompt: "Use the attached file.",
          queuedAtMs: nowMs,
          session: {
            app_id: PUBLIC_API_TEST_IDS.app,
            id: PUBLIC_API_TEST_IDS.ownerSession,
          },
          sessionRunId: PUBLIC_API_TEST_IDS.run,
          traceId,
        },
        requestUrl: `https://api.example.com/api/v1/sessions/${PUBLIC_API_TEST_IDS.ownerSession}/events`,
        viewer: {
          email: "owner@example.com",
          emailVerified: true,
          id: PUBLIC_API_TEST_IDS.ownerAccount,
          imageUrl: null,
          name: "Owner",
        },
      }),
    ).rejects.toThrow("is not available for this session");

    const row = await database
      .prepare("SELECT status, error_code, error_message FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ error_code: string | null; error_message: string | null; status: string }>();

    expect(row).toMatchObject({
      error_code: "runtime.context_hydration_failed",
      status: "failed",
    });
    expect(row?.error_message).toContain("is not available for this session");
  });

  test("rejects participant sends when the viewer is not the session creator", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await database
      .prepare("UPDATE session SET attributed_user_id = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerAccount, PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await expect(
      sendAgentSessionEvents({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        executionContext: createTestExecutionContext(),
        input: {
          events: [
            {
              attachmentIds: [],
              clientRequestId: "client-1",
              text: "Run the checklist.",
              type: "user_message",
            },
          ],
          appId: PUBLIC_API_TEST_IDS.app,
          sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        },
        requestUrl: `https://api.example.com/api/v1/sessions/${PUBLIC_API_TEST_IDS.ownerSession}/events`,
        viewer: {
          email: "non-owner@example.com",
          emailVerified: true,
          id: PUBLIC_API_TEST_IDS.nonOwnerAccount,
          imageUrl: null,
          name: "Non Owner",
        },
      }),
    ).rejects.toThrow();
  });
});
