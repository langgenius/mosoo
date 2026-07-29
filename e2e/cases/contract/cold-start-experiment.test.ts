import { describe, expect, test } from "bun:test";

import type { ColdStartRunResult } from "../../lib/cold-start-benchmark";
import {
  createBalancedBlockOrders,
  createInterleavedBlockPlans,
  createPairNonce,
  summarizeColdStartExperiment,
  toColdStartRunPlan,
} from "../../lib/cold-start-experiment";
import type {
  DeploymentIdentity,
  ExperimentRun,
  InterleavedRunPlan,
} from "../../lib/cold-start-experiment";

function deployment(
  ordinal: number,
  variant: "after" | "before",
  stack: "a" | "b" = variant === "before" ? "a" : "b",
  phase: 1 | 2 = 1,
): DeploymentIdentity {
  return {
    containerApplicationId: "container-app",
    containerApplicationVersion: variant === "before" ? "10" : "11",
    containerDiskMb: 4_000,
    containerInstanceType: "basic",
    containerMaxInstances: 100,
    containerMemoryMib: 1_024,
    containerVcpu: 0.25,
    deployedAt: "2026-07-19T00:00:00.000Z",
    driverBundleSha256: `${variant}-driver-sha`,
    imageDigest: `sha256:${variant}`,
    imageGzipProxyBytes: variant === "before" ? 1_000 : 500,
    imageUncompressedBytes: variant === "before" ? 2_000 : 1_000,
    ordinal,
    physicalStackId: `perf-stack-${stack}`,
    phase,
    readyAt: "2026-07-19T00:00:01.000Z",
    sourceRevision: `${variant}-revision`,
    stack,
    stackConfigSha256: `stack-${stack}-config-sha`,
    treatmentConfigSha256: "treatment-config-sha",
    variant,
    workerBundleSha256: `${variant}-worker-sha`,
    workerVersionId: `${variant}-worker-version`,
  };
}

function crossoverDeployments(): DeploymentIdentity[] {
  return [
    deployment(1, "before", "a", 1),
    deployment(2, "after", "b", 1),
    deployment(3, "after", "a", 2),
    deployment(4, "before", "b", 2),
  ];
}

function sample(
  plan: InterleavedRunPlan,
  index: number,
  firstTextMs: number,
  failure = false,
): ColdStartRunResult {
  return {
    ...toColdStartRunPlan(plan),
    cfColo: "SIN",
    cfRayCreate: `create-${index}-SIN`,
    cfRaySend: `send-${index}-SIN`,
    cfRayStream: `stream-${index}-SIN`,
    completedAt: "2026-07-19T00:00:02.000Z",
    failure: failure ? { message: "failed after first text", stage: "read_stream" } : null,
    fixture: {
      agentConfigSha256: "agent-config-sha",
      agentId: "agent-test",
      model: "model-test",
      providerId: "provider-test",
      runtimeId: "claude-agent-sdk",
    },
    metrics: {
      assistantChunkCount: 10,
      assistantEventCount: 10,
      assistantTextCharacters: 200,
      createAcceptedMs: 100,
      firstAssistantTextMs: firstTextMs + 10_000,
      intentToFirstAssistantTextMs: firstTextMs + 10_000,
      intentToSendMs: 10_000,
      interChunkMaxMs: plan.variant === "before" ? 30 : 20,
      interChunkP50Ms: plan.variant === "before" ? 20 : 10,
      interChunkP95Ms: plan.variant === "before" ? 30 : 20,
      pauseOver250MsCount: 0,
      pauseOver500MsCount: 0,
      runCompletedMs: failure ? null : firstTextMs + 10_500,
      sendToFirstAssistantTextMs: firstTextMs,
      streamConnectedMs: 120,
      streamFirstByteMs: 130,
      streamHandshakeMs: 20,
      usageTotalTokens: 300,
    },
    nonce: createPairNonce("experiment", "seed", plan.pair),
    crossoverPhase: plan.phase,
    intentAt: "2026-07-19T00:00:00.000Z",
    journey: plan.journey,
    output: {
      expectedCanonicalCharacters: 520,
      integerCount: 120,
      nonceOccurrences: 1,
      reason: null,
      valid: true,
    },
    runId: `run-${index}`,
    sentAt: "2026-07-19T00:00:10.000Z",
    startedAt: "2026-07-19T00:00:00.000Z",
    threadId: `thread-${index}`,
    workerVersionCreate: `${plan.variant}-worker-version`,
    workerVersionSend: `${plan.variant}-worker-version`,
    workerVersionStream: `${plan.variant}-worker-version`,
  };
}

function experimentRun(
  plan: InterleavedRunPlan,
  index: number,
  firstTextMs: number,
  failure = false,
): ExperimentRun {
  const expectedDeployment = crossoverDeployments().find(
    (candidate) => candidate.phase === plan.phase && candidate.stack === plan.stack,
  )!;

  return {
    ...plan,
    cleanup: {
      containerGone: true,
      threadDeleted: true,
      verifiedAt: "2026-07-19T00:00:03.000Z",
    },
    deploymentOrdinal: expectedDeployment.ordinal,
    executionOrdinal: 1,
    identity: {
      containerApplicationId: expectedDeployment.containerApplicationId,
      containerDeploymentId: `container-${index}`,
      containerDurableObjectId: `durable-object-${index}`,
      containerObservedAt: "2026-07-19T00:00:01.500Z",
      containerPlacementId: `placement-${index}`,
      driverBundleSha256: expectedDeployment.driverBundleSha256,
      driverCreatedAt: "2026-07-19T00:00:01.000Z",
      driverInstanceId: `driver-${index}`,
      sandboxId: `sandbox-${index}`,
      sandboxSessionId: `sandbox-session-${index}`,
    },
    nonce: createPairNonce("experiment", "seed", plan.pair),
    sample: sample(plan, index, firstTextMs, failure),
    trace: {
      runAcceptedAt: "2026-07-19T00:00:10.000Z",
      timings: [
        ...(plan.variant === "after"
          ? [
              {
                eventId: `timing-${index}-api-prewarm`,
                occurredAt: "2026-07-19T00:00:00.900Z",
                seq: 0,
                timing: {
                  completedAtMs: Date.parse("2026-07-19T00:00:00.900Z"),
                  path: "prewarm" as const,
                  phases: [],
                  runId: null,
                  sessionId: `thread-${index}`,
                  source: "api" as const,
                  stage: "prewarm" as const,
                  startedAtMs: Date.parse("2026-07-19T00:00:00.100Z"),
                  totalMs: 800,
                  traceId: null,
                },
              },
            ]
          : []),
        ...(
          [
            ["api", "context_hydration"],
            ["api", "prepare_run"],
            ["api", "driver_turn"],
            ["driver", "driver_turn"],
          ] as const
        ).map(([source, stage], stageIndex) => ({
          eventId: `timing-${index}-${source}-${stage}`,
          occurredAt: "2026-07-19T00:00:01.500Z",
          seq: stageIndex + 1,
          timing: {
            completedAtMs: Date.parse("2026-07-19T00:00:01.100Z") + stageIndex,
            path:
              stage === "prepare_run" && plan.variant === "after"
                ? ("warm" as const)
                : ("cold" as const),
            phases: [],
            runId: `run-${index}`,
            sessionId: `thread-${index}`,
            source,
            stage,
            startedAtMs: Date.parse("2026-07-19T00:00:01.000Z"),
            totalMs: 100 + stageIndex,
            traceId: `trace-${index}`,
          },
        })),
      ],
    },
  };
}

describe("interleaved cold-start experiment", () => {
  test("creates 16 balanced ABBA/BAAB blocks and 32 adjacent pairs", () => {
    const orders = createBalancedBlockOrders(16, "seed");
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(orders.filter((order) => order === "abba")).toHaveLength(8);
    expect(orders.filter((order) => order === "baab")).toHaveLength(8);
    expect(plans).toHaveLength(16);
    expect(new Set(plans.flatMap((block) => block.runs.map((run) => run.pair))).size).toBe(32);
    for (const phase of [1, 2] as const) {
      const phaseBlocks = plans.filter((block) => block.runs[0].phase === phase);
      expect(phaseBlocks).toHaveLength(8);
      expect(phaseBlocks.filter((block) => block.order === "abba")).toHaveLength(4);
      expect(phaseBlocks.filter((block) => block.order === "baab")).toHaveLength(4);
    }

    for (const block of plans) {
      expect(block.runs.map((run) => run.variant).join("")).toBe(
        block.order === "abba" ? "beforeafterafterbefore" : "afterbeforebeforeafter",
      );
      expect(block.runs.slice(0, 2).map((run) => run.pair)).toEqual([
        block.runs[0].pair,
        block.runs[0].pair,
      ]);
      expect(block.runs.slice(2).map((run) => run.pair)).toEqual([
        block.runs[2].pair,
        block.runs[2].pair,
      ]);
      for (const run of block.runs) {
        expect(run.journey).toBe("two-stage");
        expect(
          ((run.phase === 1) === (run.stack === "a")) === (run.variant === "before"),
        ).toBeTrue();
      }
    }
  });

  test("uses one stable nonce within each pair without variant leakage", () => {
    const before = createPairNonce("experiment", "seed", 1);
    const after = createPairNonce("experiment", "seed", 1);

    expect(before).toBe(after);
    expect(before).not.toContain("BEFORE");
    expect(before).not.toContain("AFTER");
    expect(createPairNonce("experiment", "seed", 2)).not.toBe(before);
    expect(createPairNonce("experiment", "seed", 1, 2)).not.toBe(before);
  });

  test("builds an independent one-shot API cohort without changing crossover balance", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      journey: "one-shot",
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) => {
      const run = experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600);
      return {
        ...run,
        trace: {
          ...run.trace!,
          timings: run
            .trace!.timings.filter(({ timing }) => timing.stage !== "prewarm")
            .map((entry) =>
              entry.timing.stage === "prepare_run"
                ? Object.assign({}, entry, {
                    timing: Object.assign({}, entry.timing, { path: "cold" as const }),
                  })
                : entry,
            ),
        },
      };
    });
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(plans.every((plan) => plan.journey === "one-shot")).toBeTrue();
    expect(summary.gate.traceComplete).toBeTrue();
    expect(summary.gate.prewarmOutcomeComplete).toBeTrue();
    expect(summary.gate.prewarmDeadlineHitRateAtLeast95Percent).toBeTrue();
    expect(summary.gate.controlColdPathComplete).toBeTrue();
    expect(summary.prewarm.expectedAfterRuns).toBe(0);
    expect(summary.prewarm.controlColdRuns).toBe(64);
    expect(summary.gate.retain).toBeTrue();
  });

  test("retains only a complete material improvement under clustered bootstrap", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 + plan.block : 600 + plan.block),
    );
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.pairedSendToFirstAssistantText.completeBlocks).toBe(16);
    expect(summary.pairedSendToFirstAssistantText.completePairs).toBe(32);
    expect(summary.pairedSendToFirstAssistantText.medianAfterMinusBeforeMs).toBe(-400);
    expect(summary.pairedSendToFirstAssistantText.phaseMedianAfterMinusBeforeMs).toEqual({
      1: -400,
      2: -400,
    });
    expect(summary.pairedSendToFirstAssistantText.clusterBootstrapMedianDeltaCi95).toEqual([
      -400, -400,
    ]);
    expect(summary.identity).toMatchObject({
      completeRuns: 64,
      expectedRuns: 64,
      uniqueContainerInstances: 64,
      uniqueContainerDurableObjects: 64,
      uniqueContainerPlacements: 64,
      uniqueDriverInstances: 64,
      uniqueSandboxes: 64,
    });
    expect(summary.output).toEqual({ equivalentRuns: 64, expectedRuns: 64 });
    expect(summary.gate.retain).toBeTrue();
    expect(summary.gate.crossoverTreatmentsComplete).toBeTrue();
    expect(summary.gate.phaseMediansImproved).toBeTrue();
    expect(summary.gate.sendMedianAtMost10Seconds).toBeTrue();
    expect(summary.gate.twoPhysicalStacks).toBeTrue();
  });

  test("keeps TTFT from a run that fails after its first text", () => {
    const plan = createInterleavedBlockPlans({
      blockCount: 1,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 2,
    })[0]!.runs[0];
    const run = experimentRun(plan, 1, 750, true);
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs: [run],
      seed: "seed",
      totalBlocks: 2,
    });
    const variant = plan.variant === "before" ? summary.before : summary.after;

    expect(variant.sendToFirstAssistantTextMs.n).toBe(1);
    expect(variant.failures).toBe(1);
    expect(summary.gate.retain).toBeFalse();
  });

  test("retains a proven improvement above the 10 second campaign target", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 15_000 : 10_500),
    );
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.gate.medianImprovementAtLeast20Percent).toBeTrue();
    expect(summary.gate.sendMedianAtMost10Seconds).toBeFalse();
    expect(summary.gate.retain).toBeTrue();
  });

  test("retains a proven improvement smaller than 20 percent", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 9_000 : 8_100),
    );
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.gate.medianImprovementAtLeast20Percent).toBeFalse();
    expect(summary.gate.sendMedianAtMost10Seconds).toBeTrue();
    expect(summary.gate.clusterBootstrapCiExcludesZero).toBeTrue();
    expect(summary.gate.retain).toBeTrue();
  });

  test("requires improvement in both crossover phases", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(
        plan,
        index,
        plan.variant === "before"
          ? plan.phase === 1
            ? 1_300
            : 1_000
          : plan.phase === 1
            ? 500
            : 1_100,
      ),
    );
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.pairedSendToFirstAssistantText.phaseMedianAfterMinusBeforeMs).toEqual({
      1: -800,
      2: 100,
    });
    expect(summary.gate.phaseMediansImproved).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("accepts physical Container deployment and placement reuse across cold DO runs", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) => {
      const run = experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600);
      if (run.identity !== null) {
        Object.assign(run.identity, {
          containerDeploymentId: "shared-physical-deployment",
          containerPlacementId: "shared-physical-placement",
        });
      }
      return run;
    });
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.identity).toMatchObject({
      completeRuns: 64,
      uniqueContainerDurableObjects: 64,
      uniqueContainerInstances: 1,
      uniqueContainerPlacements: 1,
      uniqueDriverInstances: 64,
      uniqueSandboxes: 64,
    });
    expect(summary.gate.identityComplete).toBeTrue();
    expect(summary.gate.retain).toBeTrue();
  });

  test("does not retain complete evidence while an attempt is pending", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      pendingAttempt: true,
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.gate.noPendingAttempt).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("rejects excluded attempts, late lead, or unequal Container resources", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const lateRuns = runs.map((run, index) =>
      index === 0
        ? {
            ...run,
            sample: {
              ...run.sample,
              metrics: { ...run.sample.metrics, intentToSendMs: 10_501 },
            },
          }
        : run,
    );
    const unequalResources = crossoverDeployments().map((entry, index) =>
      index === 0
        ? Object.assign({}, entry, { containerMemoryMib: entry.containerMemoryMib * 2 })
        : entry,
    );

    expect(
      summarizeColdStartExperiment({
        deployments: crossoverDeployments(),
        failedAttempts: 1,
        runs,
        seed: "seed",
        totalBlocks: 16,
      }).gate.noExcludedAttempts,
    ).toBeFalse();
    expect(
      summarizeColdStartExperiment({
        deployments: crossoverDeployments(),
        runs: lateRuns,
        seed: "seed",
        totalBlocks: 16,
      }).gate.leadTimingComplete,
    ).toBeFalse();
    const resourceSummary = summarizeColdStartExperiment({
      deployments: unequalResources,
      runs,
      seed: "seed",
      totalBlocks: 16,
    });
    expect(resourceSummary.gate.resourceConfigurationStable).toBeFalse();
    expect(resourceSummary.gate.retain).toBeFalse();
  });

  test("rejects an experiment whose run identity does not match its deployment", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const first = runs[0]!;
    runs[0] = {
      ...first,
      identity: first.identity === null ? null : { ...first.identity, driverBundleSha256: "wrong" },
    };
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.identity.completeRuns).toBe(63);
    expect(summary.gate.identityComplete).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("rejects Worker identity that was not observed on the HTTP requests", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const first = runs[0]!;
    runs[0] = {
      ...first,
      sample: { ...first.sample, workerVersionStream: "unobserved-worker-version" },
    };
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.identity.completeRuns).toBe(63);
    expect(summary.gate.identityComplete).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("keeps run-linked identity when Worker and benchmark clocks differ", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const first = runs[0]!;
    runs[0] = {
      ...first,
      identity:
        first.identity === null
          ? null
          : {
              ...first.identity,
              // These timestamps come from the Worker/D1 clock. The sample
              // timestamps come from the benchmark client and may be skewed.
              containerObservedAt: "2026-07-19T00:01:01.000Z",
              driverCreatedAt: "2026-07-19T00:01:00.000Z",
            },
    };
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.identity.completeRuns).toBe(64);
    expect(summary.gate.identityComplete).toBeTrue();
  });

  test("rejects identity sampled after the Driver startup window", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const first = runs[0]!;
    runs[0] = {
      ...first,
      identity:
        first.identity === null
          ? null
          : {
              ...first.identity,
              containerObservedAt: "2026-07-19T00:00:11.001Z",
              driverCreatedAt: "2026-07-19T00:00:01.000Z",
            },
    };
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.identity.completeRuns).toBe(63);
    expect(summary.gate.identityComplete).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("does not retain an experiment with incomplete timing evidence", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const afterIndex = runs.findIndex((run) => run.variant === "after");
    const after = runs[afterIndex]!;
    runs[afterIndex] = {
      ...after,
      trace: {
        runAcceptedAt: after.trace!.runAcceptedAt,
        timings: after.trace!.timings.filter(
          ({ timing }) => !(timing.source === "driver" && timing.stage === "driver_turn"),
        ),
      },
    };
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.trace.completeRuns).toBe(63);
    expect(summary.gate.traceComplete).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("keeps one late prewarm in the primary ITT sample and passes the 95% gate", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const lateIndexes = runs
      .map((run, index) => ({ index, variant: run.variant }))
      .filter(({ variant }) => variant === "after")
      .slice(0, 1)
      .map(({ index }) => index);
    for (const index of lateIndexes) {
      const after = runs[index]!;
      runs[index] = {
        ...after,
        trace: {
          ...after.trace!,
          timings: after.trace!.timings.map((entry) =>
            entry.timing.source === "api" && entry.timing.stage === "prewarm"
              ? Object.assign({}, entry, {
                  timing: Object.assign({}, entry.timing, {
                    completedAtMs: Date.parse("2026-07-19T00:00:10.001Z"),
                  }),
                })
              : entry,
          ),
        },
      };
    }
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.trace.completeRuns).toBe(64);
    expect(summary.pairedSendToFirstAssistantText.completePairs).toBe(32);
    expect(summary.prewarm.deadlineHits).toBe(31);
    expect(summary.prewarm.lateRuns).toBe(1);
    expect(summary.prewarm.deadlineHitRate).toBe(0.9688);
    expect(summary.gate.prewarmDeadlineHitRateAtLeast95Percent).toBeTrue();
    expect(summary.gate.retain).toBeTrue();
  });

  test("keeps two late prewarms in ITT but fails the fixed-denominator 95% gate", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const lateIndexes = runs
      .map((run, index) => ({ index, variant: run.variant }))
      .filter(({ variant }) => variant === "after")
      .slice(0, 2)
      .map(({ index }) => index);
    for (const index of lateIndexes) {
      const after = runs[index]!;
      runs[index] = {
        ...after,
        trace: {
          ...after.trace!,
          timings: after.trace!.timings.map((entry) =>
            entry.timing.source === "api" && entry.timing.stage === "prewarm"
              ? Object.assign({}, entry, {
                  timing: Object.assign({}, entry.timing, {
                    completedAtMs: Date.parse("2026-07-19T00:00:10.001Z"),
                  }),
                })
              : entry,
          ),
        },
      };
    }
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.trace.completeRuns).toBe(64);
    expect(summary.pairedSendToFirstAssistantText.completePairs).toBe(32);
    expect(summary.prewarm.deadlineHits).toBe(30);
    expect(summary.prewarm.lateRuns).toBe(2);
    expect(summary.gate.prewarmOutcomeComplete).toBeTrue();
    expect(summary.gate.prewarmDeadlineHitRateAtLeast95Percent).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("keeps an unknown prewarm outcome in ITT and fails evidence coverage", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const index = runs.findIndex((run) => run.variant === "after");
    const after = runs[index]!;
    runs[index] = {
      ...after,
      trace: {
        ...after.trace!,
        timings: after.trace!.timings.filter(
          ({ timing }) => !(timing.source === "api" && timing.stage === "prewarm"),
        ),
      },
    };
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.trace.completeRuns).toBe(64);
    expect(summary.pairedSendToFirstAssistantText.completePairs).toBe(32);
    expect(summary.prewarm.unknownRuns).toBe(1);
    expect(summary.gate.prewarmOutcomeComplete).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("requires two distinct physical stacks", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments().map((entry) =>
        Object.assign({}, entry, { physicalStackId: "collapsed-stack" }),
      ),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.identity.uniquePhysicalStacks).toBe(1);
    expect(summary.gate.identityComplete).toBeTrue();
    expect(summary.gate.twoPhysicalStacks).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("rejects an orphan fifth rollout even when retained runs do not reference it", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const driftedAfter = {
      ...deployment(5, "after", "b", 1),
      sourceRevision: "after-drifted-revision",
    };
    const summary = summarizeColdStartExperiment({
      deployments: [...crossoverDeployments(), driftedAfter],
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.gate.identityComplete).toBeTrue();
    expect(summary.gate.treatmentArtifactsStable).toBeTrue();
    expect(summary.gate.exactlyFourDeployments).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("keeps logical stack identity fixed across crossover phases", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const deployments = crossoverDeployments().map((entry) =>
      entry.phase === 1
        ? entry
        : Object.assign({}, entry, {
            physicalStackId: entry.stack === "a" ? "perf-stack-b" : "perf-stack-a",
          }),
    );
    const summary = summarizeColdStartExperiment({
      deployments,
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.identity.uniquePhysicalStacks).toBe(2);
    expect(summary.gate.twoPhysicalStacks).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("rejects Worker runtime artifact drift referenced by a retained run", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );
    const afterRunIndex = runs.findIndex((run) => run.variant === "after");
    const afterRun = runs[afterRunIndex]!;
    const expected = crossoverDeployments().find(
      (candidate) => candidate.phase === afterRun.phase && candidate.stack === afterRun.stack,
    )!;
    const driftedAfter = {
      ...expected,
      ordinal: 5,
      workerBundleSha256: "after-drifted-worker-sha",
    };
    runs[afterRunIndex] = { ...runs[afterRunIndex]!, deploymentOrdinal: driftedAfter.ordinal };
    const summary = summarizeColdStartExperiment({
      deployments: [...crossoverDeployments(), driftedAfter],
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.gate.identityComplete).toBeTrue();
    expect(summary.gate.treatmentArtifactsStable).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("rejects semantically invalid output even when both variants fail equally", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );

    for (const [index, run] of runs.entries()) {
      runs[index] = {
        ...run,
        sample: {
          ...run.sample,
          failure: { message: "duplicated output", stage: "validate_output" },
          output: {
            ...run.sample.output,
            nonceOccurrences: 2,
            reason: "nonce_occurrences" as const,
            valid: false,
          },
        },
      };
    }
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.gate.failureRateNotWorse).toBeTrue();
    expect(summary.output).toEqual({ equivalentRuns: 0, expectedRuns: 64 });
    expect(summary.gate.semanticOutputComplete).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });

  test("treats measurable streaming as better than one-shot output, but rejects collapse", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );

    for (const [index, run] of runs.entries()) {
      if (run.variant === "before") {
        runs[index] = {
          ...run,
          sample: {
            ...run.sample,
            metrics: {
              ...run.sample.metrics,
              assistantChunkCount: 1,
              interChunkMaxMs: null,
              interChunkP50Ms: null,
              interChunkP95Ms: null,
            },
          },
        };
      }
    }
    const improved = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });
    const collapsedRuns = plans.map((plan, index) =>
      experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600),
    );

    for (const [index, run] of collapsedRuns.entries()) {
      collapsedRuns[index] = {
        ...run,
        sample: {
          ...run.sample,
          metrics: {
            ...run.sample.metrics,
            assistantChunkCount: run.variant === "after" ? 1 : 10,
            interChunkMaxMs: run.variant === "after" ? null : 30,
            interChunkP50Ms: run.variant === "after" ? null : 20,
            interChunkP95Ms: run.variant === "after" ? null : 30,
          },
        },
      };
    }
    const collapsed = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs: collapsedRuns,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(improved.gate.streamingCoverageNotWorse).toBeTrue();
    expect(improved.gate.streamingP95NotWorse).toBeTrue();
    expect(improved.gate.retain).toBeTrue();
    expect(collapsed.gate.streamingCoverageNotWorse).toBeFalse();
    expect(collapsed.gate.streamingCoverageAtLeast95Percent).toBeFalse();
    expect(collapsed.gate.streamingP95NotWorse).toBeFalse();
    expect(collapsed.gate.retain).toBeFalse();
  });

  test("allows a longer post-first-text tail when total completion does not regress", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) => {
      const run = experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600);
      return plan.variant === "before"
        ? run
        : Object.assign({}, run, {
            sample: Object.assign({}, run.sample, {
              metrics: Object.assign({}, run.sample.metrics, {
                runCompletedMs: 11_500,
              }),
            }),
          });
    });
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.gate.medianImprovementAtLeast20Percent).toBeTrue();
    expect(summary.before.tailCompletionMs.p95).toBe(500);
    expect(summary.after.tailCompletionMs.p95).toBe(900);
    expect(summary.gate.completionP95NotWorse).toBeTrue();
    expect(summary.gate.phaseCompletionMediansNotWorse).toBeTrue();
    expect(summary.gate.retain).toBeTrue();
  });

  test("rejects faster first text when total completion regresses", () => {
    const plans = createInterleavedBlockPlans({
      blockCount: 16,
      blockStart: 0,
      seed: "seed",
      totalBlocks: 16,
    }).flatMap((block) => block.runs);
    const runs = plans.map((plan, index) => {
      const run = experimentRun(plan, index, plan.variant === "before" ? 1_000 : 600);
      return plan.variant === "before"
        ? run
        : Object.assign({}, run, {
            sample: Object.assign({}, run.sample, {
              metrics: Object.assign({}, run.sample.metrics, { runCompletedMs: 12_000 }),
            }),
          });
    });
    const summary = summarizeColdStartExperiment({
      deployments: crossoverDeployments(),
      runs,
      seed: "seed",
      totalBlocks: 16,
    });

    expect(summary.gate.completionP95NotWorse).toBeFalse();
    expect(summary.gate.phaseCompletionMediansNotWorse).toBeFalse();
    expect(summary.gate.retain).toBeFalse();
  });
});
