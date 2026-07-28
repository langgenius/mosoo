export const RUNTIME_E2E_SCOREBOARD_SCHEMA = "mosoo.runtime-e2e-scoreboard.v1" as const;

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
  readonly schema: typeof RUNTIME_E2E_SCOREBOARD_SCHEMA;
  readonly totalSamples: number;
  readonly unclassifiedSamples: number;
  readonly warm: RuntimeE2EPathScoreboard;
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

function readProviderFirstDelta(
  timings: readonly Record<string, unknown>[],
  input: { readonly runId: string; readonly sessionId: string },
): RuntimeE2EStageEvidence {
  for (const entry of timings) {
    const timing = entry["timing"];

    if (
      !timingMatchesRun(entry, input) ||
      !isRecord(timing) ||
      timing["source"] !== "driver" ||
      timing["stage"] !== "driver_turn" ||
      !Array.isArray(timing["phases"])
    ) {
      continue;
    }

    const phase = timing["phases"]
      .map((value) => requireRecord(value, "Driver timing phase"))
      .find(
        (value) =>
          value["name"] === "provider.first_event" ||
          value["name"] === "provider.first_text.observed",
      );

    if (phase === undefined) {
      continue;
    }

    const durationMs = optionalFiniteNumber(phase, "durationMs", "Driver timing phase");
    const eventId = entry["eventId"];

    return {
      elapsedMs: durationMs,
      evidenceId: typeof eventId === "string" ? eventId : null,
      reason:
        "Driver timing proves the provider milestone, but its phase duration is not a cross-clock E2E timestamp.",
      source: `runtime.timing.recorded driver:driver_turn:${String(phase["name"])}`,
      status: "observed",
    };
  }

  return unavailable("This run did not expose a provider first-delta phase.");
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
  const providerFirstDelta =
    correlation === null
      ? unavailable("The attempt did not reach a run/session identity.")
      : readProviderFirstDelta(timings, correlation);
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
    correlationId: correlation?.correlationId ?? null,
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
    providerDirectVisibleCharactersPerSecond: unavailable(
      "No same-workload/provider/model live Driver artifact was supplied.",
    ),
    providerFirstDelta,
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
          STAGES.every((stage) => sample[stage].status !== "unavailable"),
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

export function renderRuntimeE2EScoreboardMarkdown(scoreboard: RuntimeE2EScoreboard): string {
  const lines = [
    "# Runtime E2E performance scoreboard",
    "",
    `Generated: ${scoreboard.generatedAt}`,
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

  return `${lines.join("\n")}\n`;
}
