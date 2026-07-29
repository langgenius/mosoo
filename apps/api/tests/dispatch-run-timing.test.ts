import { describe, expect, mock, test } from "bun:test";

import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { parseRuntimeTimingProcessContent } from "@mosoo/runtime-events";

import type { RuntimeExecutionPlaneAdapter } from "../src/modules/runtime/application/execution-plane/execution-plane-adapter";
import type { RuntimeTimingSnapshot } from "../src/modules/runtime/application/session-runs/session-runtime-timing";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { createDriverProfile } from "./api-driver-boundary-fixtures";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

const readinessStarted = Promise.withResolvers<void>();
const releaseReadiness = Promise.withResolvers<void>();
const timing = {
  completedAtMs: nowMsForTest() + 10,
  path: "cold",
  phases: [{ durationMs: 10, name: "prepare" }],
  runId: PUBLIC_API_TEST_IDS.run,
  sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  source: "api",
  stage: "prepare_run",
  startedAtMs: nowMsForTest(),
  totalMs: 10,
  traceId: "dispatch-timing-trace",
} as RuntimeTimingSnapshot;
const executionPlane = {
  async dispatchTurn() {},
  async prepareRun() {
    return {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      async readiness() {
        readinessStarted.resolve();
        await releaseReadiness.promise;
        return timing;
      },
      release() {},
      timing,
    };
  },
} as RuntimeExecutionPlaneAdapter;

mock.module(
  "../src/modules/runtime/infrastructure/execution-plane/sandbox-execution-plane-adapter",
  () => ({
    createSandboxExecutionPlaneAdapter: () => executionPlane,
  }),
);

const { dispatchSessionRun } =
  await import("../src/modules/runtime/application/session-runs/dispatch-run.service");

const bootingRun = {
  completedAt: null,
  createdAt: new Date(nowMsForTest()).toISOString(),
  deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
  deploymentVersionNumber: 1,
  error: null,
  id: PUBLIC_API_TEST_IDS.run,
  model: "gpt-5.4",
  provider: "openai",
  startedAt: new Date(nowMsForTest()).toISOString(),
  status: "booting",
  traceId: "dispatch-timing-trace",
  trigger: "user_prompt",
  updatedAt: new Date(nowMsForTest()).toISOString(),
} satisfies SessionRunSummary;

async function readTimingStages(database: D1Database): Promise<string[]> {
  const rows = await database
    .prepare(
      `SELECT content_text
       FROM session_event
       WHERE session_id = ? AND event_type = 'runtime.timing.recorded'
       ORDER BY seq`,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .all<{ content_text: string }>();

  return rows.results.map((row) => parseRuntimeTimingProcessContent(row.content_text).stage);
}

describe("dispatch run timing", () => {
  test("persists API timing markers before driver readiness completes", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    const nowMs = nowMsForTest();
    await database
      .prepare(
        `INSERT INTO session_run (
           id, session_id, agent_id, created_by_account_id,
           deployment_version_id, deployment_version_number,
           trigger, status, provider, model, runtime_id, trace_id,
           started_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        bootingRun.traceId,
        nowMs,
        nowMs,
        nowMs,
      )
      .run();

    const profile = {
      ...createDriverProfile(),
      agentId: PUBLIC_API_TEST_IDS.agent,
      configRevision: {
        ...createDriverProfile().configRevision,
        agentId: PUBLIC_API_TEST_IDS.agent,
        deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
        deploymentVersionNumber: 1,
        runId: PUBLIC_API_TEST_IDS.run,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      },
      runtimeId: "openai-runtime" as const,
      sandbox: {
        id: PUBLIC_API_TEST_IDS.sandbox,
        kind: "cattle" as const,
        subjectId: PUBLIC_API_TEST_IDS.ownerSession,
        subjectKind: "session" as const,
      },
      session: {
        ...createDriverProfile().session,
        sandboxSessionId: PUBLIC_API_TEST_IDS.ownerSession,
      },
    };
    const operation = dispatchSessionRun(
      createPublicHttpTestBindings(database) as ApiBindings,
      "https://api.example.com",
      {
        attachmentIds: [],
        bootingRun,
        builtInTools: createDefaultAgentBuiltInTools(),
        profile,
        prompt: "hello",
        resolvedMcpServers: [],
        resolvedSkillCatalog: [],
        resolvedSkills: [],
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        sessionRunId: PUBLIC_API_TEST_IDS.run,
        traceId: bootingRun.traceId,
      } as unknown as Parameters<typeof dispatchSessionRun>[2],
    );

    await readinessStarted.promise;
    let stages: string[] = [];
    for (let attempt = 0; attempt < 20 && stages.length < 2; attempt += 1) {
      stages = await readTimingStages(database);
      await Bun.sleep(5);
    }
    releaseReadiness.resolve();
    await operation;

    expect(stages).toEqual(["prepare_run", "driver_turn"]);
  });
});
