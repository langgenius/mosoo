export const RUNTIME_E2E_SCOREBOARD_SCHEMA = "mosoo.runtime-e2e-scoreboard.v2" as const;
export const RUNTIME_E2E_BROWSER_EXCLUSION_POLICY =
  "none; post-run exclusions invalidate qualification";
export const RUNTIME_E2E_BROWSER_FAILURE_POLICY =
  "retain every failed attempt and fail qualification";

export type RuntimeE2EPath = "cold" | "warm";
export type RuntimeE2EStage = "providerFirstDelta" | "d1Commit" | "viewerPublish" | "browserApply";

export interface AvailableMetric<T> {
  readonly source: string;
  readonly status: "available";
  readonly value: T;
}

export interface UnavailableMetric {
  readonly reason: string;
  readonly status: "unavailable";
}

export type RuntimeE2EMetric<T> = AvailableMetric<T> | UnavailableMetric;

export interface MeasuredStageEvidence {
  readonly elapsedMs: number;
  readonly evidenceId: string | null;
  readonly source: string;
  readonly status: "measured";
}

export interface ObservedStageEvidence {
  readonly elapsedMs: number | null;
  readonly evidenceId: string | null;
  readonly reason: string;
  readonly source: string;
  readonly status: "observed";
}

export type RuntimeE2EStageEvidence =
  | MeasuredStageEvidence
  | ObservedStageEvidence
  | UnavailableMetric;

export interface RuntimeE2ESample {
  readonly correlationId: string | null;
  readonly d1Commit: RuntimeE2EStageEvidence;
  readonly browserApply: RuntimeE2EStageEvidence;
  readonly interDeltaP95Ms: RuntimeE2EMetric<number>;
  readonly pair: number | null;
  readonly path: RuntimeE2EMetric<RuntimeE2EPath>;
  readonly providerDirectVisibleCharactersPerSecond: RuntimeE2EMetric<number>;
  readonly providerFirstDelta: RuntimeE2EStageEvidence;
  readonly runId: string | null;
  readonly sessionId: string | null;
  readonly terminalSucceeded: RuntimeE2EMetric<boolean>;
  readonly transportReconnectRecovered: RuntimeE2EMetric<boolean>;
  readonly ttftMs: RuntimeE2EMetric<number>;
  readonly viewerPublish: RuntimeE2EStageEvidence;
  readonly visibleCharactersPerSecond: RuntimeE2EMetric<number>;
}

export interface PercentileDistribution {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface RateSummary {
  readonly attempts: number;
  readonly rate: number;
  readonly successes: number;
}

export interface StageEvidenceSummary {
  readonly measured: number;
  readonly observed: number;
  readonly unavailable: number;
}

export interface RuntimeE2EPathScoreboard {
  readonly correlation: {
    readonly completeSamples: number;
    readonly stages: Record<RuntimeE2EStage, StageEvidenceSummary>;
  };
  readonly interDeltaP95Ms: RuntimeE2EMetric<PercentileDistribution>;
  readonly samples: number;
  readonly terminalSuccess: RuntimeE2EMetric<RateSummary>;
  readonly transportReconnectRecovery: RuntimeE2EMetric<RateSummary>;
  readonly ttftMs: RuntimeE2EMetric<PercentileDistribution>;
  readonly visibleOutputRateVsProviderDirect: RuntimeE2EMetric<PercentileDistribution>;
}

export interface RuntimeE2EScoreboard {
  readonly cold: RuntimeE2EPathScoreboard;
  readonly generatedAt: string;
  readonly overallTerminalSuccess: RuntimeE2EMetric<RateSummary>;
  readonly qualification: RuntimeE2EQualification;
  readonly schema: typeof RUNTIME_E2E_SCOREBOARD_SCHEMA;
  readonly totalSamples: number;
  readonly unclassifiedSamples: number;
  readonly warm: RuntimeE2EPathScoreboard;
}

export interface RuntimeE2EGateCheck {
  readonly detail: string;
  readonly name: string;
  readonly passed: boolean;
}

export interface RuntimeE2EAcceptancePair {
  readonly block: number;
  readonly browserCandidate: {
    readonly correlationId: string;
    readonly interDeltaP95Ms: number | null;
    readonly outputEquivalent: boolean;
    readonly path: RuntimeE2EPath;
    readonly terminalSucceeded: boolean;
    readonly totalCompletionMs: number | null;
    readonly ttftMs: number;
  };
  readonly pair: number;
  readonly phase: number;
  readonly transport: {
    readonly baseline: RuntimeE2EAcceptancePairMetrics;
    readonly delta: {
      readonly interDeltaP95Ms: number | null;
      readonly totalCompletionMs: number | null;
      readonly ttftMs: number | null;
    };
    readonly instrumentedCandidate: RuntimeE2EAcceptancePairMetrics;
  };
}

export interface RuntimeE2EAcceptancePairMetrics {
  readonly interDeltaP95Ms: number | null;
  readonly outputEquivalent: boolean;
  readonly path: RuntimeE2EPath | null;
  readonly terminalSucceeded: boolean;
  readonly totalCompletionMs: number | null;
  readonly ttftMs: number | null;
}

export interface RuntimeE2EQualification {
  readonly acceptance: "4-pair staging acceptance";
  readonly artifactPaths: {
    readonly browser: string;
    readonly crossover: string;
    readonly providerDirect: string;
  };
  readonly candidateCommit: string;
  readonly eligibleForPr: boolean;
  readonly checks: readonly RuntimeE2EGateCheck[];
  readonly frozenHarnessRevision: string;
  readonly pairs: readonly RuntimeE2EAcceptancePair[];
  readonly sampleCounts: {
    readonly browser: number;
    readonly browserExcluded: number;
    readonly browserFailed: number;
    readonly crossover: number;
    readonly crossoverDiscarded: number;
    readonly crossoverFailed: number;
    readonly providerDirect: number;
    readonly providerDirectFailed: number;
    readonly providerDirectWarmups: number;
  };
  readonly samplePolicies: {
    readonly browser: string;
    readonly crossover: string;
    readonly providerDirect: string;
  };
}

const STAGES: readonly RuntimeE2EStage[] = [
  "providerFirstDelta",
  "d1Commit",
  "viewerPublish",
  "browserApply",
];

function available<T>(value: T, source: string): AvailableMetric<T> {
  return { source, status: "available", value };
}

function unavailable(reason: string): UnavailableMetric {
  return { reason, status: "unavailable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

function requireString(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} requires ${field}.`);
  }

  return value.trim();
}

function optionalString(
  record: Record<string, unknown>,
  field: string,
  label: string,
): string | null {
  const value = record[field];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}.${field} must be a non-empty string or null.`);
  }

  return value.trim();
}

function optionalFiniteNumber(
  record: Record<string, unknown>,
  field: string,
  label: string,
): number | null {
  const value = record[field];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}.${field} must be a non-negative finite number or null.`);
  }

  return value;
}

function readTimingEntries(run: Record<string, unknown>): Record<string, unknown>[] {
  const trace = run["trace"];

  if (trace === null || trace === undefined) {
    return [];
  }

  const timings = requireRecord(trace, "Cold-start trace")["timings"];

  if (!Array.isArray(timings)) {
    throw new Error("Cold-start trace.timings must be an array.");
  }

  return timings.map((entry) => requireRecord(entry, "Cold-start timing entry"));
}

function timingMatchesRun(
  entry: Record<string, unknown>,
  input: { readonly runId: string; readonly sessionId: string },
): boolean {
  const timing = entry["timing"];

  return (
    isRecord(timing) && timing["runId"] === input.runId && timing["sessionId"] === input.sessionId
  );
}

function readRuntimePath(
  timings: readonly Record<string, unknown>[],
  input: { readonly runId: string; readonly sessionId: string },
): RuntimeE2EMetric<RuntimeE2EPath> {
  const entry = timings.find((candidate) => {
    const timing = candidate["timing"];
    return (
      timingMatchesRun(candidate, input) &&
      isRecord(timing) &&
      timing["source"] === "api" &&
      timing["stage"] === "prepare_run"
    );
  });
  const path = isRecord(entry?.["timing"]) ? entry["timing"]["path"] : null;

  return path === "cold" || path === "warm"
    ? available(path, "runtime.timing.recorded api:prepare_run")
    : unavailable("No run-scoped api:prepare_run cold/warm timing was captured.");
}

function metricFromNumber(
  value: number | null,
  source: string,
  reason: string,
): RuntimeE2EMetric<number> {
  return value === null ? unavailable(reason) : available(value, source);
}

function readTerminalSuccess(
  sample: Record<string, unknown>,
  metrics: Record<string, unknown>,
): RuntimeE2EMetric<boolean> {
  const failure = sample["failure"];
  const output = requireRecord(sample["output"], "Cold-start sample.output");
  if (failure !== null && !isRecord(failure)) {
    throw new Error("Cold-start sample.failure must be an object or null.");
  }
  if (typeof output["valid"] !== "boolean") {
    throw new Error("Cold-start sample.output.valid must be a boolean.");
  }
  const runCompletedMs = optionalFiniteNumber(
    metrics,
    "runCompletedMs",
    "Cold-start sample.metrics",
  );

  return available(
    failure === null && output["valid"] && runCompletedMs !== null,
    "cold-start run.completed plus semantic output validation",
  );
}

function readVisibleCharactersPerSecond(
  metrics: Record<string, unknown>,
): RuntimeE2EMetric<number> {
  const characters = optionalFiniteNumber(
    metrics,
    "assistantTextCharacters",
    "Cold-start sample.metrics",
  );
  const firstTextMs = optionalFiniteNumber(
    metrics,
    "firstAssistantTextMs",
    "Cold-start sample.metrics",
  );
  const completedMs = optionalFiniteNumber(metrics, "runCompletedMs", "Cold-start sample.metrics");
  const durationMs =
    firstTextMs === null || completedMs === null ? null : completedMs - firstTextMs;

  if (characters === null || characters === 0 || durationMs === null || durationMs <= 0) {
    return unavailable("The run did not expose a positive visible streaming duration.");
  }

  return available(
    (characters * 1_000) / durationMs,
    "cold-start visible characters / first-text-to-completion",
  );
}

function readColdStartSample(
  run: Record<string, unknown>,
  label: string,
  correlationRequired: boolean,
): RuntimeE2ESample {
  const sample = requireRecord(run["sample"], `${label}.sample`);
  const metrics = requireRecord(sample["metrics"], `${label}.sample.metrics`);
  const runId = correlationRequired
    ? requireString(sample, "runId", `${label}.sample`)
    : optionalString(sample, "runId", `${label}.sample`);
  const sessionId = correlationRequired
    ? requireString(sample, "threadId", `${label}.sample`)
    : optionalString(sample, "threadId", `${label}.sample`);
  const correlation =
    runId === null || sessionId === null
      ? null
      : { correlationId: `${sessionId}:${runId}`, runId, sessionId };
  const timings = readTimingEntries(run);
  const firstTextMs = optionalFiniteNumber(
    metrics,
    "firstAssistantTextMs",
    "Cold-start sample.metrics",
  );
  const sendToFirstTextMs = optionalFiniteNumber(
    metrics,
    "sendToFirstAssistantTextMs",
    "Cold-start sample.metrics",
  );
  const interDeltaP95Ms = optionalFiniteNumber(
    metrics,
    "interChunkP95Ms",
    "Cold-start sample.metrics",
  );

  return {
    browserApply: unavailable(
      "The frozen cold-start harness observes SSE in Bun, not browser DOM application.",
    ),
    correlationId: null,
    d1Commit: unavailable(
      "The frozen artifact retains D1 timing rows, but not the first visible event's D1 commit receipt.",
    ),
    interDeltaP95Ms: metricFromNumber(
      interDeltaP95Ms,
      "cold-start SSE reader bursts",
      "The run produced fewer than two visible SSE chunks.",
    ),
    path:
      correlation === null
        ? unavailable("The attempt did not reach a run/session identity.")
        : readRuntimePath(timings, correlation),
    pair: null,
    providerDirectVisibleCharactersPerSecond: unavailable(
      "No same-workload/provider/model live Driver artifact was supplied.",
    ),
    providerFirstDelta: unavailable(
      "Frozen v12 has no sourceEventId-correlated first visible message.delta evidence.",
    ),
    runId,
    sessionId,
    terminalSucceeded: readTerminalSuccess(sample, metrics),
    transportReconnectRecovered: unavailable(
      "The harness did not inject and recover a transport disconnect for this run.",
    ),
    ttftMs: metricFromNumber(
      sendToFirstTextMs ?? firstTextMs,
      sendToFirstTextMs === null
        ? "cold-start intent-to-first-visible-text"
        : "cold-start send-to-first-visible-text",
      "The run produced no visible assistant text.",
    ),
    viewerPublish:
      firstTextMs === null
        ? unavailable("No visible assistant event reached the SSE consumer.")
        : {
            elapsedMs: null,
            evidenceId: null,
            reason:
              "Consumer receipt proves publication occurred, but the server publish timestamp is not recorded.",
            source: "cold-start SSE first assistant event",
            status: "observed",
          },
    visibleCharactersPerSecond: readVisibleCharactersPerSecond(metrics),
  };
}

export function runtimeE2ESamplesFromColdStartDocument(document: unknown): RuntimeE2ESample[] {
  const root = requireRecord(document, "Cold-start benchmark document");
  if (root["schemaVersion"] !== "mosoo.cold-start-ab.v12") {
    throw new Error("Cold-start benchmark document must use mosoo.cold-start-ab.v12.");
  }
  const runs = root["runs"];
  const failedAttempts = root["failedAttempts"];
  const discardedBlocks = root["discardedBlocks"];

  if (!Array.isArray(runs) || !Array.isArray(failedAttempts) || !Array.isArray(discardedBlocks)) {
    throw new Error(
      "Cold-start benchmark document runs, failedAttempts, and discardedBlocks must be arrays.",
    );
  }

  const discardedRuns = discardedBlocks.flatMap((value, blockIndex) => {
    const block = requireRecord(value, `Cold-start discarded block ${blockIndex}`);
    const blockRuns = block["runs"];
    if (!Array.isArray(blockRuns)) {
      throw new Error(`Cold-start discarded block ${blockIndex}.runs must be an array.`);
    }
    return blockRuns;
  });

  return [
    ...runs.map((run, index) =>
      readColdStartSample(
        requireRecord(run, `Cold-start retained run ${index}`),
        `Cold-start retained run ${index}`,
        true,
      ),
    ),
    ...discardedRuns.map((run, index) =>
      readColdStartSample(
        requireRecord(run, `Cold-start discarded run ${index}`),
        `Cold-start discarded run ${index}`,
        true,
      ),
    ),
    ...failedAttempts.map((attempt, index) =>
      readColdStartSample(
        requireRecord(attempt, `Cold-start failed attempt ${index}`),
        `Cold-start failed attempt ${index}`,
        false,
      ),
    ),
  ];
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function percentile(values: readonly number[], percentage: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1),
  );

  return round(sorted[index] ?? 0);
}

function distribution(
  values: readonly number[],
  source: string,
  reason: string,
): RuntimeE2EMetric<PercentileDistribution> {
  return values.length === 0
    ? unavailable(reason)
    : available(
        {
          n: values.length,
          p50: percentile(values, 50),
          p95: percentile(values, 95),
          p99: percentile(values, 99),
        },
        source,
      );
}

function rate(
  values: readonly boolean[],
  source: string,
  reason: string,
): RuntimeE2EMetric<RateSummary> {
  if (values.length === 0) {
    return unavailable(reason);
  }

  const successes = values.filter(Boolean).length;
  return available(
    {
      attempts: values.length,
      rate: round(successes / values.length),
      successes,
    },
    source,
  );
}

function availableValues<T>(
  samples: readonly RuntimeE2ESample[],
  pick: (sample: RuntimeE2ESample) => RuntimeE2EMetric<T>,
): T[] {
  return samples.flatMap((sample) => {
    const metric = pick(sample);
    return metric.status === "available" ? [metric.value] : [];
  });
}

function summarizeStage(
  samples: readonly RuntimeE2ESample[],
  stage: RuntimeE2EStage,
): StageEvidenceSummary {
  const evidence = samples.map((sample) => sample[stage]);

  return {
    measured: evidence.filter((value) => value.status === "measured").length,
    observed: evidence.filter((value) => value.status === "observed").length,
    unavailable: evidence.filter((value) => value.status === "unavailable").length,
  };
}

function summarizePath(samples: readonly RuntimeE2ESample[]): RuntimeE2EPathScoreboard {
  const ratios = samples.flatMap((sample) => {
    const visible = sample.visibleCharactersPerSecond;
    const direct = sample.providerDirectVisibleCharactersPerSecond;

    return visible.status === "available" && direct.status === "available" && direct.value > 0
      ? [visible.value / direct.value]
      : [];
  });
  const stages: Record<RuntimeE2EStage, StageEvidenceSummary> = {
    browserApply: summarizeStage(samples, "browserApply"),
    d1Commit: summarizeStage(samples, "d1Commit"),
    providerFirstDelta: summarizeStage(samples, "providerFirstDelta"),
    viewerPublish: summarizeStage(samples, "viewerPublish"),
  };

  return {
    correlation: {
      completeSamples: samples.filter(
        (sample) =>
          sample.correlationId !== null &&
          STAGES.every((stage) => {
            const evidence = sample[stage];
            return (
              evidence.status !== "unavailable" && evidence.evidenceId === sample.correlationId
            );
          }),
      ).length,
      stages,
    },
    interDeltaP95Ms: distribution(
      availableValues(samples, (sample) => sample.interDeltaP95Ms),
      "p95 across per-run inter-delta p95 measurements",
      "No run exposed an inter-delta p95.",
    ),
    samples: samples.length,
    terminalSuccess: rate(
      availableValues(samples, (sample) => sample.terminalSucceeded),
      "terminal run outcome",
      "No terminal run outcome was measured.",
    ),
    transportReconnectRecovery: rate(
      availableValues(samples, (sample) => sample.transportReconnectRecovered),
      "fault-injected transport recovery",
      "No run included a measured transport reconnect attempt.",
    ),
    ttftMs: distribution(
      availableValues(samples, (sample) => sample.ttftMs),
      "first visible output at the recorded consumer boundary",
      "No TTFT sample was measured.",
    ),
    visibleOutputRateVsProviderDirect: distribution(
      ratios,
      "E2E visible characters/s divided by matched provider-direct characters/s",
      "No sample supplied a matched same-workload/provider/model provider-direct baseline.",
    ),
  };
}

export function summarizeRuntimeE2EScoreboard(
  samples: readonly RuntimeE2ESample[],
  generatedAt = new Date().toISOString(),
  qualification: RuntimeE2EQualification = {
    acceptance: "4-pair staging acceptance",
    artifactPaths: {
      browser: "unavailable",
      crossover: "unavailable",
      providerDirect: "unavailable",
    },
    candidateCommit: "unavailable",
    checks: [
      {
        detail: "Browser, provider-direct, and frozen crossover artifacts were not supplied.",
        name: "qualification_artifacts",
        passed: false,
      },
    ],
    eligibleForPr: false,
    frozenHarnessRevision: "unavailable",
    pairs: [],
    sampleCounts: {
      browser: 0,
      browserExcluded: 0,
      browserFailed: 0,
      crossover: 0,
      crossoverDiscarded: 0,
      crossoverFailed: 0,
      providerDirect: 0,
      providerDirectFailed: 0,
      providerDirectWarmups: 0,
    },
    samplePolicies: {
      browser: "unavailable",
      crossover: "unavailable",
      providerDirect: "unavailable",
    },
  },
): RuntimeE2EScoreboard {
  const cold = samples.filter(
    (sample) => sample.path.status === "available" && sample.path.value === "cold",
  );
  const warm = samples.filter(
    (sample) => sample.path.status === "available" && sample.path.value === "warm",
  );

  return {
    cold: summarizePath(cold),
    generatedAt,
    overallTerminalSuccess: rate(
      availableValues(samples, (sample) => sample.terminalSucceeded),
      "all completed cold-start harness attempts",
      "No completed attempt exposed a terminal outcome.",
    ),
    qualification,
    schema: RUNTIME_E2E_SCOREBOARD_SCHEMA,
    totalSamples: samples.length,
    unclassifiedSamples: samples.length - cold.length - warm.length,
    warm: summarizePath(warm),
  };
}

function metricText<T>(metric: RuntimeE2EMetric<T>, format: (value: T) => string): string {
  return metric.status === "available" ? format(metric.value) : "unavailable";
}

function distributionText(metric: RuntimeE2EMetric<PercentileDistribution>): string {
  return metricText(metric, (value) => `${value.p50}/${value.p95}/${value.p99}`);
}

function rateText(metric: RuntimeE2EMetric<RateSummary>): string {
  return metricText(
    metric,
    (value) => `${Math.round(value.rate * 100)}% (${value.successes}/${value.attempts})`,
  );
}

function rawMetricText(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

export function renderRuntimeE2EScoreboardMarkdown(scoreboard: RuntimeE2EScoreboard): string {
  const failedChecks = scoreboard.qualification.checks.filter((check) => !check.passed);
  const lines = [
    "# Runtime E2E performance scoreboard",
    "",
    `Acceptance: ${scoreboard.qualification.acceptance} (not statistical certification)`,
    `Generated: ${scoreboard.generatedAt}`,
    `PR eligible: ${scoreboard.qualification.eligibleForPr ? "yes" : "no"}`,
    `Candidate: ${scoreboard.qualification.candidateCommit}`,
    `Samples: browser=${scoreboard.qualification.sampleCounts.browser} (failed=${scoreboard.qualification.sampleCounts.browserFailed}, excluded=${scoreboard.qualification.sampleCounts.browserExcluded}), provider-direct=${scoreboard.qualification.sampleCounts.providerDirect} (failed=${scoreboard.qualification.sampleCounts.providerDirectFailed}, warmups=${scoreboard.qualification.sampleCounts.providerDirectWarmups}), crossover=${scoreboard.qualification.sampleCounts.crossover} (failed=${scoreboard.qualification.sampleCounts.crossoverFailed}, discarded=${scoreboard.qualification.sampleCounts.crossoverDiscarded})`,
    `Gate failures: ${failedChecks.length}`,
    "",
    "| path | runs | TTFT p50/p95/p99 ms | visible rate / provider direct p50/p95/p99 | per-run inter-delta p95 distribution p50/p95/p99 ms | terminal success | reconnect recovery |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const [path, summary] of [
    ["cold", scoreboard.cold],
    ["warm", scoreboard.warm],
  ] as const) {
    lines.push(
      `| ${path} | ${summary.samples} | ${distributionText(summary.ttftMs)} | ${distributionText(summary.visibleOutputRateVsProviderDirect)} | ${distributionText(summary.interDeltaP95Ms)} | ${rateText(summary.terminalSuccess)} | ${rateText(summary.transportReconnectRecovery)} |`,
    );
  }

  lines.push(
    "",
    `Unclassified runs: ${scoreboard.unclassifiedSamples}`,
    `Overall terminal success: ${rateText(scoreboard.overallTerminalSuccess)}`,
    "",
    "| path | provider first delta | D1 commit | viewer publish | browser apply | complete chains |",
    "|---|---:|---:|---:|---:|---:|",
  );

  for (const [path, summary] of [
    ["cold", scoreboard.cold],
    ["warm", scoreboard.warm],
  ] as const) {
    const evidence = (stage: RuntimeE2EStage) => {
      const value = summary.correlation.stages[stage];
      return `${value.measured} measured / ${value.observed} observed / ${value.unavailable} unavailable`;
    };
    lines.push(
      `| ${path} | ${evidence("providerFirstDelta")} | ${evidence("d1Commit")} | ${evidence("viewerPublish")} | ${evidence("browserApply")} | ${summary.correlation.completeSamples}/${summary.samples} |`,
    );
  }

  lines.push("", "## Qualification gates", "");
  for (const check of scoreboard.qualification.checks) {
    lines.push(`- [${check.passed ? "x" : " "}] ${check.name}: ${check.detail}`);
  }
  lines.push(
    "",
    "## Per-pair raw values",
    "",
    "| pair | block/phase | baseline path TTFT/cadence/total ms | instrumented path TTFT/cadence/total ms | delta TTFT/cadence/total ms | browser path TTFT/cadence/total ms | output + terminal + chain |",
    "|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const pair of scoreboard.qualification.pairs) {
    const baseline = pair.transport.baseline;
    const candidate = pair.transport.instrumentedCandidate;
    const delta = pair.transport.delta;
    const browser = pair.browserCandidate;
    lines.push(
      `| ${pair.pair} | ${pair.block}/${pair.phase} | ${baseline.path ?? "unavailable"} ${rawMetricText(baseline.ttftMs)}/${rawMetricText(baseline.interDeltaP95Ms)}/${rawMetricText(baseline.totalCompletionMs)} | ${candidate.path ?? "unavailable"} ${rawMetricText(candidate.ttftMs)}/${rawMetricText(candidate.interDeltaP95Ms)}/${rawMetricText(candidate.totalCompletionMs)} | ${rawMetricText(delta.ttftMs)}/${rawMetricText(delta.interDeltaP95Ms)}/${rawMetricText(delta.totalCompletionMs)} | ${browser.path} ${browser.ttftMs}/${rawMetricText(browser.interDeltaP95Ms)}/${rawMetricText(browser.totalCompletionMs)} | ${baseline.outputEquivalent && candidate.outputEquivalent && browser.outputEquivalent ? "output ok" : "output failed"}; ${baseline.terminalSucceeded && candidate.terminalSucceeded && browser.terminalSucceeded ? "terminal ok" : "terminal failed"}; ${browser.correlationId} |`,
    );
  }
  lines.push(
    "",
    "## Failure and exclusion rules",
    "",
    `- browser: ${scoreboard.qualification.samplePolicies.browser}`,
    `- provider-direct: ${scoreboard.qualification.samplePolicies.providerDirect}`,
    `- crossover: ${scoreboard.qualification.samplePolicies.crossover}`,
  );

  return `${lines.join("\n")}\n`;
}

const STAGING_REQUIRED_FROZEN_INVARIANTS = [
  "crossoverTreatmentsComplete",
  "exactlyFourDeployments",
  "resourceConfigurationStable",
  "treatmentArtifactsStable",
  "twoPhysicalStacks",
] as const;

interface RuntimeE2EBrowserMetadata {
  readonly agentConfigSha256: string;
  readonly candidateCommit: string;
  readonly excludedSamples: number;
  readonly exclusionPolicy: string;
  readonly expectedOutputSha256: string;
  readonly failedSamples: number;
  readonly failurePolicy: string;
  readonly model: string;
  readonly pairIds: readonly number[];
  readonly promptSha256: string;
  readonly providerId: string;
  readonly runtimeId: string;
  readonly sampleTarget: number;
  readonly systemPromptSha256: string;
}

interface RuntimeE2EProviderDirect {
  readonly failedTrials: number;
  readonly failurePolicy: string;
  readonly matchedVisibleCharactersPerSecond: number | null;
  readonly trials: number;
  readonly warmupTrials: number;
}

export interface BuildRuntimeE2EScoreboardInput {
  readonly artifactPaths: RuntimeE2EQualification["artifactPaths"];
  readonly baselineCommit: string;
  readonly browserDocument: unknown;
  readonly candidateCommit: string;
  readonly crossoverDocument: unknown;
  readonly expectedHarnessRevision: string;
  readonly generatedAt?: string;
  readonly providerDirectDocument: unknown;
}

function requireArray(record: Record<string, unknown>, field: string, label: string): unknown[] {
  const value = record[field];

  if (!Array.isArray(value)) {
    throw new Error(`${label}.${field} must be an array.`);
  }

  return value;
}

function requireBoolean(record: Record<string, unknown>, field: string, label: string): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw new Error(`${label}.${field} must be a boolean.`);
  }

  return value;
}

function requireFiniteNumber(
  record: Record<string, unknown>,
  field: string,
  label: string,
): number {
  const value = record[field];

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}.${field} must be a non-negative finite number.`);
  }

  return value;
}

function requireInteger(record: Record<string, unknown>, field: string, label: string): number {
  const value = requireFiniteNumber(record, field, label);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label}.${field} must be a safe integer.`);
  }

  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  field: string,
  label: string,
): boolean | null {
  const value = record[field];

  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label}.${field} must be a boolean or null.`);
  }

  return value;
}

function readObservedStage(
  sample: Record<string, unknown>,
  field: string,
  label: string,
): ObservedStageEvidence {
  const value = requireRecord(sample[field], `${label}.${field}`);
  const clockDomain = requireString(value, "clockDomain", `${label}.${field}`);
  const evidenceId = requireString(value, "evidenceId", `${label}.${field}`);
  requireFiniteNumber(value, "epochMs", `${label}.${field}`);

  return {
    elapsedMs: null,
    evidenceId,
    reason:
      "Absolute observation retained in its source clock domain; cross-clock subtraction is invalid.",
    source: clockDomain,
    status: "observed",
  };
}

function readBrowserArtifact(document: unknown): {
  readonly metadata: RuntimeE2EBrowserMetadata;
  readonly records: Record<string, unknown>[];
} {
  const root = requireRecord(document, "Runtime E2E browser artifact");
  if (root["schemaVersion"] !== "mosoo.runtime-e2e-browser.v1") {
    throw new Error("Runtime E2E browser artifact has an unsupported schema.");
  }

  const fixture = requireRecord(root["fixture"], "Runtime E2E browser fixture");
  const workload = requireRecord(root["workload"], "Runtime E2E browser workload");
  const sampleTarget = requireInteger(root, "sampleTarget", "Runtime E2E browser artifact");
  const pairIds = requireArray(root, "pairIds", "Runtime E2E browser artifact").map(
    (value, index) => {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
        throw new Error(`Runtime E2E browser artifact pairIds[${index}] must be positive.`);
      }
      return value;
    },
  );

  return {
    metadata: {
      agentConfigSha256: requireString(fixture, "agentConfigSha256", "Runtime E2E browser fixture"),
      candidateCommit: requireString(root, "gitCommit", "Runtime E2E browser artifact"),
      excludedSamples: requireArray(root, "excludedSamples", "Runtime E2E browser artifact").length,
      exclusionPolicy: requireString(root, "exclusionPolicy", "Runtime E2E browser artifact"),
      expectedOutputSha256: requireString(
        workload,
        "expectedOutputSha256",
        "Runtime E2E browser workload",
      ),
      failedSamples: requireArray(root, "failedSamples", "Runtime E2E browser artifact").length,
      failurePolicy: requireString(root, "failurePolicy", "Runtime E2E browser artifact"),
      model: requireString(fixture, "model", "Runtime E2E browser fixture"),
      pairIds,
      promptSha256: requireString(workload, "promptSha256", "Runtime E2E browser workload"),
      providerId: requireString(fixture, "providerId", "Runtime E2E browser fixture"),
      runtimeId: requireString(fixture, "runtimeId", "Runtime E2E browser fixture"),
      sampleTarget,
      systemPromptSha256: requireString(
        workload,
        "systemPromptSha256",
        "Runtime E2E browser workload",
      ),
    },
    records: requireArray(root, "samples", "Runtime E2E browser artifact").map((value, index) =>
      requireRecord(value, `Runtime E2E browser sample ${index}`),
    ),
  };
}

function readProviderDirectArtifact(
  document: unknown,
  browser: RuntimeE2EBrowserMetadata,
  expectedCandidateCommit: string,
  checks: RuntimeE2EGateCheck[],
): RuntimeE2EProviderDirect {
  const root = requireRecord(document, "Provider-direct artifact");
  const cells = requireArray(root, "cells", "Provider-direct artifact");
  const cell = cells.length === 1 ? requireRecord(cells[0], "Provider-direct cell") : null;
  const schemaMatches = root["schemaVersion"] === "mosoo.driver-ttft.v2";
  const schemaVersion =
    typeof root["schemaVersion"] === "string" ? root["schemaVersion"] : "missing or invalid";
  const generatedStamp =
    typeof root["generatedStamp"] === "string" ? root["generatedStamp"] : "missing or invalid";

  checks.push({
    detail: schemaVersion,
    name: "provider_direct_schema",
    passed: schemaMatches,
  });
  checks.push({
    detail: `${generatedStamp} expected ${expectedCandidateCommit || "missing"}`,
    name: "provider_direct_candidate_commit",
    passed:
      expectedCandidateCommit.length > 0 && root["generatedStamp"] === expectedCandidateCommit,
  });

  if (cell === null) {
    checks.push({
      detail: `expected one matched cell, observed ${cells.length}`,
      name: "provider_direct_cell",
      passed: false,
    });
    return {
      failedTrials: 0,
      failurePolicy: "unavailable",
      matchedVisibleCharactersPerSecond: null,
      trials: 0,
      warmupTrials: 0,
    };
  }

  const provenanceMatches =
    cell["providerId"] === browser.providerId &&
    cell["runtimeId"] === browser.runtimeId &&
    cell["model"] === browser.model &&
    cell["promptSha256"] === browser.promptSha256 &&
    cell["systemPromptSha256"] === browser.systemPromptSha256 &&
    cell["expectedOutputSha256"] === browser.expectedOutputSha256 &&
    cell["outputValidation"] === "exact";
  checks.push({
    detail: provenanceMatches
      ? `${String(cell["providerId"])}/${String(cell["runtimeId"])}/${String(cell["model"])}`
      : "provider/runtime/model/workload provenance mismatch",
    name: "provider_direct_provenance",
    passed: provenanceMatches,
  });

  const trials = requireArray(cell, "trials", "Provider-direct cell").map((value, index) =>
    requireRecord(value, `Provider-direct trial ${index}`),
  );
  const successful = trials.filter((trial) => requireBoolean(trial, "ok", "Provider-direct trial"));
  const failurePolicy = requireString(root, "failurePolicy", "Provider-direct artifact");
  const warmupTrials = requireInteger(root, "warmupTrialsPerCell", "Provider-direct artifact");
  const rates = successful.flatMap((trial) => {
    const firstTextMs = optionalFiniteNumber(trial, "firstTextMs", "Provider-direct trial");
    const totalMs = optionalFiniteNumber(trial, "totalMs", "Provider-direct trial");
    const characters = requireFiniteNumber(trial, "outputChars", "Provider-direct trial");
    const durationMs = firstTextMs === null || totalMs === null ? null : totalMs - firstTextMs;

    return characters > 0 && durationMs !== null && durationMs > 0
      ? [(characters * 1_000) / durationMs]
      : [];
  });

  checks.push(
    {
      detail: `${trials.length} trials`,
      name: "provider_direct_sample_count",
      passed:
        trials.length === 4 &&
        trials.length === requireInteger(root, "trials", "Provider-direct artifact"),
    },
    {
      detail: `${successful.length}/${trials.length} exact terminal successes`,
      name: "provider_direct_terminal_success",
      passed: trials.length > 0 && successful.length === trials.length,
    },
    {
      detail: `${rates.length}/${trials.length} visible-rate samples`,
      name: "provider_direct_visible_rate",
      passed: rates.length === trials.length,
    },
    {
      detail: `${warmupTrials} warmup, ${trials.length - successful.length} failed; ${failurePolicy}`,
      name: "provider_direct_failure_and_exclusion_policy",
      passed:
        warmupTrials === 1 &&
        failurePolicy === "all recorded trials are retained; any failure invalidates qualification",
    },
  );

  return {
    failedTrials: trials.length - successful.length,
    failurePolicy,
    matchedVisibleCharactersPerSecond:
      schemaMatches && provenanceMatches && rates.length === trials.length && rates.length > 0
        ? percentile(rates, 50)
        : null,
    trials: trials.length,
    warmupTrials,
  };
}

function browserSamples(
  records: readonly Record<string, unknown>[],
  providerDirect: RuntimeE2EProviderDirect,
): RuntimeE2ESample[] {
  return records.map((record, index) => {
    const label = `Runtime E2E browser sample ${index}`;
    const correlationId = requireString(record, "correlationId", label);
    const path = requireString(record, "path", label);
    const ttftMs = requireFiniteNumber(record, "ttftMs", label);
    const terminalSucceeded = requireBoolean(record, "terminalSucceeded", label);
    const outputEquivalent = requireBoolean(record, "outputEquivalent", label);
    const reconnectRecovered = optionalBoolean(record, "transportReconnectRecovered", label);
    const visibleRate = optionalFiniteNumber(record, "visibleCharactersPerSecond", label);
    const interDeltaP95Ms = optionalFiniteNumber(record, "interDeltaP95Ms", label);
    const pair = requireInteger(record, "pair", label);

    if (path !== "cold" && path !== "warm") {
      throw new Error(`${label}.path must be cold or warm.`);
    }

    readObservedStage(record, "browserFrameReceived", label);
    const browserApply = readObservedStage(record, "browserApply", label);

    return {
      browserApply: {
        elapsedMs: ttftMs,
        evidenceId: browserApply.evidenceId,
        source: browserApply.source,
        status: "measured",
      },
      correlationId,
      d1Commit: readObservedStage(record, "d1Commit", label),
      interDeltaP95Ms: metricFromNumber(
        interDeltaP95Ms,
        "browser viewer WebSocket delta cadence",
        "The browser run produced fewer than two visible deltas.",
      ),
      pair,
      path: available(path, "runtime.timing.recorded api:prepare_run"),
      providerDirectVisibleCharactersPerSecond:
        providerDirect.matchedVisibleCharactersPerSecond === null
          ? unavailable("Provider-direct artifact did not match the browser workload.")
          : available(
              providerDirect.matchedVisibleCharactersPerSecond,
              "matched live Driver provider-direct median",
            ),
      providerFirstDelta: readObservedStage(record, "providerFirstDelta", label),
      runId: requireString(record, "runId", label),
      sessionId: requireString(record, "sessionId", label),
      terminalSucceeded: available(
        terminalSucceeded && outputEquivalent,
        "browser terminal status plus exact visible output",
      ),
      transportReconnectRecovered:
        reconnectRecovered === null
          ? unavailable("No transport fault was injected before this run.")
          : available(reconnectRecovered, "staging Session socket close and reconnect"),
      ttftMs: available(
        ttftMs,
        "browser Send click to first rendered assistant prefix after double RAF",
      ),
      viewerPublish: readObservedStage(record, "viewerPublish", label),
      visibleCharactersPerSecond: metricFromNumber(
        visibleRate,
        "browser viewer WebSocket visible characters / first-delta-to-terminal",
        "The browser run did not expose a positive streaming duration.",
      ),
    };
  });
}

function gate(checks: RuntimeE2EGateCheck[], name: string, passed: boolean, detail: string): void {
  checks.push({ detail, name, passed });
}

function qualifyBrowser(
  metadata: RuntimeE2EBrowserMetadata,
  samples: readonly RuntimeE2ESample[],
  records: readonly Record<string, unknown>[],
  expectedCandidateCommit: string,
  checks: RuntimeE2EGateCheck[],
): void {
  const cold = samples.filter(
    (sample) => sample.path.status === "available" && sample.path.value === "cold",
  );
  const warm = samples.filter(
    (sample) => sample.path.status === "available" && sample.path.value === "warm",
  );
  const correlated = samples.filter(
    (sample) =>
      sample.correlationId !== null &&
      STAGES.every((stage) => {
        const evidence = sample[stage];
        return evidence.status !== "unavailable" && evidence.evidenceId === sample.correlationId;
      }),
  );
  const reconnects = records.map((record) =>
    optionalBoolean(record, "transportReconnectRecovered", "Runtime E2E browser sample"),
  );
  const samplePairIds = samples.flatMap((sample) => (sample.pair === null ? [] : [sample.pair]));
  const expectedPairIds = [...metadata.pairIds].toSorted((left, right) => left - right);
  const observedPairIds = [...new Set(samplePairIds)].toSorted((left, right) => left - right);

  gate(
    checks,
    "browser_candidate_commit",
    expectedCandidateCommit.length > 0 && metadata.candidateCommit === expectedCandidateCommit,
    `${metadata.candidateCommit} expected ${expectedCandidateCommit || "missing"}`,
  );
  gate(
    checks,
    "browser_deepseek_fixture",
    metadata.providerId === "deepseek" && metadata.runtimeId === "acp-fallback",
    `${metadata.providerId}/${metadata.runtimeId}/${metadata.model}`,
  );
  gate(
    checks,
    "browser_sample_count",
    metadata.sampleTarget === 4 && samples.length === metadata.sampleTarget,
    `${samples.length}/${metadata.sampleTarget}`,
  );
  gate(
    checks,
    "browser_four_pair_identity",
    metadata.pairIds.length === 4 &&
      new Set(metadata.pairIds).size === 4 &&
      JSON.stringify(observedPairIds) === JSON.stringify(expectedPairIds),
    `pairs=${observedPairIds.join(",")}`,
  );
  gate(
    checks,
    "browser_failure_and_exclusion_policy",
    metadata.failedSamples === 0 &&
      metadata.excludedSamples === 0 &&
      metadata.failurePolicy === RUNTIME_E2E_BROWSER_FAILURE_POLICY &&
      metadata.exclusionPolicy === RUNTIME_E2E_BROWSER_EXCLUSION_POLICY,
    `failed=${metadata.failedSamples}, excluded=${metadata.excludedSamples}; ${metadata.failurePolicy}; ${metadata.exclusionPolicy}`,
  );
  gate(
    checks,
    "browser_complete_correlation",
    correlated.length === samples.length && samples.length > 0,
    `${correlated.length}/${samples.length} four-stage sourceEventId chains`,
  );
  gate(
    checks,
    "browser_cold_warm_classification",
    cold.length > 0 && warm.length > 0,
    `cold=${cold.length}, warm=${warm.length}`,
  );
  gate(
    checks,
    "browser_terminal_and_output",
    samples.every(
      (sample) => sample.terminalSucceeded.status === "available" && sample.terminalSucceeded.value,
    ),
    `${samples.filter((sample) => sample.terminalSucceeded.status === "available" && sample.terminalSucceeded.value).length}/${samples.length}`,
  );
  gate(
    checks,
    "browser_cadence",
    [cold, warm].every((cohort) =>
      cohort.some((sample) => sample.interDeltaP95Ms.status === "available"),
    ),
    "inter-delta p95 is available for both cold and warm cohorts",
  );
  gate(
    checks,
    "browser_visible_rate",
    [cold, warm].every((cohort) =>
      cohort.some((sample) => sample.visibleCharactersPerSecond.status === "available"),
    ),
    "visible characters/s is available for both cold and warm cohorts",
  );
  gate(
    checks,
    "browser_visible_rate_vs_provider_direct",
    [cold, warm].every((cohort) =>
      cohort.some(
        (sample) =>
          sample.visibleCharactersPerSecond.status === "available" &&
          sample.providerDirectVisibleCharactersPerSecond.status === "available",
      ),
    ),
    "matched provider-direct ratio is available for both cold and warm cohorts",
  );
  gate(
    checks,
    "browser_reconnect_recovery",
    reconnects.includes(true) && !reconnects.includes(false),
    `${reconnects.filter((value) => value === true).length} recovered, ${reconnects.filter((value) => value === false).length} failed`,
  );
}

interface StagingCrossoverRun extends RuntimeE2EAcceptancePairMetrics {
  readonly block: number;
  readonly pair: number;
  readonly phase: number;
  readonly variant: "after" | "before";
}

interface StagingCrossoverPair {
  readonly baseline: RuntimeE2EAcceptancePairMetrics;
  readonly block: number;
  readonly instrumentedCandidate: RuntimeE2EAcceptancePairMetrics;
  readonly pair: number;
  readonly phase: number;
}

function readCount(record: Record<string, unknown>, field: string, label: string): number {
  return requireInteger(record, field, label);
}

function readStagingCrossoverRun(value: unknown, index: number): StagingCrossoverRun {
  const label = `Frozen crossover run ${index}`;
  const run = requireRecord(value, label);
  const sample = requireRecord(run["sample"], `${label}.sample`);
  const metrics = requireRecord(sample["metrics"], `${label}.sample.metrics`);
  const output = requireRecord(sample["output"], `${label}.sample.output`);
  const variant = requireString(run, "variant", label);
  const runId = requireString(sample, "runId", `${label}.sample`);
  const sessionId = requireString(sample, "threadId", `${label}.sample`);
  const path = readRuntimePath(readTimingEntries(run), { runId, sessionId });
  const totalCompletionMs = optionalFiniteNumber(
    metrics,
    "runCompletedMs",
    `${label}.sample.metrics`,
  );
  const outputEquivalent = requireBoolean(output, "valid", `${label}.sample.output`);

  if (variant !== "before" && variant !== "after") {
    throw new Error(`${label}.variant must be before or after.`);
  }

  return {
    block: requireInteger(run, "block", label),
    interDeltaP95Ms: optionalFiniteNumber(metrics, "interChunkP95Ms", `${label}.sample.metrics`),
    outputEquivalent,
    pair: requireInteger(run, "pair", label),
    path: path.status === "available" ? path.value : null,
    phase: requireInteger(run, "phase", label),
    terminalSucceeded: sample["failure"] === null && outputEquivalent && totalCompletionMs !== null,
    totalCompletionMs,
    ttftMs: optionalFiniteNumber(metrics, "sendToFirstAssistantTextMs", `${label}.sample.metrics`),
    variant,
  };
}

function pairStagingCrossoverRuns(runs: readonly StagingCrossoverRun[]): StagingCrossoverPair[] {
  const byPair = new Map<number, StagingCrossoverRun[]>();

  for (const run of runs) {
    const pairRuns = byPair.get(run.pair) ?? [];
    pairRuns.push(run);
    byPair.set(run.pair, pairRuns);
  }

  return [...byPair.entries()]
    .flatMap(([pair, pairRuns]) => {
      const baseline = pairRuns.find((run) => run.variant === "before");
      const instrumentedCandidate = pairRuns.find((run) => run.variant === "after");

      return pairRuns.length === 2 &&
        baseline !== undefined &&
        instrumentedCandidate !== undefined &&
        baseline.block === instrumentedCandidate.block &&
        baseline.phase === instrumentedCandidate.phase
        ? [
            {
              baseline,
              block: baseline.block,
              instrumentedCandidate,
              pair,
              phase: baseline.phase,
            },
          ]
        : [];
    })
    .toSorted((left, right) => left.pair - right.pair);
}

function metricP95NotWorse(
  pairs: readonly StagingCrossoverPair[],
  field: "interDeltaP95Ms" | "totalCompletionMs" | "ttftMs",
): boolean {
  const baseline = pairs.flatMap((pair) => {
    const value = pair.baseline[field];
    return value === null ? [] : [value];
  });
  const candidate = pairs.flatMap((pair) => {
    const value = pair.instrumentedCandidate[field];
    return value === null ? [] : [value];
  });

  return (
    baseline.length === pairs.length &&
    candidate.length === pairs.length &&
    percentile(candidate, 95) <= percentile(baseline, 95)
  );
}

function qualifyStagingCrossover(
  document: unknown,
  input: {
    readonly baselineCommit: string;
    readonly browser: RuntimeE2EBrowserMetadata;
    readonly candidateCommit: string;
    readonly expectedHarnessRevision: string;
  },
  checks: RuntimeE2EGateCheck[],
): {
  readonly discarded: number;
  readonly failed: number;
  readonly harnessRevision: string;
  readonly pairs: readonly StagingCrossoverPair[];
  readonly runs: number;
} {
  const root = requireRecord(document, "Frozen crossover artifact");
  const method = requireRecord(root["method"], "Frozen crossover method");
  const budget = requireRecord(method["budget"], "Frozen crossover budget");
  const summary = requireRecord(root["summary"], "Frozen crossover summary");
  const summaryGate = requireRecord(summary["gate"], "Frozen crossover gate");
  const rawRuns = requireArray(root, "runs", "Frozen crossover artifact");
  const runs = rawRuns.map(readStagingCrossoverRun);
  const pairs = pairStagingCrossoverRuns(runs);
  const deployments = requireArray(root, "deployments", "Frozen crossover artifact").map(
    (value, index) => requireRecord(value, `Frozen crossover deployment ${index}`),
  );
  const executions = requireArray(root, "executions", "Frozen crossover artifact").map(
    (value, index) => requireRecord(value, `Frozen crossover execution ${index}`),
  );
  const failedAttempts = requireArray(root, "failedAttempts", "Frozen crossover artifact");
  const discardedBlocks = requireArray(root, "discardedBlocks", "Frozen crossover artifact");
  const harnessRevision = requireString(method, "harnessRevision", "Frozen crossover method");

  gate(
    checks,
    "frozen_schema_and_revision",
    root["schemaVersion"] === "mosoo.cold-start-ab.v12" &&
      input.expectedHarnessRevision.length > 0 &&
      harnessRevision === input.expectedHarnessRevision,
    `schema=${String(root["schemaVersion"])}, revision=${harnessRevision}`,
  );
  gate(
    checks,
    "frozen_design",
    method["journey"] === "two-stage" &&
      readCount(method, "totalBlocks", "Frozen crossover method") === 16 &&
      readCount(method, "totalPairs", "Frozen crossover method") === 32 &&
      readCount(budget, "maxAttemptedRuns", "Frozen crossover budget") === 64 &&
      readCount(budget, "maxFailedAttempts", "Frozen crossover budget") === 0 &&
      readCount(budget, "maxUsageTotalTokens", "Frozen crossover budget") === 200_000 &&
      readCount(budget, "maxWallClockMs", "Frozen crossover budget") === 21_600_000 &&
      requireString(method, "sourceRegion", "Frozen crossover method") !== "unknown",
    "two-stage 16-block/32-pair/64-attempt frozen budget",
  );
  gate(
    checks,
    "staging_four_pair_slice",
    runs.length === 8 &&
      pairs.length === 4 &&
      new Set(runs.map((run) => run.block)).size === 2 &&
      new Set(runs.map((run) => run.phase)).size === 2 &&
      deployments.length === 4 &&
      executions.length === 2 &&
      executions.every(
        (execution) => requireInteger(execution, "blockCount", "Frozen crossover execution") === 1,
      ) &&
      executions.some(
        (execution) => requireInteger(execution, "blockStart", "Frozen crossover execution") === 0,
      ) &&
      executions.some(
        (execution) => requireInteger(execution, "blockStart", "Frozen crossover execution") === 8,
      ) &&
      failedAttempts.length === 0 &&
      discardedBlocks.length === 0 &&
      root["pendingAttempt"] === null &&
      root["pendingDeployment"] === null,
    `runs=${runs.length}, pairs=${pairs.length}, deployments=${deployments.length}, slices=${executions.length}`,
  );

  const failedGateNames = STAGING_REQUIRED_FROZEN_INVARIANTS.filter(
    (name) => summaryGate[name] !== true,
  );
  gate(
    checks,
    "staging_frozen_invariants",
    failedGateNames.length === 0,
    failedGateNames.length === 0
      ? "applicable frozen deployment invariants passed"
      : failedGateNames.join(", "),
  );
  const overheadGateNames = [
    "sendP95NotWorse",
    "streamingP95NotWorse",
    "completionP95NotWorse",
    "phaseCompletionMediansNotWorse",
  ] as const;
  const failedOverheadGateNames = overheadGateNames.filter((name) => summaryGate[name] !== true);
  const rawOverheadPassed =
    metricP95NotWorse(pairs, "ttftMs") &&
    metricP95NotWorse(pairs, "interDeltaP95Ms") &&
    metricP95NotWorse(pairs, "totalCompletionMs") &&
    pairs.every(
      (pair) =>
        pair.baseline.outputEquivalent &&
        pair.baseline.terminalSucceeded &&
        pair.instrumentedCandidate.outputEquivalent &&
        pair.instrumentedCandidate.terminalSucceeded,
    );
  gate(
    checks,
    "instrumentation_overhead_no_material_regression",
    failedOverheadGateNames.length === 0 && rawOverheadPassed,
    failedOverheadGateNames.length === 0 && rawOverheadPassed
      ? "TTFT, cadence, and total-completion crossover gates passed"
      : [...failedOverheadGateNames, ...(rawOverheadPassed ? [] : ["rawPairMetrics"])].join(", "),
  );

  const output = requireRecord(summary["output"], "Frozen crossover output summary");
  const identity = requireRecord(summary["identity"], "Frozen crossover identity summary");
  const trace = requireRecord(summary["trace"], "Frozen crossover trace summary");

  gate(
    checks,
    "staging_pair_output_identity_trace_cleanup",
    readCount(output, "equivalentRuns", "Frozen crossover output summary") === runs.length &&
      readCount(identity, "completeRuns", "Frozen crossover identity summary") === runs.length &&
      readCount(identity, "uniqueContainerDurableObjects", "Frozen crossover identity summary") ===
        runs.length &&
      readCount(identity, "uniqueDriverInstances", "Frozen crossover identity summary") ===
        runs.length &&
      readCount(identity, "uniqueSandboxes", "Frozen crossover identity summary") === runs.length &&
      readCount(trace, "completeRuns", "Frozen crossover trace summary") === runs.length &&
      pairs.every(
        (pair) => pair.baseline.path !== null && pair.instrumentedCandidate.path !== null,
      ),
    `${runs.length}/${runs.length} exact outputs, identities with cleanup, traces, and recorded paths`,
  );

  const treatmentCommitsMatch = deployments.every((deployment) => {
    const expectedCommit =
      deployment["variant"] === "after"
        ? input.candidateCommit
        : deployment["variant"] === "before"
          ? input.baselineCommit
          : null;
    return (
      expectedCommit !== null &&
      expectedCommit.length > 0 &&
      typeof deployment["sourceRevision"] === "string" &&
      deployment["sourceRevision"].startsWith(`git:${expectedCommit}:tree:`)
    );
  });
  gate(
    checks,
    "frozen_treatment_revisions",
    treatmentCommitsMatch,
    `before=${input.baselineCommit || "missing"}, after=${input.candidateCommit || "missing"}`,
  );

  const fixtureA = requireRecord(root["fixture"], "Frozen crossover fixture A");
  const fixtureB = requireRecord(root["fixtureB"], "Frozen crossover fixture B");
  const fixtureMatches = [fixtureA, fixtureB].every(
    (fixture) =>
      fixture["agentConfigSha256"] === input.browser.agentConfigSha256 &&
      fixture["providerId"] === input.browser.providerId &&
      fixture["runtimeId"] === input.browser.runtimeId &&
      fixture["model"] === input.browser.model,
  );
  gate(
    checks,
    "frozen_fixture_provenance",
    fixtureMatches,
    fixtureMatches ? "browser and crossover fixtures match" : "fixture provenance mismatch",
  );

  return {
    discarded: discardedBlocks.length,
    failed: failedAttempts.length,
    harnessRevision,
    pairs,
    runs: runs.length,
  };
}

function metricNumber(metric: RuntimeE2EMetric<number>): number | null {
  return metric.status === "available" ? metric.value : null;
}

function metricDelta(candidate: number | null, baseline: number | null): number | null {
  return candidate === null || baseline === null ? null : round(candidate - baseline);
}

function buildAcceptancePairs(
  crossoverPairs: readonly StagingCrossoverPair[],
  samples: readonly RuntimeE2ESample[],
  browserRecords: readonly Record<string, unknown>[],
  checks: RuntimeE2EGateCheck[],
): RuntimeE2EAcceptancePair[] {
  const pairs = crossoverPairs.flatMap((crossoverPair) => {
    const browserIndex = samples.findIndex((sample) => sample.pair === crossoverPair.pair);
    const browser = samples[browserIndex];
    const record = browserRecords[browserIndex];

    if (
      browser === undefined ||
      record === undefined ||
      browser.correlationId === null ||
      browser.path.status !== "available" ||
      browser.ttftMs.status !== "available" ||
      browser.terminalSucceeded.status !== "available"
    ) {
      return [];
    }

    const baseline = crossoverPair.baseline;
    const instrumentedCandidate = crossoverPair.instrumentedCandidate;

    return [
      {
        block: crossoverPair.block,
        browserCandidate: {
          correlationId: browser.correlationId,
          interDeltaP95Ms: metricNumber(browser.interDeltaP95Ms),
          outputEquivalent: requireBoolean(
            record,
            "outputEquivalent",
            `Runtime E2E browser pair ${crossoverPair.pair}`,
          ),
          path: browser.path.value,
          terminalSucceeded: browser.terminalSucceeded.value,
          totalCompletionMs: optionalFiniteNumber(
            record,
            "turnCompletedMs",
            `Runtime E2E browser pair ${crossoverPair.pair}`,
          ),
          ttftMs: browser.ttftMs.value,
        },
        pair: crossoverPair.pair,
        phase: crossoverPair.phase,
        transport: {
          baseline,
          delta: {
            interDeltaP95Ms: metricDelta(
              instrumentedCandidate.interDeltaP95Ms,
              baseline.interDeltaP95Ms,
            ),
            totalCompletionMs: metricDelta(
              instrumentedCandidate.totalCompletionMs,
              baseline.totalCompletionMs,
            ),
            ttftMs: metricDelta(instrumentedCandidate.ttftMs, baseline.ttftMs),
          },
          instrumentedCandidate,
        },
      },
    ];
  });
  const complete = pairs.filter((pair) => {
    const sample = samples.find((candidate) => candidate.pair === pair.pair);
    return (
      sample !== undefined &&
      STAGES.every((stage) => {
        const evidence = sample[stage];
        return evidence.status !== "unavailable" && evidence.evidenceId === sample.correlationId;
      }) &&
      pair.transport.baseline.path !== null &&
      pair.transport.instrumentedCandidate.path !== null &&
      pair.transport.baseline.outputEquivalent &&
      pair.transport.baseline.terminalSucceeded &&
      pair.transport.instrumentedCandidate.outputEquivalent &&
      pair.transport.instrumentedCandidate.terminalSucceeded &&
      pair.browserCandidate.interDeltaP95Ms !== null &&
      pair.browserCandidate.outputEquivalent &&
      pair.browserCandidate.terminalSucceeded &&
      pair.browserCandidate.totalCompletionMs !== null
    );
  });

  gate(
    checks,
    "staging_four_pair_join_and_correlation",
    pairs.length === 4 && complete.length === 4,
    `${complete.length}/4 pairs have exact output, terminal success, recorded cold/warm path, cadence, completion, and four-stage correlation`,
  );

  return pairs;
}

export function buildRuntimeE2EScoreboard(
  input: BuildRuntimeE2EScoreboardInput,
): RuntimeE2EScoreboard {
  const checks: RuntimeE2EGateCheck[] = [];
  const browser = readBrowserArtifact(input.browserDocument);
  const providerDirect = readProviderDirectArtifact(
    input.providerDirectDocument,
    browser.metadata,
    input.candidateCommit,
    checks,
  );
  const samples = browserSamples(browser.records, providerDirect);

  qualifyBrowser(browser.metadata, samples, browser.records, input.candidateCommit, checks);
  const crossover = qualifyStagingCrossover(
    input.crossoverDocument,
    {
      baselineCommit: input.baselineCommit,
      browser: browser.metadata,
      candidateCommit: input.candidateCommit,
      expectedHarnessRevision: input.expectedHarnessRevision,
    },
    checks,
  );
  const pairs = buildAcceptancePairs(crossover.pairs, samples, browser.records, checks);

  const qualification: RuntimeE2EQualification = {
    acceptance: "4-pair staging acceptance",
    artifactPaths: input.artifactPaths,
    candidateCommit: input.candidateCommit || "unavailable",
    checks,
    eligibleForPr: checks.length > 0 && checks.every((check) => check.passed),
    frozenHarnessRevision: crossover.harnessRevision,
    pairs,
    sampleCounts: {
      browser: browser.records.length,
      browserExcluded: browser.metadata.excludedSamples,
      browserFailed: browser.metadata.failedSamples,
      crossover: crossover.runs,
      crossoverDiscarded: crossover.discarded,
      crossoverFailed: crossover.failed,
      providerDirect: providerDirect.trials,
      providerDirectFailed: providerDirect.failedTrials,
      providerDirectWarmups: providerDirect.warmupTrials,
    },
    samplePolicies: {
      browser: `${browser.metadata.failurePolicy}; ${browser.metadata.exclusionPolicy}`,
      crossover:
        "failed attempts are retained; discarded blocks and any post-run exclusion fail qualification",
      providerDirect: `${providerDirect.failurePolicy}; one pre-recording warmup per cell`,
    },
  };

  return summarizeRuntimeE2EScoreboard(
    samples,
    input.generatedAt ?? new Date().toISOString(),
    qualification,
  );
}
