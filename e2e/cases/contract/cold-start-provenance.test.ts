import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertBenchmarkBudget,
  assertDistinctStackHookEnvironments,
  assertEquivalentRuntimeFixtures,
  archiveRecoveredAttempt,
  assertDeploymentTreatmentStable,
  assertHarnessRevision,
  benchmarkBudgetUsage,
  captureFixedTraceEvidence,
  completedAttemptRun,
  computeHarnessRevision,
  createPendingAttempt,
  deriveLegacyOneShotRunAcceptedAt,
  discardPartialBlocks,
  httpWorkerIdentityMatches,
  parseExistingDocument,
  parseTrace,
  reconcilePendingAttempt,
  stackHookEnvironment,
  validateRecordedRuns,
} from "../../bin/cold-start-ab";
import type { PendingAttempt } from "../../bin/cold-start-ab";
import {
  hashWorkerRuntimeBundle,
  readSourceRevision,
  validateStackWranglerConfig,
} from "../../bin/perf-stage-hook";
import type { ColdStartRunResult, RuntimeBenchmarkFixture } from "../../lib/cold-start-benchmark";
import { createInterleavedBlockPlans, createPairNonce } from "../../lib/cold-start-experiment";
import type {
  DeploymentIdentity,
  ExperimentRun,
  InterleavedRunPlan,
  ObservedRunIdentity,
  ObservedRunTrace,
} from "../../lib/cold-start-experiment";

const temporaryRoots: string[] = [];
const harnessRevision = `sha256:${"a".repeat(64)}`;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mosoo-provenance-test-"));
  temporaryRoots.push(root);
  return root;
}

function stackEnvironment(): Record<string, string> {
  return {
    MOSOO_PERF_A_BASE_URL: "https://a.example.test",
    MOSOO_PERF_A_CF_ENV: "perf_a",
    MOSOO_PERF_A_CONTAINER_APPLICATION_NAME: "container-a",
    MOSOO_PERF_A_D1_DATABASE_ID: "d1-a",
    MOSOO_PERF_A_RESOURCE_PREFIX: "stage-a-",
    MOSOO_PERF_A_WORKER_NAME: "worker-a",
    MOSOO_PERF_A_WRANGLER_TEMPLATE: "/templates/perf.toml",
    MOSOO_PERF_B_BASE_URL: "https://b.example.test",
    MOSOO_PERF_B_CF_ENV: "perf_b",
    MOSOO_PERF_B_CONTAINER_APPLICATION_NAME: "container-b",
    MOSOO_PERF_B_D1_DATABASE_ID: "d1-b",
    MOSOO_PERF_B_RESOURCE_PREFIX: "stage-b-",
    MOSOO_PERF_B_WORKER_NAME: "worker-b",
    MOSOO_PERF_B_WRANGLER_TEMPLATE: "/templates/perf.toml",
  };
}

function runtimeFixture(stack: "a" | "b"): RuntimeBenchmarkFixture {
  return {
    agentConfigSha256: "agent-config-sha",
    agentId: `agent-${stack}`,
    appId: `app-${stack}`,
    baseURL: `https://${stack}.example.test`,
    createdAt: "2026-07-19T00:00:00.000Z",
    model: "model",
    pat: `pat-${stack}`,
    providerId: "provider",
    runtimeId: "runtime",
  };
}

function deployment(): DeploymentIdentity {
  return {
    containerApplicationId: "container-app",
    containerApplicationVersion: "1",
    containerDiskMb: 4_000,
    containerInstanceType: "basic",
    containerMaxInstances: 100,
    containerMemoryMib: 1_024,
    containerVcpu: 0.25,
    deployedAt: "2026-07-19T00:00:00.000Z",
    driverBundleSha256: "driver-sha",
    imageDigest: "sha256:image",
    imageGzipProxyBytes: 500,
    imageUncompressedBytes: 1_000,
    ordinal: 1,
    physicalStackId: "physical-stack",
    phase: 1,
    readyAt: "2026-07-19T00:00:01.000Z",
    sourceRevision: "source-revision",
    stack: "a",
    stackConfigSha256: "stack-config-sha",
    treatmentConfigSha256: "treatment-config-sha",
    variant: "before",
    workerBundleSha256: "worker-sha",
    workerVersionId: "worker-version",
  };
}

function document() {
  return {
    createdAt: "2026-07-19T00:00:00.000Z",
    deployments: [deployment()],
    discardedBlocks: [],
    executions: [
      {
        blockCount: 16,
        blockStart: 0,
        harnessRevision,
        ordinal: 1,
        startedAt: "2026-07-19T00:00:00.000Z",
      },
    ],
    experimentId: "experiment",
    failedAttempts: [],
    fixture: {
      agentConfigSha256: "agent-config-sha",
      agentId: "agent",
      appId: "app",
      baseURL: "https://example.test",
      model: "model",
      providerId: "provider",
      runtimeId: "runtime",
    },
    fixtureB: {
      agentConfigSha256: "agent-config-sha",
      agentId: "agent-b",
      appId: "app-b",
      baseURL: "https://b.example.test",
      model: "model",
      providerId: "provider",
      runtimeId: "runtime",
    },
    method: {
      budget: {
        maxAttemptedRuns: 64,
        maxFailedAttempts: 0,
        maxUsageTotalTokens: 200_000,
        maxWallClockMs: 21_600_000,
      },
      coldDefinition: "cold",
      gate: "gate",
      harnessRevision,
      journey: "two-stage",
      leadMs: 10_000,
      leadToleranceMs: 500,
      ordering: "ordering",
      primaryEndpoint: "endpoint",
      seed: "seed",
      sourceRegion: "region",
      timeoutMs: 240_000,
      traceEvidence: "fixed three-snapshot trace evidence",
      totalBlocks: 16,
      totalPairs: 32,
    },
    pendingAttempt: null,
    pendingDeployment: null,
    runs: [],
    schemaVersion: "mosoo.cold-start-ab.v12",
    summary: {},
    updatedAt: "2026-07-19T00:00:00.000Z",
  };
}

const plan: InterleavedRunPlan = {
  block: 1,
  blockOrder: "abba",
  journey: "two-stage",
  pair: 1,
  pairOrder: "ab",
  phase: 1,
  position: 1,
  sequence: 1,
  stack: "a",
  variant: "before",
};

function sample(): ColdStartRunResult {
  return {
    cfColo: "SIN",
    cfRayCreate: "create-SIN",
    cfRaySend: "send-SIN",
    cfRayStream: "stream-SIN",
    completedAt: "2026-07-19T00:00:02.000Z",
    failure: null,
    fixture: {
      agentConfigSha256: "agent-config-sha",
      agentId: "agent",
      model: "model",
      providerId: "provider",
      runtimeId: "runtime",
    },
    metrics: {
      assistantChunkCount: 2,
      assistantEventCount: 2,
      assistantTextCharacters: 520,
      createAcceptedMs: 100,
      firstAssistantTextMs: 500,
      intentToFirstAssistantTextMs: 500,
      intentToSendMs: 100,
      interChunkMaxMs: 10,
      interChunkP50Ms: 10,
      interChunkP95Ms: 10,
      pauseOver250MsCount: 0,
      pauseOver500MsCount: 0,
      runCompletedMs: 1_000,
      sendToFirstAssistantTextMs: 400,
      streamConnectedMs: 110,
      streamFirstByteMs: 120,
      streamHandshakeMs: 10,
      usageTotalTokens: 120,
    },
    nonce: createPairNonce("experiment", "seed", 1),
    crossoverPhase: plan.phase,
    intentAt: "2026-07-19T00:00:00.000Z",
    journey: plan.journey,
    order: plan.pairOrder,
    output: {
      expectedCanonicalCharacters: 520,
      integerCount: 120,
      nonceOccurrences: 1,
      reason: null,
      valid: true,
    },
    pair: plan.pair,
    phase: plan.phase,
    runId: "run-1",
    sentAt: "2026-07-19T00:00:00.100Z",
    sequence: plan.sequence,
    stack: plan.stack,
    startedAt: "2026-07-19T00:00:00.000Z",
    threadId: "thread-1",
    variant: plan.variant,
    workerVersionCreate: "worker-version",
    workerVersionSend: "worker-version",
    workerVersionStream: "worker-version",
  };
}

function identity(): ObservedRunIdentity {
  return {
    containerApplicationId: "container-app",
    containerDeploymentId: "container-deployment",
    containerDurableObjectId: "container-do",
    containerObservedAt: "2026-07-19T00:00:01.500Z",
    containerPlacementId: "container-placement",
    driverBundleSha256: "driver-sha",
    driverCreatedAt: "2026-07-19T00:00:01.000Z",
    driverInstanceId: "driver-1",
    sandboxId: "sandbox-1",
    sandboxSessionId: "sandbox-session-1",
  };
}

function trace(): ObservedRunTrace {
  return {
    runAcceptedAt: "2026-07-19T00:00:01.000Z",
    timings: (
      [
        ["api", "context_hydration"],
        ["api", "prepare_run"],
        ["api", "driver_turn"],
        ["driver", "driver_turn"],
      ] as const
    ).map(([source, stage], index) => ({
      eventId: `event-${index}`,
      occurredAt: "2026-07-19T00:00:01.500Z",
      seq: index + 1,
      timing: {
        completedAtMs: 1_100 + index,
        path: "cold",
        phases: [],
        runId: "run-1",
        sessionId: "thread-1",
        source,
        stage,
        startedAtMs: 1_000,
        totalMs: 100 + index,
        traceId: "trace-1",
      },
    })),
  };
}

function sampledAttempt(): PendingAttempt {
  const prepared = createPendingAttempt({
    attemptStartedAt: "2026-07-19T00:00:00.000Z",
    deploymentOrdinal: 1,
    executionOrdinal: 1,
    nonce: createPairNonce("experiment", "seed", 1),
    plan,
  });
  return {
    ...prepared,
    sample: sample(),
    stage: "sampled",
    updatedAt: "2026-07-19T00:00:02.000Z",
  };
}

function experimentRun(): ExperimentRun {
  return {
    ...plan,
    cleanup: {
      containerGone: true,
      threadDeleted: true,
      verifiedAt: "2026-07-19T00:00:03.000Z",
    },
    deploymentOrdinal: 1,
    executionOrdinal: 1,
    identity: identity(),
    nonce: createPairNonce("experiment", "seed", 1),
    sample: sample(),
    trace: trace(),
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("cold-start benchmark provenance", () => {
  test("enforces the pre-registered remote-run and wall-clock budget", () => {
    const parsed = parseExistingDocument(document(), "experiment", harnessRevision);
    const startedAtMs = Date.parse(parsed.createdAt);

    expect(benchmarkBudgetUsage(parsed, startedAtMs + 1_000)).toEqual({
      attemptedRuns: 0,
      elapsedMs: 1_000,
      failedAttempts: 0,
      usageTotalTokens: 0,
    });
    expect(() =>
      assertBenchmarkBudget(
        {
          ...parsed,
          method: {
            ...parsed.method,
            budget: { ...parsed.method.budget, maxAttemptedRuns: 0 },
          },
        },
        { nowMs: startedAtMs + 1_000, reserveRun: true },
      ),
    ).toThrow("exhausted its remote-run budget");
    expect(() =>
      assertBenchmarkBudget(parsed, {
        nowMs: startedAtMs + parsed.method.budget.maxWallClockMs + 1,
      }),
    ).toThrow("exhausted its wall-clock budget");
  });

  test("maps stack-specific infrastructure into generic hook bindings", () => {
    const environment = {
      MOSOO_PERF_B_BASE_URL: "https://b.example.test",
      MOSOO_PERF_B_CF_ENV: "perf_b",
      MOSOO_PERF_B_CONTAINER_APPLICATION_NAME: "container-b",
      MOSOO_PERF_B_D1_DATABASE_ID: "d1-b",
      MOSOO_PERF_B_RESOURCE_PREFIX: "stage-b-",
      MOSOO_PERF_B_WORKER_NAME: "worker-b",
      MOSOO_PERF_B_WRANGLER_TEMPLATE: "/templates/perf.toml",
    };

    expect(stackHookEnvironment("b", environment)).toEqual({
      MOSOO_PERF_BASE_URL: "https://b.example.test",
      MOSOO_PERF_CF_ENV: "perf_b",
      MOSOO_PERF_CONTAINER_APPLICATION_NAME: "container-b",
      MOSOO_PERF_D1_DATABASE_ID: "d1-b",
      MOSOO_PERF_RESOURCE_PREFIX: "stage-b-",
      MOSOO_PERF_WORKER_NAME: "worker-b",
      MOSOO_PERF_WRANGLER_TEMPLATE: "/templates/perf.toml",
    });
  });

  test("rejects any shared stateful resource between physical A/B stacks", () => {
    const a = stackHookEnvironment("a", stackEnvironment());
    const b = stackHookEnvironment("b", stackEnvironment());
    expect(() => assertDistinctStackHookEnvironments(a, b)).not.toThrow();
    expect(() =>
      assertDistinctStackHookEnvironments(a, {
        ...b,
        MOSOO_PERF_D1_DATABASE_ID: a.MOSOO_PERF_D1_DATABASE_ID,
      }),
    ).toThrow("MOSOO_PERF_D1_DATABASE_ID");
    expect(() =>
      assertDistinctStackHookEnvironments(a, {
        ...b,
        MOSOO_PERF_RESOURCE_PREFIX: `${a.MOSOO_PERF_RESOURCE_PREFIX}b-`,
      }),
    ).toThrow("prefixes overlap");
  });

  test("requires identical model, runtime, provider, and deployed Agent config across stacks", () => {
    const a = runtimeFixture("a");
    const b = runtimeFixture("b");
    expect(() => assertEquivalentRuntimeFixtures(a, b)).not.toThrow();
    expect(() =>
      assertEquivalentRuntimeFixtures(a, { ...b, agentConfigSha256: "different-config" }),
    ).toThrow("agentConfigSha256");
    expect(() => assertEquivalentRuntimeFixtures(a, { ...b, model: "different-model" })).toThrow(
      "model",
    );
  });

  test("requires a Send Worker identity only for the two-stage journey", () => {
    const oneShotObservation = {
      workerVersionCreate: "worker-version",
      workerVersionSend: null,
      workerVersionStream: "worker-version",
    };
    expect(httpWorkerIdentityMatches("one-shot", "worker-version", oneShotObservation)).toBeTrue();
    expect(
      httpWorkerIdentityMatches("two-stage", "worker-version", oneShotObservation),
    ).toBeFalse();
    expect(
      httpWorkerIdentityMatches("two-stage", "worker-version", {
        ...oneShotObservation,
        workerVersionSend: "worker-version",
      }),
    ).toBeTrue();
  });

  test("accepts only explicit same-Thread runless startup timings in trace identity", () => {
    const runTrace = trace();
    const prewarmBackend = {
      eventId: "event-prewarm-backend",
      occurredAt: "2026-07-19T00:00:00.900Z",
      seq: 5,
      timing: {
        completedAtMs: 900,
        path: "prewarm" as const,
        phases: [],
        runId: null,
        sessionId: "thread-1",
        source: "driver" as const,
        stage: "driver_backend" as const,
        startedAtMs: 100,
        totalMs: 800,
        traceId: null,
      },
    };

    expect(
      parseTrace(
        { ...runTrace, timings: [...runTrace.timings, prewarmBackend] },
        { runId: "run-1", threadId: "thread-1" },
      ).timings,
    ).toHaveLength(5);
    expect(
      parseTrace(
        {
          ...runTrace,
          timings: [
            ...runTrace.timings,
            { ...prewarmBackend, timing: { ...prewarmBackend.timing, path: "cold" } },
          ],
        },
        { runId: "run-1", threadId: "thread-1" },
      ).timings,
    ).toHaveLength(5);
    expect(() =>
      parseTrace(
        {
          ...runTrace,
          timings: [
            ...runTrace.timings,
            { ...prewarmBackend, timing: { ...prewarmBackend.timing, source: "api" } },
          ],
        },
        { runId: "run-1", threadId: "thread-1" },
      ),
    ).toThrow("did not match");
  });

  test("uses an authoritative trace timestamp before the one-shot ULID fallback", () => {
    const authoritative = "2026-07-19T15:40:23.000Z";
    expect(
      parseTrace(
        { ...trace(), runAcceptedAt: authoritative },
        { journey: "one-shot", runId: "run-1", threadId: "thread-1" },
      ).runAcceptedAt,
    ).toBe(authoritative);
  });

  test("derives only a legacy one-shot Run acceptance timestamp from its canonical ULID", () => {
    const runId = "01KXXGJ6S190W4NJTH6VX18RSH";
    const legacyTimings = structuredClone(trace().timings);
    for (const entry of legacyTimings) {
      Object.assign(entry.timing, { runId });
    }
    expect(deriveLegacyOneShotRunAcceptedAt(runId)).toBe("2026-07-19T15:40:22.177Z");
    expect(
      parseTrace({ timings: legacyTimings }, { journey: "one-shot", runId, threadId: "thread-1" })
        .runAcceptedAt,
    ).toBe("2026-07-19T15:40:22.177Z");
    expect(() =>
      parseTrace({ timings: legacyTimings }, { journey: "two-stage", runId, threadId: "thread-1" }),
    ).toThrow("requires runAcceptedAt");
    expect(() =>
      parseTrace(
        { timings: trace().timings },
        { journey: "one-shot", runId: "not-a-ulid", threadId: "thread-1" },
      ),
    ).toThrow("canonical Run ULID");
  });

  test("captures every fixed trace snapshot and returns the last complete one", async () => {
    const snapshots = [
      { ...trace(), runAcceptedAt: "2026-07-19T00:00:01.000Z" },
      { ...trace(), runAcceptedAt: "2026-07-19T00:00:02.000Z" },
      { ...trace(), runAcceptedAt: "2026-07-19T00:00:03.000Z" },
    ];
    const waits: number[] = [];
    let calls = 0;
    const settled = await captureFixedTraceEvidence({
      capture: async () => snapshots[calls++]!,
      expected: {
        journey: "one-shot",
        runId: "run-1",
        threadId: "thread-1",
        variant: "before",
      },
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    });

    expect(calls).toBe(3);
    expect(waits).toEqual([500, 1_000]);
    expect(settled.runAcceptedAt).toBe("2026-07-19T00:00:03.000Z");
  });

  test("does not rerun a sample when fixed trace snapshots are transient or incomplete", async () => {
    let calls = 0;
    const settled = await captureFixedTraceEvidence({
      capture: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("transient trace transport");
        }
        return calls === 2
          ? { ...trace(), timings: [] }
          : { ...trace(), runAcceptedAt: "2026-07-19T00:00:03.000Z" };
      },
      expected: {
        journey: "one-shot",
        runId: "run-1",
        threadId: "thread-1",
        variant: "before",
      },
      wait: async () => {},
    });
    expect(calls).toBe(3);
    expect(settled.runAcceptedAt).toBe("2026-07-19T00:00:03.000Z");

    calls = 0;
    let failure: unknown = null;
    try {
      await captureFixedTraceEvidence({
        capture: async () => {
          calls += 1;
          return { ...trace(), timings: [] };
        },
        expected: {
          journey: "one-shot",
          runId: "run-1",
          threadId: "thread-1",
          variant: "before",
        },
        wait: async () => {},
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("required timing marker");
    expect(calls).toBe(3);
  });

  test("rejects a template without target-stack bindings and keeps main treatment-relative", () => {
    const valid = `main = "src/index.ts"\n[env.perf_b]\nname = "worker-b"\n[env.perf_b.vars]\nWEB_ORIGIN = "https://b.example.test"\nQUEUE_NAME_PREFIX = "stage-b-"\n[[env.perf_b.containers]]\nimage = "../driver/Dockerfile"\n[[env.perf_b.d1_databases]]\ndatabase_id = "d1-b"\n[[env.perf_b.r2_buckets]]\nbucket_name = "stage-b-files"\n[[env.perf_b.queues.producers]]\nqueue = "stage-b-command"\n`;
    expect(() =>
      validateStackWranglerConfig(valid, {
        apiRoot: "/treatment/apps/api",
        baseURL: "https://b.example.test",
        databaseId: "d1-b",
        environment: "perf_b",
        resourcePrefix: "stage-b-",
        workerName: "worker-b",
      }),
    ).not.toThrow();
    expect(() =>
      validateStackWranglerConfig(valid.replace("[env.perf_b]", "[env.perf_a]"), {
        apiRoot: "/treatment/apps/api",
        baseURL: "https://b.example.test",
        databaseId: "d1-b",
        environment: "perf_b",
        resourcePrefix: "stage-b-",
        workerName: "worker-b",
      }),
    ).toThrow("missing [env.perf_b]");
    expect(() =>
      validateStackWranglerConfig(
        valid.replace('main = "src/index.ts"', 'main = "/candidate/index.ts"'),
        {
          apiRoot: "/treatment/apps/api",
          baseURL: "https://b.example.test",
          databaseId: "d1-b",
          environment: "perf_b",
          resourcePrefix: "stage-b-",
          workerName: "worker-b",
        },
      ),
    ).toThrow("relative main inside the treatment root");
    expect(() =>
      validateStackWranglerConfig(
        valid.replace('queue = "stage-b-command"', 'queue = "stage-a-command"'),
        {
          apiRoot: "/treatment/apps/api",
          baseURL: "https://b.example.test",
          databaseId: "d1-b",
          environment: "perf_b",
          resourcePrefix: "stage-b-",
          workerName: "worker-b",
        },
      ),
    ).toThrow("cross-stack perf_b resources");
  });

  test("hashes harness contents without binding the hook path", async () => {
    const sourceHook = resolve(import.meta.dir, "../../bin/perf-stage-hook.ts");
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    const firstHook = join(firstRoot, "hook.ts");
    const secondHook = join(secondRoot, "hook.ts");
    const contents = await readFile(sourceHook);
    await Promise.all([writeFile(firstHook, contents), writeFile(secondHook, contents)]);

    const first = await computeHarnessRevision(firstHook);
    const second = await computeHarnessRevision(secondHook);

    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify({ harnessRevision: first })).not.toContain(firstRoot);
    expect(JSON.stringify({ harnessRevision: first })).not.toContain("secret-value");
  });

  test("fails when hook bytes change during an execution", async () => {
    const root = await temporaryRoot();
    const hook = join(root, "hook.ts");
    await writeFile(hook, await readFile(resolve(import.meta.dir, "../../bin/perf-stage-hook.ts")));
    const expected = await computeHarnessRevision(hook);

    await writeFile(hook, "// changed\n", { flag: "a" });

    expect(assertHarnessRevision(hook, expected)).rejects.toThrow(
      "Performance harness changed during execution",
    );
  });

  test("rejects pre-crossover resume and incomplete deployment provenance", () => {
    expect(() =>
      parseExistingDocument(
        { ...document(), schemaVersion: "mosoo.cold-start-ab.v5" },
        "experiment",
        harnessRevision,
      ),
    ).toThrow("v5 did not bind harness/provenance; start a new v7 output.");
    expect(() =>
      parseExistingDocument(
        { ...document(), schemaVersion: "mosoo.cold-start-ab.v6" },
        "experiment",
        harnessRevision,
      ),
    ).toThrow("v6 did not journal interrupted attempts; start a new v7 output.");
    expect(() =>
      parseExistingDocument(
        { ...document(), schemaVersion: "mosoo.cold-start-ab.v7" },
        "experiment",
        harnessRevision,
      ),
    ).toThrow("v7 did not bind the dual-stack crossover; start a new v8 output.");
    expect(() =>
      parseExistingDocument(
        { ...document(), schemaVersion: "mosoo.cold-start-ab.v8" },
        "experiment",
        harnessRevision,
      ),
    ).toThrow("v8 did not journal Container rollouts; start a new v9 output.");
    expect(() =>
      parseExistingDocument(
        { ...document(), schemaVersion: "mosoo.cold-start-ab.v9" },
        "experiment",
        harnessRevision,
      ),
    ).toThrow(
      "v9 conflated trace completeness with prewarm deadline hits; start a new v10 output.",
    );
    expect(() =>
      parseExistingDocument(
        { ...document(), schemaVersion: "mosoo.cold-start-ab.v10" },
        "experiment",
        harnessRevision,
      ),
    ).toThrow(
      "v10 treated earlier streaming as a completion-tail regression; start a new v11 output.",
    );
    expect(() =>
      parseExistingDocument(
        { ...document(), schemaVersion: "mosoo.cold-start-ab.v11" },
        "experiment",
        harnessRevision,
      ),
    ).toThrow("v11 lacked fixed trace settlement");

    const missingWorker: Record<string, unknown> = { ...deployment() };
    delete missingWorker["workerBundleSha256"];
    expect(() =>
      parseExistingDocument(
        { ...document(), deployments: [missingWorker] },
        "experiment",
        harnessRevision,
      ),
    ).toThrow("workerBundleSha256");
  });

  test("persists an uncertain rollout before remote deployment can run", () => {
    const pendingDeployment = {
      ordinal: 2,
      phase: 1,
      stack: "b",
      startedAt: "2026-07-19T00:00:00.000Z",
      variant: "after",
    } as const;
    const parsed = parseExistingDocument(
      { ...document(), pendingDeployment },
      "experiment",
      harnessRevision,
    );

    expect(parsed.pendingDeployment).toEqual(pendingDeployment);
  });

  test("rejects deployment and execution ordinal or harness drift", () => {
    expect(() =>
      parseExistingDocument(
        { ...document(), deployments: [{ ...deployment(), ordinal: 2 }] },
        "experiment",
        harnessRevision,
      ),
    ).toThrow("wrong stack, phase, variant, or ordinal");
    expect(() =>
      parseExistingDocument(
        {
          ...document(),
          executions: [
            { ...document().executions[0], harnessRevision: `sha256:${"b".repeat(64)}` },
          ],
        },
        "experiment",
        harnessRevision,
      ),
    ).toThrow("used a different harness revision");
  });

  test("fails fast when a new deployment drifts from its variant treatment", () => {
    expect(() =>
      assertDeploymentTreatmentStable([deployment()], {
        ...deployment(),
        ordinal: 2,
        workerBundleSha256: "drifted-worker-sha",
      }),
    ).toThrow("Deployment treatment drifted for variant before: workerBundleSha256.");
  });

  test("fails fast when a logical stack moves physical infrastructure", () => {
    expect(() =>
      assertDeploymentTreatmentStable([deployment()], {
        ...deployment(),
        ordinal: 2,
        phase: 2,
        physicalStackId: "different-stack",
        variant: "after",
      }),
    ).toThrow("Physical stack a changed during crossover.");
  });

  test("persists every recovery stage and archives an interrupted cleaned sample", async () => {
    const persisted: PendingAttempt[] = [];
    const completed = await reconcilePendingAttempt({
      attempt: sampledAttempt(),
      captureIdentity: async () => identity(),
      captureTrace: async () => trace(),
      deleteThread: async () => {},
      persist: async (attempt) => {
        persisted.push(attempt);
      },
      validateIdentity: () => {},
      verifyCleanup: async () => ({
        containerGone: true,
        threadDeleted: true,
        verifiedAt: "2026-07-19T00:00:03.000Z",
      }),
    });

    expect(persisted.map((attempt) => [attempt.stage, attempt.cleanup.threadDeleted])).toEqual([
      ["identified", false],
      ["traced", false],
      ["traced", true],
      ["cleaned", true],
    ]);
    const failed = archiveRecoveredAttempt(completed);
    expect(failed.primaryError.stage).toBe("execution_interrupted");
    expect(failed.sample).toEqual(sample());
    expect(failed.cleanup).toMatchObject({ containerGone: true, threadDeleted: true });
    const resumed = parseExistingDocument(
      { ...document(), failedAttempts: [failed] },
      "experiment",
      harnessRevision,
    );
    expect(resumed.failedAttempts).toEqual([failed]);
  });

  test("records incomplete trace once and still cleans the failed sample", async () => {
    const persisted: PendingAttempt[] = [];
    let deleted = false;
    let traceCalls = 0;
    const recovery = await reconcilePendingAttempt({
      attempt: sampledAttempt(),
      captureIdentity: async () => identity(),
      captureTrace: async () => {
        traceCalls += 1;
        return { runAcceptedAt: "2026-07-19T00:00:01.000Z", timings: [] };
      },
      deleteThread: async () => {
        deleted = true;
      },
      persist: async (attempt) => {
        persisted.push(attempt);
      },
      validateIdentity: () => {},
      verifyCleanup: async () => ({
        containerGone: true,
        threadDeleted: true,
        verifiedAt: "2026-07-19T00:00:03.000Z",
      }),
    });

    expect(traceCalls).toBe(1);
    expect(deleted).toBeTrue();
    expect(recovery).toMatchObject({
      cleanup: { containerGone: true, threadDeleted: true },
      primaryError: { stage: "trace" },
      sample: { runId: "run-1", threadId: "thread-1" },
      stage: "cleaned",
      trace: { runAcceptedAt: "2026-07-19T00:00:01.000Z", timings: [] },
    });
    expect(() => completedAttemptRun(recovery)).toThrow("not complete enough to record");
    expect(archiveRecoveredAttempt(recovery).primaryError.stage).toBe("trace");
  });

  test("preserves the sampled run failure when trace evidence is also incomplete", async () => {
    const completed = await reconcilePendingAttempt({
      attempt: {
        ...sampledAttempt(),
        sample: {
          ...sample(),
          failure: {
            message: "Public API run emitted run.failed.",
            stage: "read_stream",
          },
        },
      },
      captureIdentity: async () => identity(),
      captureTrace: async () => {
        throw new Error("Trace hook result requires runAcceptedAt.");
      },
      deleteThread: async () => {},
      persist: async () => {},
      validateIdentity: () => {},
      verifyCleanup: async () => ({
        containerGone: true,
        threadDeleted: true,
        verifiedAt: "2026-07-19T00:00:03.000Z",
      }),
    });

    expect(archiveRecoveredAttempt(completed).primaryError).toMatchObject({
      message: "Public API run emitted run.failed.",
      stage: "sample",
    });
  });

  test("records a late prewarm as a completed ITT run instead of a failed attempt", async () => {
    const runTrace = trace();
    const latePrewarmTrace: ObservedRunTrace = {
      ...runTrace,
      timings: [
        {
          eventId: "event-late-api-prewarm",
          occurredAt: "2026-07-19T00:00:01.200Z",
          seq: 0,
          timing: {
            completedAtMs: Date.parse("2026-07-19T00:00:01.200Z"),
            path: "prewarm",
            phases: [],
            runId: null,
            sessionId: "thread-1",
            source: "api",
            stage: "prewarm",
            startedAtMs: Date.parse("2026-07-19T00:00:00.100Z"),
            totalMs: 1_100,
            traceId: null,
          },
        },
        ...runTrace.timings.map((entry) =>
          entry.timing.stage === "prepare_run"
            ? Object.assign({}, entry, {
                timing: Object.assign({}, entry.timing, { path: "warm" as const }),
              })
            : entry,
        ),
      ],
    };
    const afterAttempt: PendingAttempt = {
      ...sampledAttempt(),
      sample: { ...sample(), stack: "b", variant: "after" },
      stack: "b",
      variant: "after",
    };
    const completed = await reconcilePendingAttempt({
      attempt: afterAttempt,
      captureIdentity: async () => identity(),
      captureTrace: async () => latePrewarmTrace,
      deleteThread: async () => {},
      persist: async () => {},
      validateIdentity: () => {},
      verifyCleanup: async () => ({
        containerGone: true,
        threadDeleted: true,
        verifiedAt: "2026-07-19T00:00:03.000Z",
      }),
    });

    expect(completed.primaryError).toBeNull();
    expect(completedAttemptRun(completed)).toMatchObject({
      stack: "b",
      variant: "after",
    });
  });

  test("preserves actual identity and cleans a mismatched deployment", async () => {
    const actual = { ...identity(), driverBundleSha256: "unexpected-driver" };
    const completed = await reconcilePendingAttempt({
      attempt: sampledAttempt(),
      captureIdentity: async () => actual,
      captureTrace: async () => trace(),
      deleteThread: async () => {},
      persist: async () => {},
      validateIdentity: () => {
        throw new Error("Live runtime identity mismatch");
      },
      verifyCleanup: async (attempt) => {
        expect(attempt.identity).toEqual(actual);
        return {
          containerGone: true,
          threadDeleted: true,
          verifiedAt: "2026-07-19T00:00:03.000Z",
        };
      },
    });

    expect(completed).toMatchObject({
      cleanup: { containerGone: true, threadDeleted: true },
      identity: actual,
      primaryError: { stage: "identity" },
      stage: "cleaned",
    });
    expect(() => completedAttemptRun(completed)).toThrow("not complete enough to record");
  });

  test("keeps the primary failure separately from cleanup and resumes after deletion", async () => {
    let pending: PendingAttempt = {
      ...sampledAttempt(),
      identity: identity(),
      primaryError: {
        at: "2026-07-19T00:00:01.000Z",
        message: "identity temporarily unavailable",
        name: "Error",
        stage: "identity",
      },
      stage: "traced",
      trace: trace(),
    };
    let deleteCalls = 0;
    const persist = async (attempt: PendingAttempt) => {
      pending = attempt;
    };
    const first = reconcilePendingAttempt({
      attempt: pending,
      captureIdentity: async () => identity(),
      captureTrace: async () => trace(),
      deleteThread: async () => {
        deleteCalls += 1;
      },
      persist,
      validateIdentity: () => {},
      verifyCleanup: async () => {
        throw new Error("cleanup unavailable");
      },
    });

    expect(first).rejects.toThrow("cleanup unavailable");
    expect(pending).toMatchObject({
      cleanup: { containerGone: false, threadDeleted: true, verifiedAt: null },
      cleanupError: { message: "cleanup unavailable", stage: "cleanup" },
      primaryError: { message: "identity temporarily unavailable", stage: "identity" },
      sample: { runId: "run-1", threadId: "thread-1" },
      stage: "traced",
    });

    const completed = await reconcilePendingAttempt({
      attempt: pending,
      captureIdentity: async () => identity(),
      captureTrace: async () => trace(),
      deleteThread: async () => {
        deleteCalls += 1;
      },
      persist,
      validateIdentity: () => {},
      verifyCleanup: async () => ({
        containerGone: true,
        threadDeleted: true,
        verifiedAt: "2026-07-19T00:00:04.000Z",
      }),
    });

    expect(deleteCalls).toBe(1);
    expect(completed.stage).toBe("cleaned");
    expect(archiveRecoveredAttempt(completed).primaryError).toMatchObject({
      message: "identity temporarily unavailable",
      stage: "identity",
    });
  });

  test("fails closed when interruption left only a prepared attempt", async () => {
    let pending = createPendingAttempt({
      attemptStartedAt: "2026-07-19T00:00:00.000Z",
      deploymentOrdinal: 1,
      executionOrdinal: 1,
      nonce: createPairNonce("experiment", "seed", 1),
      plan,
    });
    const recovery = reconcilePendingAttempt({
      attempt: pending,
      captureIdentity: async () => identity(),
      captureTrace: async () => trace(),
      deleteThread: async () => {},
      persist: async (attempt) => {
        pending = attempt;
      },
      validateIdentity: () => {},
      verifyCleanup: async () => ({
        containerGone: true,
        threadDeleted: true,
        verifiedAt: "2026-07-19T00:00:03.000Z",
      }),
    });

    expect(recovery).rejects.toThrow("cannot prove remote cleanup");
    expect(pending).toMatchObject({
      primaryError: { stage: "execution_interrupted" },
      sample: null,
      stage: "prepared",
    });
  });

  test("discards a resumed partial block once and validates its execution slice", () => {
    const parsed = parseExistingDocument(document(), "experiment", harnessRevision);
    parsed.runs = [experimentRun()];

    expect(discardPartialBlocks(parsed)).toBeTrue();
    expect(parsed.runs).toEqual([]);
    expect(parsed.discardedBlocks).toHaveLength(1);
    expect(parsed.discardedBlocks[0]?.runs).toHaveLength(1);
    expect(discardPartialBlocks(parsed)).toBeFalse();
    expect(parsed.discardedBlocks).toHaveLength(1);

    const wrongSlice = parseExistingDocument(
      {
        ...document(),
        executions: [{ ...document().executions[0], blockCount: 1, blockStart: 1 }],
        pendingAttempt: sampledAttempt(),
      },
      "experiment",
      harnessRevision,
    );
    const blocks = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    });
    expect(() => validateRecordedRuns(wrongSlice, blocks, "experiment", "seed")).toThrow(
      "invalid pending attempt",
    );
  });

  test("hashes Worker runtime files but ignores Wrangler metadata", async () => {
    const first = await temporaryRoot();
    const second = await temporaryRoot();
    const metadataOnly = await temporaryRoot();
    await Promise.all([
      mkdir(join(first, "nested")),
      mkdir(join(second, "nested")),
      writeFile(join(first, "index.js"), "export default 1;"),
      writeFile(join(second, "index.js"), "export default 1;"),
      writeFile(join(first, "README.md"), "generated at first"),
      writeFile(join(second, "README.md"), "generated at second"),
      writeFile(join(first, "index.js.map"), "first temp path"),
      writeFile(join(second, "index.js.map"), "second temp path"),
      writeFile(join(metadataOnly, "README.md"), "generated metadata"),
      writeFile(join(metadataOnly, "index.js.map"), "generated source map"),
    ]);
    await Promise.all([
      writeFile(join(first, "nested", "module.js"), "export const value = 1;"),
      writeFile(join(second, "nested", "module.js"), "export const value = 1;"),
    ]);

    expect(await hashWorkerRuntimeBundle(first)).toBe(await hashWorkerRuntimeBundle(second));
    await writeFile(join(second, "nested", "module.js"), "export const value = 2;");
    expect(await hashWorkerRuntimeBundle(first)).not.toBe(await hashWorkerRuntimeBundle(second));
    expect(hashWorkerRuntimeBundle(metadataOnly)).rejects.toThrow(
      "Wrangler output did not contain a Worker runtime file.",
    );
  });

  test("uses the content digest as the revision for a gitless frozen root", async () => {
    const root = await temporaryRoot();
    const digest = "a".repeat(64);

    expect(await readSourceRevision(root, digest)).toBe(`tree:${digest}`);
  });
});
