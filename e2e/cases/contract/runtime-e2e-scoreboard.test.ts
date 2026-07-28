import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRuntimeE2EScoreboard } from "../../bin/runtime-e2e-scoreboard";
import {
  buildRuntimeE2EScoreboard,
  renderRuntimeE2EScoreboardMarkdown,
  runtimeE2ESamplesFromColdStartDocument,
  summarizeRuntimeE2EScoreboard,
} from "../../lib/runtime-e2e-scoreboard";
import type {
  RuntimeE2EMetric,
  RuntimeE2ESample,
  RuntimeE2EStageEvidence,
} from "../../lib/runtime-e2e-scoreboard";

const BASELINE_COMMIT = "baseline-commit";
const CANDIDATE_COMMIT = "candidate-commit";
const HARNESS_REVISION = `sha256:${"a".repeat(64)}`;
const FAILURE_POLICY = "all recorded trials are retained; any failure invalidates qualification";

const FROZEN_GATE_NAMES = [
  "crossoverTreatmentsComplete",
  "exactlyFourDeployments",
  "completionP95NotWorse",
  "phaseCompletionMediansNotWorse",
  "resourceConfigurationStable",
  "sendP95NotWorse",
  "streamingP95NotWorse",
  "treatmentArtifactsStable",
  "twoPhysicalStacks",
] as const;

function available<T>(value: T): RuntimeE2EMetric<T> {
  return { source: "test", status: "available", value };
}

function measured(elapsedMs: number, evidenceId: string): RuntimeE2EStageEvidence {
  return { elapsedMs, evidenceId, source: "test", status: "measured" };
}

function completeSample(path: "cold" | "warm", ttftMs: number): RuntimeE2ESample {
  const correlationId = `${path}:${ttftMs}`;
  return {
    browserApply: measured(ttftMs, correlationId),
    correlationId,
    d1Commit: measured(2, correlationId),
    interDeltaP95Ms: available(20),
    pair: null,
    path: available(path),
    providerDirectVisibleCharactersPerSecond: available(200),
    providerFirstDelta: measured(1, correlationId),
    runId: `${path}-run`,
    sessionId: `${path}-session`,
    terminalSucceeded: available(true),
    transportReconnectRecovered: available(true),
    ttftMs: available(ttftMs),
    viewerPublish: measured(3, correlationId),
    visibleCharactersPerSecond: available(100),
  };
}

function browserDocument() {
  return {
    createdAt: "2026-07-28T00:00:00.000Z",
    excludedSamples: [],
    exclusionPolicy: "none; post-run exclusions invalidate qualification",
    failedSamples: [],
    failurePolicy: "retain every failed attempt and fail qualification",
    fixture: {
      agentConfigSha256: "agent-config",
      agentId: "agent",
      model: "deepseek-chat",
      providerId: "deepseek",
      runtimeId: "acp-fallback",
    },
    gitCommit: CANDIDATE_COMMIT,
    pairIds: [1, 2, 17, 18],
    sampleTarget: 4,
    samples: [1, 2, 17, 18].map((pair, index) => {
      const correlationId = `source-${index}`;
      const stage = (clockDomain: string, epochMs: number) => ({
        clockDomain,
        epochMs,
        evidenceId: correlationId,
      });
      return {
        browserApply: stage("browser.performance.timeOrigin", 4_000 + index),
        browserFrameReceived: stage("playwright.node.wall", 3_500 + index),
        correlationId,
        d1Commit: stage("api.driver-instance-do.wall", 2_000 + index),
        d1EventId: `event-${index}`,
        d1Seq: index + 1,
        interDeltaP95Ms: 20,
        outputCharacters: 520,
        outputEquivalent: true,
        pair,
        path: index === 0 ? "cold" : "warm",
        providerFirstDelta: stage("driver.event-envelope.wall", 1_000 + index),
        runId: `run-${index}`,
        sessionId: `session-${index}`,
        terminalStatus: "completed",
        terminalSucceeded: true,
        transportReconnectRecovered: index === 1 ? true : null,
        ttftMs: 100 + index,
        turnCompletedMs: 1_000 + index,
        viewerPublish: stage("api.session-do.wall", 3_000 + index),
        visibleCharactersPerSecond: 100,
      };
    }),
    schemaVersion: "mosoo.runtime-e2e-browser.v1",
    workload: {
      expectedOutputSha256: "output-sha",
      promptSha256: "prompt-sha",
      systemPromptSha256: "system-sha",
    },
  };
}

function providerDirectDocument() {
  return {
    cells: [
      {
        expectedOutputSha256: "output-sha",
        model: "deepseek-chat",
        outputValidation: "exact",
        promptSha256: "prompt-sha",
        providerId: "deepseek",
        runtimeId: "acp-fallback",
        systemPromptSha256: "system-sha",
        trials: Array.from({ length: 4 }, () => ({
          firstTextMs: 10,
          ok: true,
          outputChars: 520,
          totalMs: 1_010,
        })),
      },
    ],
    failurePolicy: FAILURE_POLICY,
    generatedStamp: CANDIDATE_COMMIT,
    schemaVersion: "mosoo.driver-ttft.v2",
    trials: 4,
    warmupTrialsPerCell: 1,
  };
}

function crossoverDocument() {
  const fixture = {
    agentConfigSha256: "agent-config",
    model: "deepseek-chat",
    providerId: "deepseek",
    runtimeId: "acp-fallback",
  };
  const pairs = [
    { block: 1, pair: 1, phase: 1 },
    { block: 1, pair: 2, phase: 1 },
    { block: 9, pair: 17, phase: 2 },
    { block: 9, pair: 18, phase: 2 },
  ];
  const runs = pairs.flatMap(({ block, pair, phase }, index) =>
    (["before", "after"] as const).map((variant) => {
      const candidate = variant === "after";
      const runId = `run-${pair}-${variant}`;
      const threadId = `thread-${pair}-${variant}`;
      return {
        block,
        pair,
        phase,
        sample: {
          failure: null,
          metrics: {
            interChunkP95Ms: (candidate ? 20 : 30) + index,
            runCompletedMs: (candidate ? 900 : 1_000) + index,
            sendToFirstAssistantTextMs: (candidate ? 100 : 120) + index,
          },
          output: { valid: true },
          runId,
          threadId,
        },
        trace: {
          timings: [
            {
              timing: {
                path: candidate ? "warm" : "cold",
                runId,
                sessionId: threadId,
                source: "api",
                stage: "prepare_run",
              },
            },
          ],
        },
        variant,
      };
    }),
  );
  return {
    deployments: ["before", "after", "before", "after"].map((variant) => ({
      sourceRevision: `git:${variant === "after" ? CANDIDATE_COMMIT : BASELINE_COMMIT}:tree:${variant}`,
      variant,
    })),
    discardedBlocks: [],
    executions: [
      { blockCount: 1, blockStart: 0 },
      { blockCount: 1, blockStart: 8 },
    ],
    failedAttempts: [],
    fixture,
    fixtureB: fixture,
    method: {
      budget: {
        maxAttemptedRuns: 64,
        maxFailedAttempts: 0,
        maxUsageTotalTokens: 200_000,
        maxWallClockMs: 21_600_000,
      },
      harnessRevision: HARNESS_REVISION,
      journey: "two-stage",
      sourceRegion: "staging-region",
      totalBlocks: 16,
      totalPairs: 32,
    },
    pendingAttempt: null,
    pendingDeployment: null,
    runs,
    schemaVersion: "mosoo.cold-start-ab.v12",
    summary: {
      gate: Object.fromEntries(FROZEN_GATE_NAMES.map((name) => [name, true])),
      identity: {
        completeRuns: 8,
        expectedRuns: 64,
        uniqueContainerDurableObjects: 8,
        uniqueDriverInstances: 8,
        uniqueSandboxes: 8,
      },
      output: { equivalentRuns: 8, expectedRuns: 64 },
      pairedSendToFirstAssistantText: {
        completeBlocks: 16,
        completePairs: 32,
        incompletePairs: 0,
      },
      prewarm: {
        controlColdRuns: 32,
        controlRuns: 32,
        deadlineHits: 31,
        expectedAfterRuns: 32,
        observedAfterRuns: 32,
        outcomeObservedRuns: 32,
      },
      trace: { completeRuns: 8, expectedRuns: 64 },
    },
  };
}

describe("runtime E2E performance scoreboard", () => {
  test("scores cold and warm runs with p99 and matched provider-direct rate", () => {
    const scoreboard = summarizeRuntimeE2EScoreboard(
      [completeSample("cold", 100), completeSample("cold", 200), completeSample("warm", 50)],
      "2026-07-28T00:00:00.000Z",
    );

    expect(scoreboard.cold.ttftMs).toEqual({
      source: "first visible output at the recorded consumer boundary",
      status: "available",
      value: { n: 2, p50: 100, p95: 200, p99: 200 },
    });
    expect(scoreboard.cold.visibleOutputRateVsProviderDirect).toMatchObject({
      status: "available",
      value: { p50: 0.5, p95: 0.5, p99: 0.5 },
    });
    expect(scoreboard.cold.correlation.completeSamples).toBe(2);
  });

  test("adapts frozen evidence without inventing unavailable stages", () => {
    const document = {
      discardedBlocks: [],
      failedAttempts: [
        {
          sample: {
            failure: { message: "provider failed", stage: "sample" },
            metrics: {},
            output: { valid: false },
            runId: null,
            threadId: null,
          },
          trace: null,
        },
      ],
      runs: [
        {
          sample: {
            failure: null,
            metrics: {
              assistantTextCharacters: 100,
              firstAssistantTextMs: 120,
              interChunkP95Ms: 30,
              runCompletedMs: 620,
              sendToFirstAssistantTextMs: 80,
            },
            output: { valid: true },
            runId: "run-1",
            threadId: "session-1",
          },
          trace: {
            timings: [
              {
                eventId: "timing-prepare",
                timing: {
                  path: "cold",
                  phases: [],
                  runId: "run-1",
                  sessionId: "session-1",
                  source: "api",
                  stage: "prepare_run",
                },
              },
            ],
          },
        },
      ],
      schemaVersion: "mosoo.cold-start-ab.v12",
    };
    const scoreboard = summarizeRuntimeE2EScoreboard(
      runtimeE2ESamplesFromColdStartDocument(document),
      "2026-07-28T00:00:00.000Z",
    );

    expect(scoreboard.cold.ttftMs).toMatchObject({
      status: "available",
      value: { p50: 80, p95: 80, p99: 80 },
    });
    expect(scoreboard.cold.correlation.stages.providerFirstDelta.unavailable).toBe(1);
    expect(scoreboard.cold.correlation.stages.d1Commit.unavailable).toBe(1);
    expect(scoreboard.cold.correlation.stages.browserApply.unavailable).toBe(1);
    expect(scoreboard.overallTerminalSuccess).toMatchObject({
      status: "available",
      value: { attempts: 2, rate: 0.5, successes: 1 },
    });
    expect(renderRuntimeE2EScoreboardMarkdown(scoreboard)).toContain("unavailable");
  });

  test("qualifies four staging pairs, fails closed on regression, and writes 0600 artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mosoo-runtime-e2e-scoreboard-"));
    const browserPath = join(directory, "browser.json");
    const providerPath = join(directory, "provider.json");
    const crossoverPath = join(directory, "crossover.json");
    const outputPath = join(directory, "scoreboard.json");

    try {
      const crossover = crossoverDocument();
      await Promise.all([
        writeFile(browserPath, JSON.stringify(browserDocument())),
        writeFile(providerPath, JSON.stringify(providerDirectDocument())),
        writeFile(crossoverPath, JSON.stringify(crossover)),
      ]);
      await runRuntimeE2EScoreboard(browserPath, providerPath, crossoverPath, outputPath, {
        baselineCommit: BASELINE_COMMIT,
        candidateCommit: CANDIDATE_COMMIT,
        expectedHarnessRevision: HARNESS_REVISION,
        generatedAt: "2026-07-28T00:00:00.000Z",
      });

      expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({
        qualification: {
          eligibleForPr: true,
          pairs: [{ pair: 1 }, { pair: 2 }, { pair: 17 }, { pair: 18 }],
          sampleCounts: {
            browser: 4,
            crossover: 8,
            providerDirect: 4,
            providerDirectWarmups: 1,
          },
        },
        schema: "mosoo.runtime-e2e-scoreboard.v2",
        totalSamples: 4,
      });
      expect(await readFile(outputPath.replace(".json", ".md"), "utf8")).toContain(
        "PR eligible: yes",
      );
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);

      const regressed = crossover.runs.find((run) => run.pair === 18 && run.variant === "after");
      if (regressed === undefined) {
        throw new Error("Synthetic crossover run is missing.");
      }
      regressed.sample.metrics.interChunkP95Ms = 300;
      crossover.summary.gate["streamingP95NotWorse"] = false;
      const rejected = buildRuntimeE2EScoreboard({
        artifactPaths: {
          browser: browserPath,
          crossover: crossoverPath,
          providerDirect: providerPath,
        },
        baselineCommit: BASELINE_COMMIT,
        browserDocument: browserDocument(),
        candidateCommit: CANDIDATE_COMMIT,
        crossoverDocument: crossover,
        expectedHarnessRevision: HARNESS_REVISION,
        providerDirectDocument: providerDirectDocument(),
      });
      expect(rejected.qualification.eligibleForPr).toBeFalse();
      expect(
        rejected.qualification.checks.find(
          (check) => check.name === "instrumentation_overhead_no_material_regression",
        ),
      ).toMatchObject({ passed: false });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
