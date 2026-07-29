import { createHash } from "node:crypto";

import type {
  BenchmarkJourney,
  BenchmarkStack,
  BenchmarkVariant,
  ColdStartRunPlan,
  ColdStartRunResult,
  PairOrder,
} from "./cold-start-benchmark";
import { containerResourceFingerprint } from "./perf-stage-control";
export type { BenchmarkJourney, BenchmarkStack } from "./cold-start-benchmark";

export type BlockOrder = "abba" | "baab";
export type CrossoverPhase = 1 | 2;

export interface InterleavedRunPlan {
  readonly block: number;
  readonly blockOrder: BlockOrder;
  readonly journey: BenchmarkJourney;
  readonly pair: number;
  readonly pairOrder: PairOrder;
  readonly phase: CrossoverPhase;
  readonly position: 1 | 2 | 3 | 4;
  readonly sequence: 1 | 2;
  readonly stack: BenchmarkStack;
  readonly variant: BenchmarkVariant;
}

export interface InterleavedBlockPlan {
  readonly block: number;
  readonly order: BlockOrder;
  readonly runs: readonly [
    InterleavedRunPlan,
    InterleavedRunPlan,
    InterleavedRunPlan,
    InterleavedRunPlan,
  ];
}

export interface DeploymentIdentity {
  readonly containerApplicationId: string;
  readonly containerApplicationVersion: string;
  readonly containerDiskMb: number;
  readonly containerInstanceType: string;
  readonly containerMaxInstances: number;
  readonly containerMemoryMib: number;
  readonly containerVcpu: number;
  readonly deployedAt: string;
  readonly driverBundleSha256: string;
  readonly imageDigest: string;
  readonly imageGzipProxyBytes: number;
  readonly imageUncompressedBytes: number;
  readonly ordinal: number;
  readonly physicalStackId: string;
  readonly phase: CrossoverPhase;
  readonly readyAt: string;
  readonly sourceRevision: string;
  readonly stack: BenchmarkStack;
  readonly stackConfigSha256: string;
  readonly treatmentConfigSha256: string;
  readonly variant: BenchmarkVariant;
  readonly workerBundleSha256: string;
  readonly workerVersionId: string;
}

export interface ObservedRunIdentity {
  readonly containerApplicationId: string;
  readonly containerDeploymentId: string;
  readonly containerDurableObjectId: string;
  readonly containerObservedAt: string;
  readonly containerPlacementId: string;
  readonly driverBundleSha256: string;
  readonly driverCreatedAt: string;
  readonly driverInstanceId: string;
  readonly sandboxId: string;
  readonly sandboxSessionId: string;
}

export type ObservedRuntimeTimingStage =
  | "context_hydration"
  | "driver_backend"
  | "driver_turn"
  | "prepare_run"
  | "prewarm";

export interface ObservedRuntimeTiming {
  readonly completedAtMs: number;
  readonly path: "cold" | "prewarm" | "unknown" | "warm";
  readonly phases: readonly {
    readonly durationMs: number;
    readonly name: string;
  }[];
  readonly runId: string | null;
  readonly sessionId: string;
  readonly source: "api" | "driver";
  readonly stage: ObservedRuntimeTimingStage;
  readonly startedAtMs: number;
  readonly totalMs: number;
  readonly traceId: string | null;
}

export interface ObservedRuntimeTimingTraceEntry {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly seq: number;
  readonly timing: ObservedRuntimeTiming;
}

export interface ObservedRunTrace {
  readonly runAcceptedAt: string;
  readonly timings: readonly ObservedRuntimeTimingTraceEntry[];
}

export interface CleanupVerification {
  readonly containerGone: boolean;
  readonly threadDeleted: boolean;
  readonly verifiedAt: string;
}

export interface ExperimentRun extends InterleavedRunPlan {
  readonly cleanup: CleanupVerification | null;
  readonly deploymentOrdinal: number;
  readonly executionOrdinal: number;
  readonly identity: ObservedRunIdentity | null;
  readonly nonce: string;
  readonly sample: ColdStartRunResult;
  readonly trace: ObservedRunTrace | null;
}

export interface DistributionSummary {
  readonly max: number | null;
  readonly median: number | null;
  readonly n: number;
  readonly p95: number | null;
}

export interface ExperimentVariantSummary {
  readonly failureRate: number;
  readonly failures: number;
  readonly intentToFirstAssistantTextMs: DistributionSummary;
  readonly interChunkP95Ms: DistributionSummary;
  readonly pauseOver500MsCount: DistributionSummary;
  readonly runCompletedMs: DistributionSummary;
  readonly runs: number;
  readonly sendToFirstAssistantTextMs: DistributionSummary;
  readonly streamingRuns: number;
  readonly successes: number;
  readonly tailCompletionMs: DistributionSummary;
}

export interface PrewarmExperimentSummary {
  readonly controlColdRuns: number;
  readonly controlRuns: number;
  readonly deadlineHitRate: number | null;
  readonly deadlineHits: number;
  readonly expectedAfterRuns: number;
  readonly expectedControlRuns: number;
  readonly lateRuns: number;
  readonly observedAfterRuns: number;
  readonly outcomeObservedRuns: number;
  readonly prepareWarmRuns: number;
  readonly unknownRuns: number;
  readonly warmHits: number;
}

export interface ColdStartExperimentSummary {
  readonly after: ExperimentVariantSummary;
  readonly before: ExperimentVariantSummary;
  readonly gate: {
    readonly allRunsSuccessful: boolean;
    readonly clusterBootstrapCiExcludesZero: boolean;
    readonly completionP95NotWorse: boolean;
    readonly exactlyFourDeployments: boolean;
    readonly failureRateNotWorse: boolean;
    readonly identityComplete: boolean;
    readonly intentP95NotWorse: boolean;
    readonly leadTimingComplete: boolean;
    readonly medianImprovementAtLeast20Percent: boolean;
    readonly minimumThirtyPairs: boolean;
    readonly noExcludedAttempts: boolean;
    readonly noPendingAttempt: boolean;
    readonly noPendingDeployment: boolean;
    readonly prewarmDeadlineHitRateAtLeast95Percent: boolean;
    readonly prewarmOutcomeComplete: boolean;
    readonly retain: boolean;
    readonly sendMedianAtMost10Seconds: boolean;
    readonly sendP95NotWorse: boolean;
    readonly semanticOutputComplete: boolean;
    readonly crossoverTreatmentsComplete: boolean;
    readonly phaseCompletionMediansNotWorse: boolean;
    readonly phaseMediansImproved: boolean;
    readonly resourceConfigurationStable: boolean;
    readonly streamingCoverageAtLeast95Percent: boolean;
    readonly streamingCoverageNotWorse: boolean;
    readonly streamingP95NotWorse: boolean;
    readonly treatmentArtifactsStable: boolean;
    readonly traceComplete: boolean;
    readonly twoPhysicalStacks: boolean;
    readonly controlColdPathComplete: boolean;
  };
  readonly identity: {
    readonly completeRuns: number;
    readonly expectedRuns: number;
    readonly uniqueContainerDurableObjects: number;
    readonly uniqueContainerInstances: number;
    readonly uniqueContainerPlacements: number;
    readonly uniqueDriverInstances: number;
    readonly uniquePhysicalStacks: number;
    readonly uniqueSandboxes: number;
  };
  readonly pairedSendToFirstAssistantText: {
    readonly clusterBootstrapMedianDeltaCi95: readonly [number, number] | null;
    readonly completeBlocks: number;
    readonly completePairs: number;
    readonly incompletePairs: number;
    readonly medianAfterMinusBeforeMs: number | null;
    readonly medianImprovementPercent: number | null;
    readonly phaseMedianAfterMinusBeforeMs: Readonly<Record<CrossoverPhase, number | null>>;
    readonly totalPairs: number;
  };
  readonly output: {
    readonly equivalentRuns: number;
    readonly expectedRuns: number;
  };
  readonly prewarm: PrewarmExperimentSummary;
  readonly trace: {
    readonly completeRuns: number;
    readonly expectedRuns: number;
  };
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let state = hashSeed(seed);

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(values: readonly number[], percentage: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1),
  );
  const value = sorted[index];
  return value === undefined ? null : round(value);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];

  if (upper === undefined) {
    return null;
  }

  if (sorted.length % 2 === 1) {
    return round(upper);
  }

  const lower = sorted[middle - 1];
  return lower === undefined ? null : round((lower + upper) / 2);
}

function summarizeDistribution(values: readonly number[]): DistributionSummary {
  return {
    max: values.length === 0 ? null : round(Math.max(...values)),
    median: median(values),
    n: values.length,
    p95: percentile(values, 95),
  };
}

export function createBalancedBlockOrders(totalBlocks: number, seed: string): BlockOrder[] {
  if (!Number.isInteger(totalBlocks) || totalBlocks < 2 || totalBlocks % 2 !== 0) {
    throw new Error("Cold-start experiment totalBlocks must be a positive even integer.");
  }

  const orders: BlockOrder[] = Array.from({ length: totalBlocks }, (_, index) =>
    index < totalBlocks / 2 ? "abba" : "baab",
  );
  const random = createRandom(seed);

  for (let index = orders.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = orders[index];
    const swap = orders[swapIndex];

    if (current === undefined || swap === undefined) {
      throw new Error("Cold-start experiment block order generation failed.");
    }

    orders[index] = swap;
    orders[swapIndex] = current;
  }

  return orders;
}

function runPlan(input: {
  readonly block: number;
  readonly blockOrder: BlockOrder;
  readonly journey: BenchmarkJourney;
  readonly pair: number;
  readonly pairOrder: PairOrder;
  readonly phase: CrossoverPhase;
  readonly position: 1 | 2 | 3 | 4;
  readonly sequence: 1 | 2;
  readonly stack: BenchmarkStack;
  readonly variant: BenchmarkVariant;
}): InterleavedRunPlan {
  return input;
}

export function createInterleavedBlockPlans(input: {
  readonly blockCount: number;
  readonly blockStart: number;
  readonly journey?: BenchmarkJourney;
  readonly seed: string;
  readonly totalBlocks: number;
}): InterleavedBlockPlan[] {
  if (
    !Number.isInteger(input.blockStart) ||
    !Number.isInteger(input.blockCount) ||
    input.blockStart < 0 ||
    input.blockCount < 1 ||
    input.blockStart + input.blockCount > input.totalBlocks
  ) {
    throw new Error("Cold-start experiment block slice is outside totalBlocks.");
  }

  const phaseBlocks = input.totalBlocks / 2;
  const crossover = Number.isInteger(phaseBlocks) && phaseBlocks >= 2 && phaseBlocks % 2 === 0;
  const orders = crossover
    ? ([1, 2] as const).flatMap((phase) =>
        createBalancedBlockOrders(phaseBlocks, `${input.seed}:phase-${phase}`),
      )
    : createBalancedBlockOrders(input.totalBlocks, input.seed);

  return orders
    .slice(input.blockStart, input.blockStart + input.blockCount)
    .map((order, relativeIndex) => {
      const block = input.blockStart + relativeIndex + 1;
      const phase: CrossoverPhase = crossover && block > phaseBlocks ? 2 : 1;
      const firstPair = (block - 1) * 2 + 1;
      const variants: readonly [
        BenchmarkVariant,
        BenchmarkVariant,
        BenchmarkVariant,
        BenchmarkVariant,
      ] =
        order === "abba"
          ? ["before", "after", "after", "before"]
          : ["after", "before", "before", "after"];
      const firstPairOrder: PairOrder = order === "abba" ? "ab" : "ba";
      const secondPairOrder: PairOrder = order === "abba" ? "ba" : "ab";
      const stackFor = (variant: BenchmarkVariant): BenchmarkStack =>
        (phase === 1) === (variant === "before") ? "a" : "b";

      return {
        block,
        order,
        runs: [
          runPlan({
            block,
            blockOrder: order,
            journey: input.journey ?? "two-stage",
            pair: firstPair,
            pairOrder: firstPairOrder,
            phase,
            position: 1,
            sequence: 1,
            stack: stackFor(variants[0]),
            variant: variants[0],
          }),
          runPlan({
            block,
            blockOrder: order,
            journey: input.journey ?? "two-stage",
            pair: firstPair,
            pairOrder: firstPairOrder,
            phase,
            position: 2,
            sequence: 2,
            stack: stackFor(variants[1]),
            variant: variants[1],
          }),
          runPlan({
            block,
            blockOrder: order,
            journey: input.journey ?? "two-stage",
            pair: firstPair + 1,
            pairOrder: secondPairOrder,
            phase,
            position: 3,
            sequence: 1,
            stack: stackFor(variants[2]),
            variant: variants[2],
          }),
          runPlan({
            block,
            blockOrder: order,
            journey: input.journey ?? "two-stage",
            pair: firstPair + 1,
            pairOrder: secondPairOrder,
            phase,
            position: 4,
            sequence: 2,
            stack: stackFor(variants[3]),
            variant: variants[3],
          }),
        ],
      };
    });
}

export function toColdStartRunPlan(plan: InterleavedRunPlan): ColdStartRunPlan {
  return {
    order: plan.pairOrder,
    pair: plan.pair,
    phase: plan.phase,
    sequence: plan.sequence,
    stack: plan.stack,
    variant: plan.variant,
  };
}

export function createPairNonce(
  experimentId: string,
  seed: string,
  pair: number,
  executionOrdinal = 1,
): string {
  if (!Number.isSafeInteger(executionOrdinal) || executionOrdinal < 1) {
    throw new Error("Cold-start experiment execution ordinal must be a positive integer.");
  }

  const digest = createHash("sha256")
    .update(`${experimentId}\0${seed}\0${executionOrdinal}\0${pair}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `MOSOO_COLD_${pair}_${digest}`;
}

function summarizeVariant(
  runs: readonly ExperimentRun[],
  variant: BenchmarkVariant,
): ExperimentVariantSummary {
  const selected = runs.filter((run) => run.variant === variant);
  const failures = selected.filter((run) => run.sample.failure !== null).length;
  const pick = (field: keyof ColdStartRunResult["metrics"]) =>
    selected.flatMap((run) => {
      const value = run.sample.metrics[field];
      return typeof value === "number" && Number.isFinite(value) ? [value] : [];
    });
  const tailCompletionMs = selected.flatMap((run) => {
    const firstTextMs = run.sample.metrics.firstAssistantTextMs;
    const completedMs = run.sample.metrics.runCompletedMs;
    return firstTextMs !== null && completedMs !== null && completedMs >= firstTextMs
      ? [completedMs - firstTextMs]
      : [];
  });

  return {
    failureRate:
      selected.length === 0 ? 0 : Math.round((failures / selected.length) * 10_000) / 10_000,
    failures,
    intentToFirstAssistantTextMs: summarizeDistribution(pick("intentToFirstAssistantTextMs")),
    interChunkP95Ms: summarizeDistribution(pick("interChunkP95Ms")),
    pauseOver500MsCount: summarizeDistribution(pick("pauseOver500MsCount")),
    runCompletedMs: summarizeDistribution(pick("runCompletedMs")),
    runs: selected.length,
    sendToFirstAssistantTextMs: summarizeDistribution(pick("sendToFirstAssistantTextMs")),
    streamingRuns: selected.filter((run) => run.sample.metrics.assistantChunkCount >= 2).length,
    successes: selected.length - failures,
    tailCompletionMs: summarizeDistribution(tailCompletionMs),
  };
}

function clusterBootstrapMedianDeltaCi95(
  clusters: readonly (readonly number[])[],
  seed: string,
): [number, number] | null {
  if (clusters.length === 0) {
    return null;
  }

  const random = createRandom(seed);
  const medians: number[] = [];

  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const sample = Array.from({ length: clusters.length }, () => {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      return cluster ?? [];
    }).flat();
    medians.push(median(sample) ?? 0);
  }

  return [percentile(medians, 2.5) ?? 0, percentile(medians, 97.5) ?? 0];
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

// Driver identity is captured before the hello handshake. The first v7 A/A
// observed 1.662-3.314s between the D1 Driver row and process attestation.
// A 10s ceiling preserves >3x headroom while rejecting the prior post-run
// sandbox.exec samples (10.991-36.729s in the retained diagnostic artifacts).
const MAX_DRIVER_ATTESTATION_LAG_MS = 10_000;

function identityMatches(run: ExperimentRun, deployment: DeploymentIdentity | undefined): boolean {
  const identity = run.identity;
  const cleanup = run.cleanup;
  const driverCreatedAt = Date.parse(identity?.driverCreatedAt ?? "");
  const containerObservedAt = Date.parse(identity?.containerObservedAt ?? "");

  return (
    deployment !== undefined &&
    identity !== null &&
    cleanup !== null &&
    cleanup.threadDeleted &&
    cleanup.containerGone &&
    run.variant === deployment.variant &&
    run.phase === deployment.phase &&
    run.stack === deployment.stack &&
    run.sample.workerVersionCreate === deployment.workerVersionId &&
    (run.journey !== "two-stage" || run.sample.workerVersionSend === deployment.workerVersionId) &&
    run.sample.workerVersionStream === deployment.workerVersionId &&
    identity.containerApplicationId === deployment.containerApplicationId &&
    identity.driverBundleSha256 === deployment.driverBundleSha256 &&
    Number.isFinite(driverCreatedAt) &&
    Number.isFinite(containerObservedAt) &&
    containerObservedAt >= driverCreatedAt &&
    containerObservedAt - driverCreatedAt <= MAX_DRIVER_ATTESTATION_LAG_MS &&
    [
      identity.containerDeploymentId,
      identity.containerDurableObjectId,
      identity.containerPlacementId,
      identity.driverInstanceId,
      identity.sandboxId,
      identity.sandboxSessionId,
    ].every(isNonEmpty)
  );
}

const REQUIRED_RUNTIME_TIMING_MARKERS = new Set([
  "api:context_hydration",
  "api:driver_turn",
  "api:prepare_run",
  "driver:driver_turn",
]);

export function runtimeTimingMatchesTrace(
  timing: ObservedRuntimeTiming,
  expected: { readonly runId: string; readonly threadId: string },
): boolean {
  return (
    timing.sessionId === expected.threadId &&
    (timing.runId === expected.runId ||
      (timing.runId === null &&
        ((timing.source === "api" && timing.stage === "prewarm" && timing.path === "prewarm") ||
          (timing.source === "driver" &&
            timing.stage === "driver_backend" &&
            (timing.path === "cold" || timing.path === "prewarm")))))
  );
}

export function runtimeTraceIsComplete(
  trace: ObservedRunTrace | null,
  expected: {
    readonly driverCreatedAt?: string;
    readonly journey?: BenchmarkJourney;
    readonly runId: string | null;
    readonly threadId: string | null;
    readonly variant?: BenchmarkVariant;
  },
): boolean {
  if (trace === null || expected.runId === null || expected.threadId === null) {
    return false;
  }
  const expectedIdentity = { runId: expected.runId, threadId: expected.threadId };

  if (!Number.isFinite(Date.parse(trace.runAcceptedAt))) {
    return false;
  }

  const timingIdentityComplete = trace.timings.every(({ timing }) =>
    runtimeTimingMatchesTrace(timing, expectedIdentity),
  );

  if (!timingIdentityComplete) {
    return false;
  }

  const markers = new Set(
    trace.timings.flatMap((entry) => {
      const timing = entry.timing;
      return timing.runId === expected.runId && timing.sessionId === expected.threadId
        ? [`${timing.source}:${timing.stage}`]
        : [];
    }),
  );

  if (![...REQUIRED_RUNTIME_TIMING_MARKERS].every((marker) => markers.has(marker))) {
    return false;
  }

  return true;
}

function traceIsComplete(run: ExperimentRun): boolean {
  return runtimeTraceIsComplete(run.trace, {
    ...(run.identity === null ? {} : { driverCreatedAt: run.identity.driverCreatedAt }),
    journey: run.journey,
    runId: run.sample.runId,
    threadId: run.sample.threadId,
    variant: run.variant,
  });
}

function prepareRunPath(run: ExperimentRun): ObservedRuntimeTiming["path"] | null {
  return (
    run.trace?.timings.find(
      ({ timing }) =>
        timing.runId === run.sample.runId &&
        timing.sessionId === run.sample.threadId &&
        timing.source === "api" &&
        timing.stage === "prepare_run",
    )?.timing.path ?? null
  );
}

function apiPrewarmTimings(run: ExperimentRun): readonly ObservedRuntimeTiming[] {
  return (
    run.trace?.timings.flatMap(({ timing }) =>
      timing.runId === null &&
      timing.sessionId === run.sample.threadId &&
      timing.source === "api" &&
      timing.stage === "prewarm" &&
      timing.path === "prewarm"
        ? [timing]
        : [],
    ) ?? []
  );
}

function summarizePrewarm(input: {
  readonly journey: BenchmarkJourney;
  readonly runs: readonly ExperimentRun[];
  readonly totalBlocks: number;
}): PrewarmExperimentSummary {
  const isTwoStage = input.journey === "two-stage";
  const expectedAfterRuns = isTwoStage ? input.totalBlocks * 2 : 0;
  const expectedControlRuns = isTwoStage ? input.totalBlocks * 2 : input.totalBlocks * 4;
  const afterRuns = isTwoStage
    ? input.runs.filter((run) => run.journey === "two-stage" && run.variant === "after")
    : [];
  const controlRuns = input.runs.filter((run) =>
    isTwoStage
      ? run.journey === "two-stage" && run.variant === "before"
      : run.journey === "one-shot",
  );
  const outcomes = afterRuns.map((run) => {
    const prewarmTimings = apiPrewarmTimings(run);
    const runAcceptedAtMs = Date.parse(run.trace?.runAcceptedAt ?? "");
    const deadlineHit =
      Number.isFinite(runAcceptedAtMs) &&
      prewarmTimings.some((timing) => timing.completedAtMs <= runAcceptedAtMs);
    const prepareWarm = prepareRunPath(run) === "warm";

    return {
      deadlineHit,
      observed: prewarmTimings.length > 0,
      prepareWarm,
      warmHit: deadlineHit && prepareWarm,
    };
  });
  const deadlineHits = outcomes.filter((outcome) => outcome.deadlineHit).length;
  const outcomeObservedRuns = outcomes.filter((outcome) => outcome.observed).length;

  return {
    controlColdRuns: controlRuns.filter(
      (run) => prepareRunPath(run) === "cold" && apiPrewarmTimings(run).length === 0,
    ).length,
    controlRuns: controlRuns.length,
    deadlineHitRate:
      expectedAfterRuns === 0
        ? null
        : Math.round((deadlineHits / expectedAfterRuns) * 10_000) / 10_000,
    deadlineHits,
    expectedAfterRuns,
    expectedControlRuns,
    lateRuns: outcomeObservedRuns - deadlineHits,
    observedAfterRuns: afterRuns.length,
    outcomeObservedRuns,
    prepareWarmRuns: outcomes.filter((outcome) => outcome.prepareWarm).length,
    unknownRuns: Math.max(0, expectedAfterRuns - outcomeObservedRuns),
    warmHits: outcomes.filter((outcome) => outcome.warmHit).length,
  };
}

function nullableNotWorse(after: number | null, before: number | null): boolean {
  if (after === null || before === null) {
    return after === null && before === null;
  }

  return after <= before;
}

function nullableStreamingNotWorse(after: number | null, before: number | null): boolean {
  if (before === null) {
    return true;
  }

  return after !== null && after <= before;
}

const DEPLOYMENT_TREATMENT_FIELDS = [
  "sourceRevision",
  "driverBundleSha256",
  "imageDigest",
  "workerBundleSha256",
  "containerInstanceType",
  "containerVcpu",
  "containerMemoryMib",
  "containerDiskMb",
  "containerMaxInstances",
  "treatmentConfigSha256",
] as const satisfies readonly (keyof DeploymentIdentity)[];

export function deploymentTreatmentFingerprint(deployment: DeploymentIdentity): string {
  return DEPLOYMENT_TREATMENT_FIELDS.map((field) => deployment[field]).join("\0");
}

export function deploymentTreatmentDriftFields(
  baseline: DeploymentIdentity,
  candidate: DeploymentIdentity,
): string[] {
  return DEPLOYMENT_TREATMENT_FIELDS.filter((field) => baseline[field] !== candidate[field]);
}

function treatmentArtifactsAreStable(
  deployments: readonly DeploymentIdentity[],
  runs: readonly ExperimentRun[],
): boolean {
  const usedOrdinals = new Set(runs.map((run) => run.deploymentOrdinal));

  const used = deployments.filter((deployment) => usedOrdinals.has(deployment.ordinal));
  const combinationsStable = (["a:before", "a:after", "b:before", "b:after"] as const).every(
    (combination) => {
      const [stack, variant] = combination.split(":") as [BenchmarkStack, BenchmarkVariant];
      const fingerprints = new Set(
        used
          .filter(
            (deployment) =>
              deployment.stack === stack &&
              deployment.variant === variant &&
              usedOrdinals.has(deployment.ordinal),
          )
          .map(deploymentTreatmentFingerprint),
      );

      return fingerprints.size === 1;
    },
  );
  const stackConfigsStable = (["a", "b"] as const).every(
    (stack) =>
      new Set(
        used
          .filter((deployment) => deployment.stack === stack)
          .map((deployment) => deployment.stackConfigSha256),
      ).size === 1,
  );
  return (
    stackConfigsStable &&
    combinationsStable &&
    (["before", "after"] as const).every(
      (variant) =>
        new Set(
          used
            .filter((deployment) => deployment.variant === variant)
            .map(deploymentTreatmentFingerprint),
        ).size === 1,
    )
  );
}

export function summarizeColdStartExperiment(input: {
  readonly deployments: readonly DeploymentIdentity[];
  readonly discardedBlocks?: number;
  readonly failedAttempts?: number;
  readonly journey?: BenchmarkJourney;
  readonly leadMs?: number;
  readonly leadToleranceMs?: number;
  readonly pendingAttempt?: boolean;
  readonly pendingDeployment?: boolean;
  readonly runs: readonly ExperimentRun[];
  readonly seed: string;
  readonly totalBlocks: number;
}): ColdStartExperimentSummary {
  const before = summarizeVariant(input.runs, "before");
  const after = summarizeVariant(input.runs, "after");
  const deployments = new Map(
    input.deployments.map((deployment) => [deployment.ordinal, deployment] as const),
  );
  const byPair = new Map<number, ExperimentRun[]>();

  for (const run of input.runs) {
    const pair = byPair.get(run.pair) ?? [];
    pair.push(run);
    byPair.set(run.pair, pair);
  }

  const deltas: number[] = [];
  const improvements: number[] = [];
  const deltasByBlock = new Map<number, number[]>();
  const deltasByPhase = new Map<CrossoverPhase, number[]>();
  const completionDeltasByPhase = new Map<CrossoverPhase, number[]>();

  for (const pairRuns of byPair.values()) {
    const beforeRun = pairRuns.find((run) => run.variant === "before");
    const afterRun = pairRuns.find((run) => run.variant === "after");
    const beforeMs = beforeRun?.sample.metrics.sendToFirstAssistantTextMs ?? null;
    const afterMs = afterRun?.sample.metrics.sendToFirstAssistantTextMs ?? null;
    const beforeCompletedMs = beforeRun?.sample.metrics.runCompletedMs ?? null;
    const afterCompletedMs = afterRun?.sample.metrics.runCompletedMs ?? null;
    const phase = beforeRun?.phase ?? afterRun?.phase;

    if (beforeCompletedMs !== null && afterCompletedMs !== null && phase !== undefined) {
      const phaseCompletionDeltas = completionDeltasByPhase.get(phase) ?? [];
      phaseCompletionDeltas.push(afterCompletedMs - beforeCompletedMs);
      completionDeltasByPhase.set(phase, phaseCompletionDeltas);
    }

    if (beforeMs === null || afterMs === null) {
      continue;
    }

    const delta = afterMs - beforeMs;
    deltas.push(delta);
    improvements.push(((beforeMs - afterMs) / beforeMs) * 100);
    if (phase !== undefined) {
      const phaseDeltas = deltasByPhase.get(phase) ?? [];
      phaseDeltas.push(delta);
      deltasByPhase.set(phase, phaseDeltas);
    }
    const block = beforeRun?.block ?? afterRun?.block;

    if (block !== undefined) {
      const cluster = deltasByBlock.get(block) ?? [];
      cluster.push(delta);
      deltasByBlock.set(block, cluster);
    }
  }

  const completeClusters = [...deltasByBlock.values()].filter((cluster) => cluster.length === 2);
  const ci = clusterBootstrapMedianDeltaCi95(completeClusters, `${input.seed}:cluster-bootstrap`);
  const medianImprovementPercent = median(improvements);
  const medianDelta = median(deltas);
  const expectedRuns = input.totalBlocks * 4;
  const journey = input.journey ?? input.runs[0]?.journey ?? "two-stage";
  const prewarm = summarizePrewarm({
    journey,
    runs: input.runs,
    totalBlocks: input.totalBlocks,
  });
  const leadMs = input.leadMs ?? 10_000;
  const leadToleranceMs = input.leadToleranceMs ?? 500;
  const completeIdentityRuns = input.runs.filter((run) =>
    identityMatches(run, deployments.get(run.deploymentOrdinal)),
  ).length;
  const uniqueContainerInstances = new Set(
    input.runs.flatMap((run) =>
      run.identity === null ? [] : [run.identity.containerDeploymentId],
    ),
  ).size;
  const uniqueContainerDurableObjects = new Set(
    input.runs.flatMap((run) =>
      run.identity === null ? [] : [run.identity.containerDurableObjectId],
    ),
  ).size;
  const uniqueContainerPlacements = new Set(
    input.runs.flatMap((run) => (run.identity === null ? [] : [run.identity.containerPlacementId])),
  ).size;
  const uniqueDriverInstances = new Set(
    input.runs.flatMap((run) => (run.identity === null ? [] : [run.identity.driverInstanceId])),
  ).size;
  const usedPhysicalStacks = new Set(
    input.runs.flatMap((run) => {
      const deployment = deployments.get(run.deploymentOrdinal);
      return deployment === undefined ? [] : [deployment.physicalStackId];
    }),
  );
  const uniqueSandboxes = new Set(
    input.runs.flatMap((run) => (run.identity === null ? [] : [run.identity.sandboxId])),
  ).size;
  const identityComplete =
    input.runs.length === expectedRuns &&
    completeIdentityRuns === expectedRuns &&
    uniqueContainerDurableObjects === expectedRuns &&
    uniqueDriverInstances === expectedRuns &&
    uniqueSandboxes === expectedRuns;
  const completeTraceRuns = input.runs.filter(traceIsComplete).length;
  const traceComplete = input.runs.length === expectedRuns && completeTraceRuns === expectedRuns;
  const equivalentOutputRuns = input.runs.filter((run) => {
    const sample = run.sample as { readonly output?: { readonly valid?: unknown } };
    return sample.output?.valid === true;
  }).length;
  const semanticOutputComplete =
    input.runs.length === expectedRuns && equivalentOutputRuns === expectedRuns;
  const minimumThirtyPairs = byPair.size >= 30 && deltas.length >= 30;
  const allRunsSuccessful =
    input.runs.length === expectedRuns && before.failures === 0 && after.failures === 0;
  const leadTimingComplete =
    input.runs.length === expectedRuns &&
    input.runs.every((run) => {
      if (run.journey !== "two-stage") {
        return true;
      }
      const actual = run.sample.metrics.intentToSendMs;
      return actual !== null && Math.abs(actual - leadMs) <= leadToleranceMs;
    });
  const noPendingAttempt = input.pendingAttempt !== true;
  const noPendingDeployment = input.pendingDeployment !== true;
  const noExcludedAttempts =
    (input.discardedBlocks ?? 0) === 0 && (input.failedAttempts ?? 0) === 0;
  const prewarmOutcomeComplete =
    journey !== "two-stage" || prewarm.outcomeObservedRuns === prewarm.expectedAfterRuns;
  const prewarmDeadlineHitRateAtLeast95Percent =
    journey !== "two-stage" || prewarm.deadlineHits * 100 >= prewarm.expectedAfterRuns * 95;
  const controlColdPathComplete =
    prewarm.controlRuns === prewarm.expectedControlRuns &&
    prewarm.controlColdRuns === prewarm.expectedControlRuns;
  const physicalStacksByLabel = new Map<BenchmarkStack, Set<string>>([
    ["a", new Set()],
    ["b", new Set()],
  ]);
  for (const run of input.runs) {
    const deployment = deployments.get(run.deploymentOrdinal);
    if (deployment !== undefined) {
      physicalStacksByLabel.get(run.stack)?.add(deployment.physicalStackId);
    }
  }
  const twoPhysicalStacks =
    usedPhysicalStacks.size === 2 &&
    [...physicalStacksByLabel.values()].every((physicalStacks) => physicalStacks.size === 1);
  const usedTreatments = new Set(
    input.runs.flatMap((run) => {
      const deployment = deployments.get(run.deploymentOrdinal);
      return deployment === undefined ? [] : [`${deployment.stack}:${deployment.variant}`];
    }),
  );
  const crossoverTreatmentsComplete =
    usedTreatments.size === 4 &&
    input.runs.every(
      (run) => ((run.phase === 1) === (run.stack === "a")) === (run.variant === "before"),
    );
  const deploymentSlots = new Set(
    input.deployments.map((deployment) => `${deployment.phase}:${deployment.stack}`),
  );
  const exactlyFourDeployments =
    input.deployments.length === 4 &&
    deploymentSlots.size === 4 &&
    input.deployments.every(
      (deployment) =>
        ((deployment.phase === 1) === (deployment.stack === "a")) ===
        (deployment.variant === "before"),
    );
  const resourceConfigurationStable =
    input.deployments.length > 0 &&
    new Set(
      input.deployments.map((deployment) =>
        containerResourceFingerprint({
          diskMb: deployment.containerDiskMb,
          instanceType: deployment.containerInstanceType,
          maxInstances: deployment.containerMaxInstances,
          memoryMib: deployment.containerMemoryMib,
          vcpu: deployment.containerVcpu,
        }),
      ),
    ).size === 1;
  const phaseMedianAfterMinusBeforeMs = {
    1: median(deltasByPhase.get(1) ?? []),
    2: median(deltasByPhase.get(2) ?? []),
  } as const;
  const phaseMediansImproved =
    phaseMedianAfterMinusBeforeMs[1] !== null &&
    phaseMedianAfterMinusBeforeMs[1] < 0 &&
    phaseMedianAfterMinusBeforeMs[2] !== null &&
    phaseMedianAfterMinusBeforeMs[2] < 0;
  const phaseCompletionMediansNotWorse = ([1, 2] as const).every((phase) => {
    const phaseMedian = median(completionDeltasByPhase.get(phase) ?? []);
    return phaseMedian !== null && phaseMedian <= 0;
  });
  const treatmentArtifactsStable = treatmentArtifactsAreStable(input.deployments, input.runs);
  const medianImprovementAtLeast20Percent = (medianImprovementPercent ?? -Infinity) >= 20;
  const clusterBootstrapCiExcludesZero = ci !== null && ci[1] < 0;
  const intentP95NotWorse = nullableNotWorse(
    after.intentToFirstAssistantTextMs.p95,
    before.intentToFirstAssistantTextMs.p95,
  );
  const sendP95NotWorse = nullableNotWorse(
    after.sendToFirstAssistantTextMs.p95,
    before.sendToFirstAssistantTextMs.p95,
  );
  const completionP95NotWorse = nullableNotWorse(
    after.runCompletedMs.p95,
    before.runCompletedMs.p95,
  );
  const sendMedianAtMost10Seconds =
    after.sendToFirstAssistantTextMs.median !== null &&
    after.sendToFirstAssistantTextMs.median <= 10_000;
  const streamingP95NotWorse = nullableStreamingNotWorse(
    after.interChunkP95Ms.p95,
    before.interChunkP95Ms.p95,
  );
  const streamingCoverageNotWorse =
    after.streamingRuns * before.runs >= before.streamingRuns * after.runs;
  const streamingCoverageAtLeast95Percent =
    after.runs > 0 && after.streamingRuns * 100 >= after.runs * 95;
  const failureRateNotWorse = after.failures * before.runs <= before.failures * after.runs;

  return {
    after,
    before,
    gate: {
      allRunsSuccessful,
      clusterBootstrapCiExcludesZero,
      completionP95NotWorse,
      exactlyFourDeployments,
      failureRateNotWorse,
      identityComplete,
      intentP95NotWorse,
      leadTimingComplete,
      medianImprovementAtLeast20Percent,
      minimumThirtyPairs,
      noExcludedAttempts,
      noPendingAttempt,
      noPendingDeployment,
      prewarmDeadlineHitRateAtLeast95Percent,
      prewarmOutcomeComplete,
      retain:
        minimumThirtyPairs &&
        allRunsSuccessful &&
        leadTimingComplete &&
        clusterBootstrapCiExcludesZero &&
        intentP95NotWorse &&
        sendP95NotWorse &&
        streamingP95NotWorse &&
        streamingCoverageAtLeast95Percent &&
        streamingCoverageNotWorse &&
        completionP95NotWorse &&
        failureRateNotWorse &&
        semanticOutputComplete &&
        identityComplete &&
        traceComplete &&
        prewarmOutcomeComplete &&
        prewarmDeadlineHitRateAtLeast95Percent &&
        controlColdPathComplete &&
        noExcludedAttempts &&
        noPendingAttempt &&
        noPendingDeployment &&
        exactlyFourDeployments &&
        resourceConfigurationStable &&
        twoPhysicalStacks &&
        crossoverTreatmentsComplete &&
        phaseCompletionMediansNotWorse &&
        phaseMediansImproved &&
        treatmentArtifactsStable,
      crossoverTreatmentsComplete,
      phaseCompletionMediansNotWorse,
      phaseMediansImproved,
      resourceConfigurationStable,
      sendMedianAtMost10Seconds,
      sendP95NotWorse,
      semanticOutputComplete,
      streamingCoverageAtLeast95Percent,
      streamingCoverageNotWorse,
      streamingP95NotWorse,
      treatmentArtifactsStable,
      traceComplete,
      twoPhysicalStacks,
      controlColdPathComplete,
    },
    identity: {
      completeRuns: completeIdentityRuns,
      expectedRuns,
      uniqueContainerDurableObjects,
      uniqueContainerInstances,
      uniqueContainerPlacements,
      uniqueDriverInstances,
      uniquePhysicalStacks: usedPhysicalStacks.size,
      uniqueSandboxes,
    },
    pairedSendToFirstAssistantText: {
      clusterBootstrapMedianDeltaCi95: ci,
      completeBlocks: completeClusters.length,
      completePairs: deltas.length,
      incompletePairs: byPair.size - deltas.length,
      medianAfterMinusBeforeMs: medianDelta,
      medianImprovementPercent,
      phaseMedianAfterMinusBeforeMs,
      totalPairs: byPair.size,
    },
    output: {
      equivalentRuns: equivalentOutputRuns,
      expectedRuns,
    },
    prewarm,
    trace: {
      completeRuns: completeTraceRuns,
      expectedRuns,
    },
  };
}
