import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadRepoEnv } from "../env";
import {
  COLD_START_LEAD_TOLERANCE_MS,
  parseRuntimeBenchmarkFixture,
  runColdStartSample,
} from "../lib/cold-start-benchmark";
import type {
  BenchmarkJourney,
  BenchmarkVariant,
  ColdStartRunResult,
  RuntimeBenchmarkFixture,
} from "../lib/cold-start-benchmark";
import {
  createInterleavedBlockPlans,
  createPairNonce,
  deploymentTreatmentDriftFields,
  runtimeTimingMatchesTrace,
  runtimeTraceIsComplete,
  summarizeColdStartExperiment,
  toColdStartRunPlan,
} from "../lib/cold-start-experiment";
import type {
  BenchmarkStack,
  CrossoverPhase,
  CleanupVerification,
  ColdStartExperimentSummary,
  DeploymentIdentity,
  ExperimentRun,
  InterleavedRunPlan,
  ObservedRunIdentity,
  ObservedRunTrace,
} from "../lib/cold-start-experiment";

const SCHEMA_VERSION = "mosoo.cold-start-ab.v12";
const HARNESS_REVISION_VERSION = "mosoo.perf-harness.v1";
const HOOK_RESULT_PREFIX = "MOSOO_PERF_HOOK_RESULT=";
const LEGACY_ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TRACE_EVIDENCE_DELAYS_MS = [0, 500, 1_000] as const;
const TRACE_EVIDENCE_METHOD =
  "Exactly three post-completion trace snapshots at approximately 0, 500, and 1500 ms; never stop early; select the last complete snapshot; legacy runAcceptedAt fallback is one-shot-only.";

interface BenchmarkExecution {
  readonly blockCount: number;
  readonly blockStart: number;
  readonly harnessRevision: string;
  readonly ordinal: number;
  readonly startedAt: string;
}

interface BenchmarkBudget {
  readonly maxAttemptedRuns: number;
  readonly maxFailedAttempts: number;
  readonly maxUsageTotalTokens: number;
  readonly maxWallClockMs: number;
}

export interface BenchmarkBudgetUsage {
  readonly attemptedRuns: number;
  readonly elapsedMs: number;
  readonly failedAttempts: number;
  readonly usageTotalTokens: number;
}

interface DiscardedBlock {
  readonly block: number;
  readonly discardedAt: string;
  readonly reason: string;
  readonly runs: ExperimentRun[];
}

interface PendingDeployment {
  readonly ordinal: number;
  readonly phase: CrossoverPhase;
  readonly stack: BenchmarkStack;
  readonly startedAt: string;
  readonly variant: BenchmarkVariant;
}

export type PendingAttemptStage = "cleaned" | "identified" | "prepared" | "sampled" | "traced";

export type AttemptFailureStage =
  | "cleanup"
  | "delete_thread"
  | "execution_interrupted"
  | "identity"
  | "sample"
  | "trace";

export interface AttemptError {
  readonly at: string;
  readonly message: string;
  readonly name: string;
  readonly stage: AttemptFailureStage;
}

export interface PendingCleanupState {
  readonly containerGone: boolean;
  readonly threadDeleted: boolean;
  readonly verifiedAt: string | null;
}

export interface PendingAttempt extends InterleavedRunPlan {
  readonly attemptStartedAt: string;
  readonly cleanup: PendingCleanupState;
  readonly cleanupError: AttemptError | null;
  readonly deploymentOrdinal: number;
  readonly executionOrdinal: number;
  readonly identity: ObservedRunIdentity | null;
  readonly nonce: string;
  readonly primaryError: AttemptError | null;
  readonly sample: ColdStartRunResult | null;
  readonly stage: PendingAttemptStage;
  readonly trace: ObservedRunTrace | null;
  readonly updatedAt: string;
}

export type FailedAttempt = PendingAttempt & {
  readonly cleanup: CleanupVerification;
  readonly failedAt: string;
  readonly primaryError: AttemptError;
  readonly sample: ColdStartRunResult;
  readonly stage: "cleaned";
};

export interface BenchmarkDocument {
  readonly createdAt: string;
  readonly deployments: DeploymentIdentity[];
  readonly discardedBlocks: DiscardedBlock[];
  readonly executions: BenchmarkExecution[];
  readonly experimentId: string;
  readonly failedAttempts: FailedAttempt[];
  readonly fixture: {
    readonly agentConfigSha256: string;
    readonly agentId: string;
    readonly appId: string;
    readonly baseURL: string;
    readonly model: string;
    readonly providerId: string;
    readonly runtimeId: string;
  };
  readonly fixtureB: {
    readonly agentConfigSha256: string;
    readonly agentId: string;
    readonly appId: string;
    readonly baseURL: string;
    readonly model: string;
    readonly providerId: string;
    readonly runtimeId: string;
  };
  readonly method: {
    readonly budget: BenchmarkBudget;
    readonly coldDefinition: string;
    readonly gate: string;
    readonly harnessRevision: string;
    readonly journey: "one-shot" | "two-stage";
    readonly leadMs: number;
    readonly leadToleranceMs: number;
    readonly ordering: string;
    readonly primaryEndpoint: string;
    readonly seed: string;
    readonly sourceRegion: string;
    readonly timeoutMs: number;
    readonly traceEvidence: string;
    readonly totalBlocks: number;
    readonly totalPairs: number;
  };
  pendingAttempt: PendingAttempt | null;
  pendingDeployment: PendingDeployment | null;
  runs: ExperimentRun[];
  readonly schemaVersion: typeof SCHEMA_VERSION;
  summary: ColdStartExperimentSummary;
  updatedAt: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";

  if (value.length === 0) {
    throw new Error(`Cold-start benchmark requires ${name}.`);
  }

  return value;
}

interface StackHookEnvironment {
  readonly MOSOO_PERF_BASE_URL: string;
  readonly MOSOO_PERF_CF_ENV: string;
  readonly MOSOO_PERF_CONTAINER_APPLICATION_NAME: string;
  readonly MOSOO_PERF_D1_DATABASE_ID: string;
  readonly MOSOO_PERF_RESOURCE_PREFIX: string;
  readonly MOSOO_PERF_WORKER_NAME: string;
  readonly MOSOO_PERF_WRANGLER_TEMPLATE: string;
}

export function stackHookEnvironment(
  stack: BenchmarkStack,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): StackHookEnvironment {
  const prefix = `MOSOO_PERF_${stack.toUpperCase()}_`;
  const read = (suffix: string) => {
    const value = environment[`${prefix}${suffix}`]?.trim() ?? "";
    if (value.length === 0) {
      throw new Error(`Cold-start benchmark requires ${prefix}${suffix}.`);
    }
    return value;
  };

  return {
    MOSOO_PERF_BASE_URL: read("BASE_URL"),
    MOSOO_PERF_CF_ENV: read("CF_ENV"),
    MOSOO_PERF_CONTAINER_APPLICATION_NAME: read("CONTAINER_APPLICATION_NAME"),
    MOSOO_PERF_D1_DATABASE_ID: read("D1_DATABASE_ID"),
    MOSOO_PERF_RESOURCE_PREFIX: read("RESOURCE_PREFIX"),
    MOSOO_PERF_WRANGLER_TEMPLATE: read("WRANGLER_TEMPLATE"),
    MOSOO_PERF_WORKER_NAME: read("WORKER_NAME"),
  };
}

export function assertDistinctStackHookEnvironments(
  a: StackHookEnvironment,
  b: StackHookEnvironment,
): void {
  const fields = [
    "MOSOO_PERF_BASE_URL",
    "MOSOO_PERF_CF_ENV",
    "MOSOO_PERF_CONTAINER_APPLICATION_NAME",
    "MOSOO_PERF_D1_DATABASE_ID",
    "MOSOO_PERF_RESOURCE_PREFIX",
    "MOSOO_PERF_WORKER_NAME",
  ] as const;
  const shared = fields.filter((field) => a[field] === b[field]);
  if (shared.length > 0) {
    throw new Error(`Performance stacks share isolated infrastructure: ${shared.join(", ")}.`);
  }

  const aPrefix = a.MOSOO_PERF_RESOURCE_PREFIX;
  const bPrefix = b.MOSOO_PERF_RESOURCE_PREFIX;
  if (aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix)) {
    throw new Error("Performance stack resource prefixes overlap.");
  }
}

export function assertEquivalentRuntimeFixtures(
  a: RuntimeBenchmarkFixture,
  b: RuntimeBenchmarkFixture,
): void {
  const fields = ["agentConfigSha256", "model", "providerId", "runtimeId"] as const;
  const mismatched = fields.filter((field) => a[field] !== b[field]);
  if (mismatched.length > 0) {
    throw new Error(`Performance fixtures use different workloads: ${mismatched.join(", ")}.`);
  }
}

export function httpWorkerIdentityMatches(
  journey: BenchmarkJourney,
  expectedWorkerVersion: string,
  observation: {
    readonly workerVersionCreate: string | null;
    readonly workerVersionSend: string | null;
    readonly workerVersionStream: string | null;
  },
): boolean {
  return (
    observation.workerVersionCreate === expectedWorkerVersion &&
    observation.workerVersionStream === expectedWorkerVersion &&
    (journey === "one-shot" || observation.workerVersionSend === expectedWorkerVersion)
  );
}

function readInteger(name: string, fallback: number): number {
  const configured = process.env[name]?.trim() ?? "";

  if (configured.length === 0) {
    return fallback;
  }

  const value = Number(configured);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }

  return value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = readInteger(name, fallback);
  if (value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function updateFramedHash(hash: ReturnType<typeof createHash>, label: string, content: Uint8Array) {
  hash.update(label).update("\0").update(String(content.byteLength)).update("\0").update(content);
}

export async function computeHarnessRevision(hookPath: string): Promise<string> {
  const hash = createHash("sha256");
  const files = [
    ["cold-start-ab.ts", resolve(import.meta.dir, "cold-start-ab.ts")],
    ["perf-stage-hook.ts", resolve(hookPath)],
    ["env.ts", resolve(import.meta.dir, "../env.ts")],
    ["cold-start-benchmark.ts", resolve(import.meta.dir, "../lib/cold-start-benchmark.ts")],
    ["cold-start-experiment.ts", resolve(import.meta.dir, "../lib/cold-start-experiment.ts")],
    ["perf-stage-control.ts", resolve(import.meta.dir, "../lib/perf-stage-control.ts")],
  ] as const;

  updateFramedHash(hash, "version", Buffer.from(HARNESS_REVISION_VERSION));
  updateFramedHash(hash, "bun-revision", Buffer.from(Bun.revision));
  for (const [label, path] of files) {
    updateFramedHash(hash, label, await readFile(path));
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function assertHarnessRevision(
  hookPath: string,
  expectedHarnessRevision: string,
): Promise<void> {
  const currentHarnessRevision = await computeHarnessRevision(hookPath);
  if (currentHarnessRevision !== expectedHarnessRevision) {
    throw new Error(
      `Performance harness changed during execution: expected=${expectedHarnessRevision} actual=${currentHarnessRevision}.`,
    );
  }
}

async function assertPinnedHarnessRevision(harnessRevision: string): Promise<void> {
  const configuredRevision = process.env["MOSOO_PERF_EXPECTED_HARNESS_REVISION"]?.trim();
  const pinPath = resolve(import.meta.dir, "../../PERF_HARNESS_REVISION");
  let pinnedRevision: string | undefined;

  try {
    pinnedRevision = (await readFile(pinPath, "utf8")).trim();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  for (const expected of [configuredRevision, pinnedRevision]) {
    if (expected !== undefined && expected.length > 0 && expected !== harnessRevision) {
      throw new Error(
        `Performance harness does not match its frozen revision: expected=${expected} actual=${harnessRevision}.`,
      );
    }
  }
}

export function assertDeploymentTreatmentStable(
  deployments: readonly DeploymentIdentity[],
  candidate: DeploymentIdentity,
): void {
  const first = deployments.find((deployment) => deployment.variant === candidate.variant);
  if (first !== undefined) {
    const driftFields = deploymentTreatmentDriftFields(first, candidate);
    if (driftFields.length > 0) {
      throw new Error(
        `Deployment treatment drifted for variant ${candidate.variant}: ${driftFields.join(", ")}.`,
      );
    }
  }
  const sameStack = deployments.find((deployment) => deployment.stack === candidate.stack);
  if (sameStack !== undefined && sameStack.physicalStackId !== candidate.physicalStackId) {
    throw new Error(`Physical stack ${candidate.stack} changed during crossover.`);
  }
  if (sameStack !== undefined && sameStack.stackConfigSha256 !== candidate.stackConfigSha256) {
    throw new Error(
      `Wrangler configuration for stack ${candidate.stack} changed during crossover.`,
    );
  }
  if (
    deployments.some(
      (deployment) =>
        deployment.stack !== candidate.stack &&
        deployment.physicalStackId === candidate.physicalStackId,
    )
  ) {
    throw new Error("Crossover stack labels resolved to the same physical stack.");
  }
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Performance hook result requires ${field}.`);
  }

  return value.trim();
}

function requireRecord(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = record[field];

  if (!isRecord(value)) {
    throw new Error(`Benchmark document requires object ${field}.`);
  }

  return value;
}

function requireBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw new Error(`Performance hook result requires boolean ${field}.`);
  }

  return value;
}

function requireNonNegativeInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];

  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Performance hook result requires non-negative integer ${field}.`);
  }

  return value as number;
}

function requireNonNegativeNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Performance hook result requires non-negative number ${field}.`);
  }

  return value;
}

function requirePhase(record: Record<string, unknown>, field: string): CrossoverPhase {
  const value = requireNonNegativeInteger(record, field);
  if (value !== 1 && value !== 2) {
    throw new Error(`Performance hook result requires crossover phase ${field}.`);
  }
  return value;
}

function requireNullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];

  if (value === null) {
    return null;
  }

  return requireString(record, field);
}

function requireEnum<const T extends string>(
  record: Record<string, unknown>,
  field: string,
  values: readonly T[],
): T {
  const value = requireString(record, field);

  if (!values.includes(value as T)) {
    throw new Error(`Performance hook result contains unsupported ${field}.`);
  }

  return value as T;
}

function parseAttemptError(value: unknown, label: string): AttemptError | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error(`Benchmark document contains invalid ${label}.`);
  }

  return {
    at: requireString(value, "at"),
    message: requireString(value, "message"),
    name: requireString(value, "name"),
    stage: requireEnum(value, "stage", [
      "cleanup",
      "delete_thread",
      "execution_interrupted",
      "identity",
      "sample",
      "trace",
    ] as const),
  };
}

function parsePendingCleanup(value: unknown): PendingCleanupState {
  if (!isRecord(value)) {
    throw new Error("Benchmark document contains invalid pending cleanup state.");
  }

  return {
    containerGone: requireBoolean(value, "containerGone"),
    threadDeleted: requireBoolean(value, "threadDeleted"),
    verifiedAt: requireNullableString(value, "verifiedAt"),
  };
}

function parsePendingAttempt(value: unknown): PendingAttempt | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Benchmark document contains an invalid pending attempt.");
  }

  const position = requireNonNegativeInteger(value, "position");
  const sequence = requireNonNegativeInteger(value, "sequence");
  if (![1, 2, 3, 4].includes(position) || ![1, 2].includes(sequence)) {
    throw new Error("Benchmark document contains an invalid pending attempt plan.");
  }

  const stage = requireEnum(value, "stage", [
    "cleaned",
    "identified",
    "prepared",
    "sampled",
    "traced",
  ] as const);
  const sampleValue = value["sample"];
  const identityValue = value["identity"];
  const traceValue = value["trace"];
  const sample = sampleValue === null ? null : (sampleValue as ColdStartRunResult);
  const identity = identityValue === null ? null : parseIdentity(identityValue);
  const trace = traceValue === null ? null : parseStoredTrace(traceValue);
  const cleanup = parsePendingCleanup(value["cleanup"]);
  const stageRank = ["prepared", "sampled", "identified", "traced", "cleaned"].indexOf(stage);

  if (
    (sample !== null) !== stageRank >= 1 ||
    (identity !== null) !== stageRank >= 2 ||
    (trace !== null) !== stageRank >= 3 ||
    cleanup.containerGone !== (stage === "cleaned") ||
    (cleanup.verifiedAt !== null) !== (stage === "cleaned") ||
    (stage === "cleaned" && !cleanup.threadDeleted) ||
    (cleanup.threadDeleted && stageRank < 3)
  ) {
    throw new Error("Benchmark document pending attempt fields do not match its stage.");
  }
  if (sample !== null && !isRecord(sampleValue)) {
    throw new Error("Benchmark document contains an invalid pending sample.");
  }

  return {
    attemptStartedAt: requireString(value, "attemptStartedAt"),
    block: requireNonNegativeInteger(value, "block"),
    blockOrder: requireEnum(value, "blockOrder", ["abba", "baab"] as const),
    journey: requireEnum(value, "journey", ["one-shot", "two-stage"] as const),
    cleanup,
    cleanupError: parseAttemptError(value["cleanupError"], "pending cleanup error"),
    deploymentOrdinal: requireNonNegativeInteger(value, "deploymentOrdinal"),
    executionOrdinal: requireNonNegativeInteger(value, "executionOrdinal"),
    identity,
    nonce: requireString(value, "nonce"),
    pair: requireNonNegativeInteger(value, "pair"),
    pairOrder: requireEnum(value, "pairOrder", ["ab", "ba"] as const),
    phase: requirePhase(value, "phase"),
    position: position as 1 | 2 | 3 | 4,
    primaryError: parseAttemptError(value["primaryError"], "pending primary error"),
    sample,
    sequence: sequence as 1 | 2,
    stack: requireEnum(value, "stack", ["a", "b"] as const),
    stage,
    trace,
    updatedAt: requireString(value, "updatedAt"),
    variant: requireEnum(value, "variant", ["after", "before"] as const),
  };
}

function parsePendingDeployment(value: unknown): PendingDeployment | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Benchmark document contains an invalid pending deployment.");
  }
  return {
    ordinal: requireNonNegativeInteger(value, "ordinal"),
    phase: requirePhase(value, "phase"),
    stack: requireEnum(value, "stack", ["a", "b"] as const),
    startedAt: requireString(value, "startedAt"),
    variant: requireEnum(value, "variant", ["after", "before"] as const),
  };
}

function parseFailedAttempt(value: unknown): FailedAttempt {
  const attempt = parsePendingAttempt(value);
  if (
    attempt === null ||
    attempt.stage !== "cleaned" ||
    attempt.sample === null ||
    attempt.primaryError === null ||
    attempt.cleanup.verifiedAt === null
  ) {
    throw new Error("Benchmark document contains an invalid failed attempt.");
  }

  return {
    ...attempt,
    cleanup: {
      containerGone: attempt.cleanup.containerGone,
      threadDeleted: attempt.cleanup.threadDeleted,
      verifiedAt: attempt.cleanup.verifiedAt,
    },
    failedAt: requireString(value as Record<string, unknown>, "failedAt"),
    primaryError: attempt.primaryError,
    sample: attempt.sample,
    stage: "cleaned",
  };
}

async function readFixture(path: string): Promise<RuntimeBenchmarkFixture> {
  const payload: unknown = JSON.parse(await readFile(resolve(path), "utf8"));
  return parseRuntimeBenchmarkFixture(payload);
}

async function ensureCloudflareApiToken(): Promise<void> {
  if ((process.env["CLOUDFLARE_API_TOKEN"]?.trim() ?? "").length > 0) {
    return;
  }

  const afterRoot = resolve(requireEnv("MOSOO_PERF_AFTER_ROOT"));
  const child = Bun.spawn(["bunx", "wrangler", "auth", "token", "--json"], {
    cwd: resolve(afterRoot, "apps/api"),
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`Could not resolve Cloudflare auth: ${stderr.trim().slice(-2_000)}`);
  }

  const payload: unknown = JSON.parse(stdout);
  const token =
    isRecord(payload) && typeof payload["token"] === "string" ? payload["token"].trim() : "";

  if (token.length === 0) {
    throw new Error("Wrangler auth did not return a Cloudflare API token.");
  }

  process.env["CLOUDFLARE_API_TOKEN"] = token;
}

export function parseExistingDocument(
  value: unknown,
  experimentId: string,
  harnessRevision: string,
): BenchmarkDocument {
  if (!isRecord(value)) {
    throw new Error("Existing benchmark output is not an object.");
  }
  if (value["schemaVersion"] === "mosoo.cold-start-ab.v5") {
    throw new Error("v5 did not bind harness/provenance; start a new v7 output.");
  }
  if (value["schemaVersion"] === "mosoo.cold-start-ab.v6") {
    throw new Error("v6 did not journal interrupted attempts; start a new v7 output.");
  }
  if (value["schemaVersion"] === "mosoo.cold-start-ab.v7") {
    throw new Error("v7 did not bind the dual-stack crossover; start a new v8 output.");
  }
  if (value["schemaVersion"] === "mosoo.cold-start-ab.v8") {
    throw new Error("v8 did not journal Container rollouts; start a new v9 output.");
  }
  if (value["schemaVersion"] === "mosoo.cold-start-ab.v9") {
    throw new Error(
      "v9 conflated trace completeness with prewarm deadline hits; start a new v10 output.",
    );
  }
  if (value["schemaVersion"] === "mosoo.cold-start-ab.v10") {
    throw new Error(
      "v10 treated earlier streaming as a completion-tail regression; start a new v11 output.",
    );
  }
  if (value["schemaVersion"] === "mosoo.cold-start-ab.v11") {
    throw new Error(
      "v11 lacked fixed trace settlement and legacy one-shot Run acceptance fallback; start a new v12 output.",
    );
  }
  if (value["schemaVersion"] !== SCHEMA_VERSION || value["experimentId"] !== experimentId) {
    throw new Error("Existing benchmark output is incompatible with this experiment.");
  }
  if (
    !Array.isArray(value["runs"]) ||
    !Array.isArray(value["deployments"]) ||
    !Array.isArray(value["discardedBlocks"]) ||
    !Array.isArray(value["executions"]) ||
    !Array.isArray(value["failedAttempts"])
  ) {
    throw new Error("Existing benchmark output has incomplete collections.");
  }

  const method = requireRecord(value, "method");
  if (requireString(method, "harnessRevision") !== harnessRevision) {
    throw new Error("Existing benchmark output was created by a different harness revision.");
  }
  const parsedMethod = {
    budget: (() => {
      const budget = requireRecord(method, "budget");
      return {
        maxAttemptedRuns: requireNonNegativeInteger(budget, "maxAttemptedRuns"),
        maxFailedAttempts: requireNonNegativeInteger(budget, "maxFailedAttempts"),
        maxUsageTotalTokens: requireNonNegativeInteger(budget, "maxUsageTotalTokens"),
        maxWallClockMs: requireNonNegativeInteger(budget, "maxWallClockMs"),
      };
    })(),
    coldDefinition: requireString(method, "coldDefinition"),
    gate: requireString(method, "gate"),
    harnessRevision,
    journey: requireEnum(method, "journey", ["one-shot", "two-stage"] as const),
    leadMs: requireNonNegativeInteger(method, "leadMs"),
    leadToleranceMs: requireNonNegativeInteger(method, "leadToleranceMs"),
    ordering: requireString(method, "ordering"),
    primaryEndpoint: requireString(method, "primaryEndpoint"),
    seed: requireString(method, "seed"),
    sourceRegion: requireString(method, "sourceRegion"),
    timeoutMs: requireNonNegativeInteger(method, "timeoutMs"),
    traceEvidence: requireString(method, "traceEvidence"),
    totalBlocks: requireNonNegativeInteger(method, "totalBlocks"),
    totalPairs: requireNonNegativeInteger(method, "totalPairs"),
  };
  if (parsedMethod.totalPairs !== parsedMethod.totalBlocks * 2) {
    throw new Error("Existing benchmark method has inconsistent block and pair counts.");
  }
  const fixture = requireRecord(value, "fixture");
  const parsedFixture = {
    agentConfigSha256: requireString(fixture, "agentConfigSha256"),
    agentId: requireString(fixture, "agentId"),
    appId: requireString(fixture, "appId"),
    baseURL: requireString(fixture, "baseURL"),
    model: requireString(fixture, "model"),
    providerId: requireString(fixture, "providerId"),
    runtimeId: requireString(fixture, "runtimeId"),
  };
  const fixtureB = requireRecord(value, "fixtureB");
  const parsedFixtureB = {
    agentConfigSha256: requireString(fixtureB, "agentConfigSha256"),
    agentId: requireString(fixtureB, "agentId"),
    appId: requireString(fixtureB, "appId"),
    baseURL: requireString(fixtureB, "baseURL"),
    model: requireString(fixtureB, "model"),
    providerId: requireString(fixtureB, "providerId"),
    runtimeId: requireString(fixtureB, "runtimeId"),
  };
  const deploymentOrdinals = new Set<number>();
  const deployments = value["deployments"].map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error("Existing benchmark contains invalid deployment provenance.");
    }
    const variant = requireEnum(entry, "variant", ["after", "before"] as const);
    const deployment = parseDeployment(entry, {
      ordinal: index + 1,
      phase: requirePhase(entry, "phase"),
      stack: requireEnum(entry, "stack", ["a", "b"] as const),
      variant,
    });
    if (deploymentOrdinals.has(deployment.ordinal)) {
      throw new Error(
        `Existing benchmark contains duplicate deployment ordinal ${deployment.ordinal}.`,
      );
    }
    deploymentOrdinals.add(deployment.ordinal);
    return deployment;
  });
  const executionOrdinals = new Set<number>();
  const executions = value["executions"].map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error("Existing benchmark contains an invalid execution.");
    }
    const ordinal = requireNonNegativeInteger(entry, "ordinal");
    if (ordinal !== index + 1 || executionOrdinals.has(ordinal)) {
      throw new Error(`Existing benchmark contains invalid execution ordinal ${ordinal}.`);
    }
    executionOrdinals.add(ordinal);
    const executionHarnessRevision = requireString(entry, "harnessRevision");
    if (executionHarnessRevision !== harnessRevision) {
      throw new Error(`Existing benchmark execution ${ordinal} used a different harness revision.`);
    }
    const blockCount = requireNonNegativeInteger(entry, "blockCount");
    const blockStart = requireNonNegativeInteger(entry, "blockStart");
    if (blockCount < 1 || blockStart + blockCount > parsedMethod.totalBlocks) {
      throw new Error(`Existing benchmark execution ${ordinal} has an invalid block slice.`);
    }
    return {
      blockCount,
      blockStart,
      harnessRevision: executionHarnessRevision,
      ordinal,
      startedAt: requireString(entry, "startedAt"),
    };
  });
  const pendingAttempt = parsePendingAttempt(value["pendingAttempt"]);
  const pendingDeployment = parsePendingDeployment(value["pendingDeployment"]);
  const failedAttempts = value["failedAttempts"].map(parseFailedAttempt);

  return {
    ...(value as unknown as BenchmarkDocument),
    deployments,
    executions,
    failedAttempts,
    fixture: parsedFixture,
    fixtureB: parsedFixtureB,
    method: parsedMethod,
    pendingAttempt,
    pendingDeployment,
  };
}

async function writeDocument(outputPath: string, document: BenchmarkDocument): Promise<void> {
  const absolutePath = resolve(outputPath);
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`;

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, absolutePath);
  await chmod(absolutePath, 0o600);
}

function createDocument(input: {
  readonly budget: BenchmarkBudget;
  readonly experimentId: string;
  readonly fixture: RuntimeBenchmarkFixture;
  readonly fixtureB: RuntimeBenchmarkFixture;
  readonly harnessRevision: string;
  readonly journey: "one-shot" | "two-stage";
  readonly leadMs: number;
  readonly seed: string;
  readonly sourceRegion: string;
  readonly timeoutMs: number;
  readonly totalBlocks: number;
}): BenchmarkDocument {
  const now = new Date().toISOString();
  const runs: ExperimentRun[] = [];
  const deployments: DeploymentIdentity[] = [];

  return {
    createdAt: now,
    deployments,
    discardedBlocks: [],
    executions: [],
    experimentId: input.experimentId,
    failedAttempts: [],
    fixture: {
      agentConfigSha256: input.fixture.agentConfigSha256,
      agentId: input.fixture.agentId,
      appId: input.fixture.appId,
      baseURL: input.fixture.baseURL,
      model: input.fixture.model,
      providerId: input.fixture.providerId,
      runtimeId: input.fixture.runtimeId,
    },
    fixtureB: {
      agentConfigSha256: input.fixtureB.agentConfigSha256,
      agentId: input.fixtureB.agentId,
      appId: input.fixtureB.appId,
      baseURL: input.fixtureB.baseURL,
      model: input.fixtureB.model,
      providerId: input.fixtureB.providerId,
      runtimeId: input.fixtureB.runtimeId,
    },
    method: {
      budget: input.budget,
      coldDefinition:
        "Every run creates a novel cattle Thread, Sandbox, Driver, and Container identity; managed-registry image-cache misses are not asserted.",
      gate: "Retain only with >=30 successful intent-to-treat pairs (including prewarm misses), complete prewarm outcome evidence, >=95% same-clock prewarm deadline hits, paired Send/request-to-first-text median improvement >=20%, after median <=10s, negative paired TTFT median in both crossover phases, block-cluster bootstrap 95% CI below zero, bounded lead where applicable, >=95% measurable after-stream coverage, TTFT/cadence/total-completion p95 not worse, paired total-completion median not worse in either crossover phase, exactly four journaled equal-resource rollouts, exact output, identity, trace, and cleanup for every run.",
      harnessRevision: input.harnessRevision,
      journey: input.journey,
      leadMs: input.leadMs,
      leadToleranceMs: COLD_START_LEAD_TOLERANCE_MS,
      ordering: `Two fixed physical staging stacks; two eight-block crossover phases with A=before/B=after then A=after/B=before, yielding ${input.totalBlocks * 2} adjacent AB/BA pairs from four total rollouts.`,
      primaryEndpoint:
        input.journey === "two-stage"
          ? "Two-stage Send request to first non-empty assistant text over preconnected SSE; intent-to-first-text is the anti-hiding secondary metric."
          : "One-shot create-with-input request to first non-empty assistant text over SSE.",
      seed: input.seed,
      sourceRegion: input.sourceRegion,
      timeoutMs: input.timeoutMs,
      traceEvidence: TRACE_EVIDENCE_METHOD,
      totalBlocks: input.totalBlocks,
      totalPairs: input.totalBlocks * 2,
    },
    pendingAttempt: null,
    pendingDeployment: null,
    runs,
    schemaVersion: SCHEMA_VERSION,
    summary: summarizeColdStartExperiment({
      deployments,
      discardedBlocks: 0,
      failedAttempts: 0,
      journey: input.journey,
      pendingAttempt: false,
      pendingDeployment: false,
      leadMs: input.leadMs,
      leadToleranceMs: COLD_START_LEAD_TOLERANCE_MS,
      runs,
      seed: input.seed,
      totalBlocks: input.totalBlocks,
    }),
    updatedAt: now,
  };
}

async function loadDocument(input: {
  readonly budget: BenchmarkBudget;
  readonly experimentId: string;
  readonly fixture: RuntimeBenchmarkFixture;
  readonly fixtureB: RuntimeBenchmarkFixture;
  readonly harnessRevision: string;
  readonly journey: "one-shot" | "two-stage";
  readonly leadMs: number;
  readonly outputPath: string;
  readonly seed: string;
  readonly sourceRegion: string;
  readonly timeoutMs: number;
  readonly totalBlocks: number;
}): Promise<BenchmarkDocument> {
  try {
    const payload: unknown = JSON.parse(await readFile(resolve(input.outputPath), "utf8"));
    const existing = parseExistingDocument(payload, input.experimentId, input.harnessRevision);

    if (
      existing.method.seed !== input.seed ||
      existing.method.budget.maxAttemptedRuns !== input.budget.maxAttemptedRuns ||
      existing.method.budget.maxFailedAttempts !== input.budget.maxFailedAttempts ||
      existing.method.budget.maxUsageTotalTokens !== input.budget.maxUsageTotalTokens ||
      existing.method.budget.maxWallClockMs !== input.budget.maxWallClockMs ||
      existing.method.timeoutMs !== input.timeoutMs ||
      existing.method.traceEvidence !== TRACE_EVIDENCE_METHOD ||
      existing.method.totalBlocks !== input.totalBlocks ||
      existing.method.leadMs !== input.leadMs ||
      existing.method.leadToleranceMs !== COLD_START_LEAD_TOLERANCE_MS ||
      existing.method.journey !== input.journey ||
      existing.fixture.baseURL !== input.fixture.baseURL ||
      existing.fixture.agentConfigSha256 !== input.fixture.agentConfigSha256 ||
      existing.fixture.agentId !== input.fixture.agentId ||
      existing.fixture.appId !== input.fixture.appId ||
      existing.fixture.model !== input.fixture.model ||
      existing.fixture.providerId !== input.fixture.providerId ||
      existing.fixture.runtimeId !== input.fixture.runtimeId ||
      existing.fixtureB.baseURL !== input.fixtureB.baseURL ||
      existing.fixtureB.agentConfigSha256 !== input.fixtureB.agentConfigSha256 ||
      existing.fixtureB.agentId !== input.fixtureB.agentId ||
      existing.fixtureB.appId !== input.fixtureB.appId ||
      existing.fixtureB.model !== input.fixtureB.model ||
      existing.fixtureB.providerId !== input.fixtureB.providerId ||
      existing.fixtureB.runtimeId !== input.fixtureB.runtimeId ||
      existing.method.sourceRegion !== input.sourceRegion
    ) {
      throw new Error("Existing benchmark output uses a different method or fixture.");
    }

    return existing;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createDocument(input);
    }

    throw error;
  }
}

function documentSamples(document: BenchmarkDocument): ColdStartRunResult[] {
  return [
    ...document.runs.map((run) => run.sample),
    ...document.discardedBlocks.flatMap((block) => block.runs.map((run) => run.sample)),
    ...document.failedAttempts.map((attempt) => attempt.sample),
    ...(document.pendingAttempt?.sample === null || document.pendingAttempt === null
      ? []
      : [document.pendingAttempt.sample]),
  ];
}

export function benchmarkBudgetUsage(
  document: BenchmarkDocument,
  nowMs = Date.now(),
): BenchmarkBudgetUsage {
  const samples = documentSamples(document);
  const createdAtMs = Date.parse(document.createdAt);

  return {
    attemptedRuns: samples.length,
    elapsedMs: Number.isFinite(createdAtMs) ? Math.max(0, nowMs - createdAtMs) : Infinity,
    failedAttempts: document.failedAttempts.length,
    usageTotalTokens: samples.reduce(
      (total, sample) => total + (sample.metrics.usageTotalTokens ?? 0),
      0,
    ),
  };
}

export function assertBenchmarkBudget(
  document: BenchmarkDocument,
  options: { readonly nowMs?: number; readonly reserveRun?: boolean } = {},
): BenchmarkBudgetUsage {
  const usage = benchmarkBudgetUsage(document, options.nowMs);
  const budget = document.method.budget;

  if (usage.elapsedMs > budget.maxWallClockMs) {
    throw new Error("Cold-start experiment exhausted its wall-clock budget.");
  }
  if (usage.failedAttempts > budget.maxFailedAttempts) {
    throw new Error("Cold-start experiment exhausted its failed-attempt budget.");
  }
  if (usage.usageTotalTokens > budget.maxUsageTotalTokens) {
    throw new Error("Cold-start experiment exhausted its provider-token budget.");
  }
  if (usage.attemptedRuns + (options.reserveRun === true ? 1 : 0) > budget.maxAttemptedRuns) {
    throw new Error("Cold-start experiment exhausted its remote-run budget.");
  }

  return usage;
}

export function validateRecordedRuns(
  document: BenchmarkDocument,
  blocks: readonly ReturnType<typeof createInterleavedBlockPlans>[number][],
  experimentId: string,
  seed: string,
): void {
  const expected = new Map<string, InterleavedRunPlan>(
    blocks.flatMap((block) =>
      block.runs.map((plan) => [`${plan.block}:${plan.position}`, plan] as const),
    ),
  );
  const seen = new Set<string>();
  const executionAttempts = new Set<string>();
  const executions = new Map(
    document.executions.map((execution) => [execution.ordinal, execution] as const),
  );
  const deployments = new Map(
    document.deployments.map((deployment) => [deployment.ordinal, deployment] as const),
  );

  if (deployments.size !== document.deployments.length) {
    throw new Error("Existing benchmark contains duplicate deployment ordinals.");
  }

  function validatePlannedAttempt(
    attempt: ExperimentRun | FailedAttempt | PendingAttempt,
    label: string,
  ): void {
    const key = runKey(attempt);
    const plan = expected.get(key);
    const execution = executions.get(attempt.executionOrdinal);
    const deployment = deployments.get(attempt.deploymentOrdinal);

    if (
      plan === undefined ||
      execution === undefined ||
      attempt.block < execution.blockStart + 1 ||
      attempt.block > execution.blockStart + execution.blockCount
    ) {
      throw new Error(`Existing benchmark contains an invalid ${label} ${key}.`);
    }

    if (
      attempt.blockOrder !== plan.blockOrder ||
      attempt.journey !== plan.journey ||
      attempt.pair !== plan.pair ||
      attempt.pairOrder !== plan.pairOrder ||
      attempt.phase !== plan.phase ||
      attempt.sequence !== plan.sequence ||
      attempt.stack !== plan.stack ||
      attempt.variant !== plan.variant ||
      attempt.nonce !== createPairNonce(experimentId, seed, plan.pair, attempt.executionOrdinal) ||
      deployment?.phase !== plan.phase ||
      deployment.stack !== plan.stack ||
      deployment.variant !== plan.variant
    ) {
      throw new Error(`Existing benchmark ${label} ${key} does not match the deterministic plan.`);
    }
    if (
      attempt.sample !== null &&
      (attempt.sample.nonce !== attempt.nonce ||
        attempt.sample.journey !== plan.journey ||
        attempt.sample.crossoverPhase !== plan.phase ||
        attempt.sample.pair !== plan.pair ||
        attempt.sample.phase !== plan.phase ||
        attempt.sample.sequence !== plan.sequence ||
        attempt.sample.stack !== plan.stack ||
        attempt.sample.variant !== plan.variant)
    ) {
      throw new Error(`Existing benchmark ${label} ${key} has a mismatched sample.`);
    }
  }

  for (const run of document.runs) {
    const key = runKey(run);
    if (seen.has(key)) {
      throw new Error(`Existing benchmark contains an unknown or duplicate run ${key}.`);
    }
    seen.add(key);
    validatePlannedAttempt(run, "run");
  }

  for (const attempt of document.failedAttempts) {
    const key = `${attempt.executionOrdinal}:${runKey(attempt)}`;
    if (executionAttempts.has(key)) {
      throw new Error(`Existing benchmark contains duplicate failed attempt ${key}.`);
    }
    executionAttempts.add(key);
    validatePlannedAttempt(attempt, "failed attempt");
  }

  if (document.pendingAttempt !== null) {
    const key = `${document.pendingAttempt.executionOrdinal}:${runKey(document.pendingAttempt)}`;
    if (executionAttempts.has(key)) {
      throw new Error(`Existing benchmark pending attempt duplicates attempt ${key}.`);
    }
    validatePlannedAttempt(document.pendingAttempt, "pending attempt");
  }
}

export function discardPartialBlocks(document: BenchmarkDocument): boolean {
  const byBlock = new Map<number, ExperimentRun[]>();

  for (const run of document.runs) {
    const entries = byBlock.get(run.block) ?? [];
    entries.push(run);
    byBlock.set(run.block, entries);
  }

  const partialBlocks = new Set(
    [...byBlock.entries()]
      .filter(([, runs]) => runs.length > 0 && runs.length < 4)
      .map(([block]) => block),
  );

  if (partialBlocks.size === 0) {
    return false;
  }

  for (const block of [...partialBlocks].toSorted((left, right) => left - right)) {
    document.discardedBlocks.push({
      block,
      discardedAt: new Date().toISOString(),
      reason: "Execution stopped before the balanced four-run block completed.",
      runs: byBlock.get(block) ?? [],
    });
  }

  document.runs = document.runs.filter((run) => !partialBlocks.has(run.block));
  return true;
}

async function runHook(
  hookPath: string,
  harnessRevision: string,
  stack: BenchmarkStack,
  action: "cleanup" | "deploy" | "identity" | "trace",
  input: Record<string, unknown>,
): Promise<unknown> {
  await assertHarnessRevision(hookPath, harnessRevision);
  const child = Bun.spawn(
    [process.execPath, hookPath, action, JSON.stringify({ ...input, harnessRevision })],
    {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...process.env, ...stackHookEnvironment(stack) },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const logLines = stdout
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith(HOOK_RESULT_PREFIX));

  for (const line of logLines) {
    console.log(`[perf-hook:${action}] ${line}`);
  }

  if (exitCode !== 0) {
    throw new Error(
      `Performance hook ${action} exited ${exitCode}: ${stderr.trim().slice(-4_000)}`,
    );
  }

  const resultLine = stdout.split(/\r?\n/u).findLast((line) => line.startsWith(HOOK_RESULT_PREFIX));

  if (resultLine === undefined) {
    throw new Error(`Performance hook ${action} did not emit ${HOOK_RESULT_PREFIX}.`);
  }

  const result: unknown = JSON.parse(resultLine.slice(HOOK_RESULT_PREFIX.length));
  if (!isRecord(result) || requireString(result, "harnessRevision") !== harnessRevision) {
    throw new Error(`Performance hook ${action} did not confirm the harness revision.`);
  }
  return result;
}

function parseDeployment(
  value: unknown,
  expected: {
    readonly ordinal: number;
    readonly phase: CrossoverPhase;
    readonly stack: BenchmarkStack;
    readonly variant: BenchmarkVariant;
  },
): DeploymentIdentity {
  if (!isRecord(value)) {
    throw new Error("Deploy hook returned a non-object result.");
  }

  const variant = requireString(value, "variant");
  const ordinal = requireNonNegativeInteger(value, "ordinal");
  const phase = requirePhase(value, "phase");
  const stack = requireEnum(value, "stack", ["a", "b"] as const);

  if (
    variant !== expected.variant ||
    ordinal !== expected.ordinal ||
    phase !== expected.phase ||
    stack !== expected.stack
  ) {
    throw new Error("Deploy hook returned the wrong stack, phase, variant, or ordinal.");
  }

  return {
    containerApplicationId: requireString(value, "containerApplicationId"),
    containerApplicationVersion: requireString(value, "containerApplicationVersion"),
    containerDiskMb: requireNonNegativeNumber(value, "containerDiskMb"),
    containerInstanceType: requireString(value, "containerInstanceType"),
    containerMaxInstances: requireNonNegativeInteger(value, "containerMaxInstances"),
    containerMemoryMib: requireNonNegativeNumber(value, "containerMemoryMib"),
    containerVcpu: requireNonNegativeNumber(value, "containerVcpu"),
    deployedAt: requireString(value, "deployedAt"),
    driverBundleSha256: requireString(value, "driverBundleSha256"),
    imageDigest: requireString(value, "imageDigest"),
    imageGzipProxyBytes: requireNonNegativeInteger(value, "imageGzipProxyBytes"),
    imageUncompressedBytes: requireNonNegativeInteger(value, "imageUncompressedBytes"),
    ordinal,
    physicalStackId: requireString(value, "physicalStackId"),
    phase,
    readyAt: requireString(value, "readyAt"),
    sourceRevision: requireString(value, "sourceRevision"),
    stack,
    stackConfigSha256: requireString(value, "stackConfigSha256"),
    treatmentConfigSha256: requireString(value, "treatmentConfigSha256"),
    variant: expected.variant,
    workerBundleSha256: requireString(value, "workerBundleSha256"),
    workerVersionId: requireString(value, "workerVersionId"),
  };
}

function parseIdentity(value: unknown): ObservedRunIdentity {
  if (!isRecord(value)) {
    throw new Error("Identity hook returned a non-object result.");
  }

  return {
    containerApplicationId: requireString(value, "containerApplicationId"),
    containerDeploymentId: requireString(value, "containerDeploymentId"),
    containerDurableObjectId: requireString(value, "containerDurableObjectId"),
    containerObservedAt: requireString(value, "containerObservedAt"),
    containerPlacementId: requireString(value, "containerPlacementId"),
    driverBundleSha256: requireString(value, "driverBundleSha256"),
    driverCreatedAt: requireString(value, "driverCreatedAt"),
    driverInstanceId: requireString(value, "driverInstanceId"),
    sandboxId: requireString(value, "sandboxId"),
    sandboxSessionId: requireString(value, "sandboxSessionId"),
  };
}

export function assertIdentityMatchesDeployment(
  identity: ObservedRunIdentity,
  deployment: DeploymentIdentity,
): void {
  const mismatches = [
    ["containerApplicationId", deployment.containerApplicationId, identity.containerApplicationId],
    ["driverBundleSha256", deployment.driverBundleSha256, identity.driverBundleSha256],
  ].filter(([, expected, actual]) => expected !== actual);

  if (mismatches.length > 0) {
    throw new Error(
      `Live runtime identity mismatch: ${mismatches
        .map(([field, expected, actual]) => `${field} expected=${expected} actual=${actual}`)
        .join(", ")}`,
    );
  }
}

export function deriveLegacyOneShotRunAcceptedAt(runId: string): string {
  if (!LEGACY_ULID_PATTERN.test(runId)) {
    throw new Error("Legacy one-shot trace requires a canonical Run ULID.");
  }

  let timestampMs = 0;
  for (const character of runId.slice(0, 10)) {
    timestampMs = timestampMs * 32 + ULID_ALPHABET.indexOf(character);
  }
  return new Date(timestampMs).toISOString();
}

function parseStoredTrace(value: unknown, legacyRunAcceptedAt?: string): ObservedRunTrace {
  if (!isRecord(value) || !Array.isArray(value["timings"])) {
    throw new Error("Trace hook returned an invalid timing collection.");
  }

  const timings = value["timings"].map((entryValue) => {
    if (!isRecord(entryValue) || !isRecord(entryValue["timing"])) {
      throw new Error("Trace hook returned an invalid timing entry.");
    }

    const timing = entryValue["timing"];
    const runId = requireNullableString(timing, "runId");
    const sessionId = requireString(timing, "sessionId");

    const phasesValue = timing["phases"];

    if (!Array.isArray(phasesValue)) {
      throw new Error("Trace hook timing phases must be an array.");
    }

    return {
      eventId: requireString(entryValue, "eventId"),
      occurredAt: requireString(entryValue, "occurredAt"),
      seq: requireNonNegativeInteger(entryValue, "seq"),
      timing: {
        completedAtMs: requireNonNegativeNumber(timing, "completedAtMs"),
        path: requireEnum(timing, "path", ["cold", "prewarm", "unknown", "warm"]),
        phases: phasesValue.map((phaseValue) => {
          if (!isRecord(phaseValue)) {
            throw new Error("Trace hook returned an invalid timing phase.");
          }

          return {
            durationMs: requireNonNegativeNumber(phaseValue, "durationMs"),
            name: requireString(phaseValue, "name"),
          };
        }),
        runId,
        sessionId,
        source: requireEnum(timing, "source", ["api", "driver"]),
        stage: requireEnum(timing, "stage", [
          "context_hydration",
          "driver_backend",
          "driver_turn",
          "prepare_run",
          "prewarm",
        ]),
        startedAtMs: requireNonNegativeNumber(timing, "startedAtMs"),
        totalMs: requireNonNegativeNumber(timing, "totalMs"),
        traceId: requireNullableString(timing, "traceId"),
      },
    };
  });

  const runAcceptedAt = Object.hasOwn(value, "runAcceptedAt")
    ? requireString(value, "runAcceptedAt")
    : legacyRunAcceptedAt;
  if (runAcceptedAt === undefined) {
    throw new Error("Trace hook result requires runAcceptedAt.");
  }
  if (!Number.isFinite(Date.parse(runAcceptedAt))) {
    throw new Error("Trace hook returned an invalid Run acceptance time.");
  }
  return { runAcceptedAt, timings };
}

export function parseTrace(
  value: unknown,
  expected: {
    readonly journey?: BenchmarkJourney;
    readonly runId: string;
    readonly threadId: string;
  },
): ObservedRunTrace {
  const legacyRunAcceptedAt =
    expected.journey === "one-shot" && isRecord(value) && !Object.hasOwn(value, "runAcceptedAt")
      ? deriveLegacyOneShotRunAcceptedAt(expected.runId)
      : undefined;
  const trace = parseStoredTrace(value, legacyRunAcceptedAt);

  if (trace.timings.some(({ timing }) => !runtimeTimingMatchesTrace(timing, expected))) {
    throw new Error("Trace hook timing identity did not match the sampled run.");
  }

  return trace;
}

export async function captureFixedTraceEvidence(input: {
  readonly capture: () => Promise<unknown>;
  readonly expected: {
    readonly driverCreatedAt?: string;
    readonly journey: BenchmarkJourney;
    readonly runId: string;
    readonly threadId: string;
    readonly variant: BenchmarkVariant;
  };
  readonly wait?: (delayMs: number) => Promise<void>;
}): Promise<ObservedRunTrace> {
  const completeSnapshots: ObservedRunTrace[] = [];
  let lastError: unknown = new Error("Fixed trace evidence capture did not run.");
  const wait = input.wait ?? Bun.sleep;

  for (const delayMs of TRACE_EVIDENCE_DELAYS_MS) {
    if (delayMs > 0) {
      await wait(delayMs);
    }
    try {
      const trace = parseTrace(await input.capture(), {
        journey: input.expected.journey,
        runId: input.expected.runId,
        threadId: input.expected.threadId,
      });
      if (runtimeTraceIsComplete(trace, input.expected)) {
        completeSnapshots.push(trace);
      } else {
        lastError = new Error("Trace snapshot did not include every required timing marker.");
      }
    } catch (error) {
      lastError = error;
    }
  }

  const settled = completeSnapshots.at(-1);
  if (settled === undefined) {
    throw lastError;
  }
  return settled;
}

function parseCleanup(value: unknown, threadDeleted: boolean): CleanupVerification {
  if (!isRecord(value)) {
    throw new Error("Cleanup hook returned a non-object result.");
  }

  return {
    containerGone: requireBoolean(value, "containerGone"),
    threadDeleted,
    verifiedAt: requireString(value, "verifiedAt"),
  };
}

async function deleteThread(fixture: RuntimeBenchmarkFixture, threadId: string): Promise<void> {
  const response = await fetch(
    `${fixture.baseURL}/api/v1/threads/${encodeURIComponent(threadId)}`,
    {
      headers: { Authorization: `Bearer ${fixture.pat}` },
      method: "DELETE",
    },
  );
  await response.body?.cancel().catch(() => {});
  if (!response.ok && response.status !== 404) {
    throw new Error(`Public API Thread delete failed with HTTP ${response.status}.`);
  }
}

function attemptError(stage: AttemptFailureStage, error: unknown): AttemptError {
  return {
    at: new Date().toISOString(),
    message: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
    name: error instanceof Error ? error.name : "Error",
    stage,
  };
}

function withAttemptFailure(
  attempt: PendingAttempt,
  stage: AttemptFailureStage,
  error: unknown,
): PendingAttempt {
  const failure = attemptError(stage, error);
  return {
    ...attempt,
    ...(stage === "cleanup" || stage === "delete_thread" ? { cleanupError: failure } : {}),
    primaryError: attempt.primaryError ?? failure,
    updatedAt: failure.at,
  };
}

export function createPendingAttempt(input: {
  readonly attemptStartedAt: string;
  readonly deploymentOrdinal: number;
  readonly executionOrdinal: number;
  readonly nonce: string;
  readonly plan: InterleavedRunPlan;
}): PendingAttempt {
  return {
    ...input.plan,
    attemptStartedAt: input.attemptStartedAt,
    cleanup: { containerGone: false, threadDeleted: false, verifiedAt: null },
    cleanupError: null,
    deploymentOrdinal: input.deploymentOrdinal,
    executionOrdinal: input.executionOrdinal,
    identity: null,
    nonce: input.nonce,
    primaryError: null,
    sample: null,
    stage: "prepared",
    trace: null,
    updatedAt: input.attemptStartedAt,
  };
}

function requireAttemptSample(attempt: PendingAttempt): ColdStartRunResult & {
  readonly runId: string;
  readonly threadId: string;
} {
  const sample = attempt.sample;
  if (sample === null || sample.runId === null || sample.threadId === null) {
    throw new Error("Pending attempt requires a sampled Thread and Run identity.");
  }
  return sample as ColdStartRunResult & { readonly runId: string; readonly threadId: string };
}

export async function reconcilePendingAttempt(input: {
  readonly attempt: PendingAttempt;
  readonly captureIdentity: (attempt: PendingAttempt) => Promise<ObservedRunIdentity>;
  readonly captureTrace: (attempt: PendingAttempt) => Promise<ObservedRunTrace>;
  readonly deleteThread: (threadId: string) => Promise<void>;
  readonly persist: (attempt: PendingAttempt) => Promise<void>;
  readonly validateIdentity: (attempt: PendingAttempt, identity: ObservedRunIdentity) => void;
  readonly verifyCleanup: (attempt: PendingAttempt) => Promise<CleanupVerification>;
}): Promise<PendingAttempt> {
  let attempt = input.attempt;
  const persistFailure = async (stage: AttemptFailureStage, error: unknown): Promise<never> => {
    attempt = withAttemptFailure(attempt, stage, error);
    await input.persist(attempt);
    throw error;
  };

  if (attempt.stage === "prepared") {
    await persistFailure(
      "execution_interrupted",
      new Error(
        "Prepared attempt has no sampled Thread identity; recovery cannot prove remote cleanup.",
      ),
    );
  }
  if (
    attempt.sample === null ||
    attempt.sample.threadId === null ||
    attempt.sample.runId === null
  ) {
    await persistFailure(
      "sample",
      new Error("Sampled attempt has no Thread and Run identity; recovery failed closed."),
    );
  }

  const sampledRun = requireAttemptSample(attempt);
  if (attempt.primaryError === null && sampledRun.failure !== null) {
    attempt = withAttemptFailure(attempt, "sample", new Error(sampledRun.failure.message));
    await input.persist(attempt);
  }

  if (attempt.stage === "sampled") {
    try {
      const identity = await input.captureIdentity(attempt);
      attempt = {
        ...attempt,
        identity,
        stage: "identified",
        updatedAt: new Date().toISOString(),
      };
      await input.persist(attempt);
      try {
        input.validateIdentity(attempt, identity);
      } catch (error) {
        attempt = withAttemptFailure(attempt, "identity", error);
        await input.persist(attempt);
      }
    } catch (error) {
      await persistFailure("identity", error);
    }
  }

  if (attempt.stage === "identified") {
    let trace: ObservedRunTrace = { runAcceptedAt: "", timings: [] };
    try {
      trace = await input.captureTrace(attempt);
      const sample = requireAttemptSample(attempt);
      if (
        !runtimeTraceIsComplete(trace, {
          ...(attempt.identity === null
            ? {}
            : { driverCreatedAt: attempt.identity.driverCreatedAt }),
          journey: attempt.journey,
          runId: sample.runId,
          threadId: sample.threadId,
          variant: attempt.variant,
        })
      ) {
        throw new Error("Trace hook did not return every required runtime timing marker.");
      }
    } catch (error) {
      attempt = withAttemptFailure(attempt, "trace", error);
    }
    attempt = {
      ...attempt,
      stage: "traced",
      trace,
      updatedAt: new Date().toISOString(),
    };
    await input.persist(attempt);
  }

  if (attempt.stage === "traced" && !attempt.cleanup.threadDeleted) {
    try {
      await input.deleteThread(requireAttemptSample(attempt).threadId);
      attempt = {
        ...attempt,
        cleanup: { ...attempt.cleanup, threadDeleted: true },
        updatedAt: new Date().toISOString(),
      };
      await input.persist(attempt);
    } catch (error) {
      await persistFailure("delete_thread", error);
    }
  }

  if (attempt.stage === "traced") {
    try {
      const cleanup = await input.verifyCleanup(attempt);
      if (!cleanup.threadDeleted || !cleanup.containerGone) {
        throw new Error("Runtime cleanup hook did not confirm Thread and Container cleanup.");
      }
      attempt = {
        ...attempt,
        cleanup,
        stage: "cleaned",
        updatedAt: new Date().toISOString(),
      };
      await input.persist(attempt);
    } catch (error) {
      await persistFailure("cleanup", error);
    }
  }

  return attempt;
}

export function archiveRecoveredAttempt(attempt: PendingAttempt): FailedAttempt {
  if (
    attempt.stage !== "cleaned" ||
    attempt.sample === null ||
    attempt.identity === null ||
    attempt.trace === null ||
    attempt.cleanup.verifiedAt === null
  ) {
    throw new Error("Only a fully cleaned pending attempt can enter the failure ledger.");
  }

  const primaryError =
    attempt.primaryError ??
    attemptError(
      "execution_interrupted",
      new Error("Execution stopped after sampling but before the balanced block committed."),
    );
  return {
    ...attempt,
    cleanup: {
      containerGone: attempt.cleanup.containerGone,
      threadDeleted: attempt.cleanup.threadDeleted,
      verifiedAt: attempt.cleanup.verifiedAt,
    },
    failedAt: new Date().toISOString(),
    primaryError,
    sample: attempt.sample,
    stage: "cleaned",
  };
}

export function completedAttemptRun(attempt: PendingAttempt): ExperimentRun {
  if (
    attempt.stage !== "cleaned" ||
    attempt.primaryError !== null ||
    attempt.sample === null ||
    attempt.identity === null ||
    attempt.trace === null ||
    attempt.cleanup.verifiedAt === null
  ) {
    throw new Error("Cold-start attempt is not complete enough to record as a run.");
  }

  return {
    block: attempt.block,
    blockOrder: attempt.blockOrder,
    journey: attempt.journey,
    cleanup: {
      containerGone: attempt.cleanup.containerGone,
      threadDeleted: attempt.cleanup.threadDeleted,
      verifiedAt: attempt.cleanup.verifiedAt,
    },
    deploymentOrdinal: attempt.deploymentOrdinal,
    executionOrdinal: attempt.executionOrdinal,
    identity: attempt.identity,
    nonce: attempt.nonce,
    pair: attempt.pair,
    pairOrder: attempt.pairOrder,
    phase: attempt.phase,
    position: attempt.position,
    sample: attempt.sample,
    sequence: attempt.sequence,
    stack: attempt.stack,
    trace: attempt.trace,
    variant: attempt.variant,
  };
}

async function retryEvidence<T>(action: () => Promise<T>): Promise<T> {
  let lastError: unknown = new Error("Evidence capture did not run.");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await Bun.sleep(attempt * 500);
      }
    }
  }

  throw lastError;
}

function formatMs(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}ms`;
}

function runKey(plan: InterleavedRunPlan): string {
  return `${plan.block}:${plan.position}`;
}

function pendingPlan(attempt: PendingAttempt): InterleavedRunPlan {
  return {
    block: attempt.block,
    blockOrder: attempt.blockOrder,
    journey: attempt.journey,
    pair: attempt.pair,
    pairOrder: attempt.pairOrder,
    phase: attempt.phase,
    position: attempt.position,
    sequence: attempt.sequence,
    stack: attempt.stack,
    variant: attempt.variant,
  };
}

async function main(): Promise<void> {
  loadRepoEnv();
  requireEnv("CLOUDFLARE_ACCOUNT_ID");
  await ensureCloudflareApiToken();
  const outputPath = requireEnv("MOSOO_PERF_OUTPUT");
  const hookPath = resolve(requireEnv("MOSOO_PERF_HOOK"));
  const harnessRevision = await computeHarnessRevision(hookPath);
  await assertPinnedHarnessRevision(harnessRevision);
  const fixtures: Record<BenchmarkStack, RuntimeBenchmarkFixture> = {
    a: await readFixture(requireEnv("MOSOO_PERF_FIXTURE_A")),
    b: await readFixture(requireEnv("MOSOO_PERF_FIXTURE_B")),
  };
  const stackEnvironments = {
    a: stackHookEnvironment("a"),
    b: stackHookEnvironment("b"),
  } as const;
  assertEquivalentRuntimeFixtures(fixtures.a, fixtures.b);
  assertDistinctStackHookEnvironments(stackEnvironments.a, stackEnvironments.b);
  for (const stack of ["a", "b"] as const) {
    if (
      stackEnvironments[stack]["MOSOO_PERF_BASE_URL"].replace(/\/+$/u, "") !==
      fixtures[stack].baseURL.replace(/\/+$/u, "")
    ) {
      throw new Error(`Stack ${stack} fixture baseURL does not match its hook environment.`);
    }
  }
  const journey = process.env["MOSOO_PERF_JOURNEY"]?.trim() || "two-stage";
  if (journey !== "one-shot" && journey !== "two-stage") {
    throw new Error("MOSOO_PERF_JOURNEY must be one-shot or two-stage.");
  }
  const experimentId =
    process.env["MOSOO_PERF_EXPERIMENT_ID"]?.trim() || `managed-runtime-cold-v2-${journey}`;
  const seed = process.env["MOSOO_PERF_SEED"]?.trim() || "mosoo-cold-start-v2";
  const sourceRegion = process.env["MOSOO_PERF_SOURCE_REGION"]?.trim() || "unknown";
  const totalBlocks = readInteger("MOSOO_PERF_TOTAL_BLOCKS", 16);
  if (totalBlocks !== 16) {
    throw new Error("Dual-stack crossover requires exactly 16 four-run blocks.");
  }
  const blockStart = readInteger("MOSOO_PERF_BLOCK_START", 0);
  const blockCount = readInteger("MOSOO_PERF_BLOCK_COUNT", totalBlocks - blockStart);
  const timeoutMs = readInteger("MOSOO_PERF_TIMEOUT_MS", 240_000);
  const leadMs = readInteger("MOSOO_PERF_LEAD_MS", 10_000);
  const budget: BenchmarkBudget = {
    maxAttemptedRuns: readPositiveInteger("MOSOO_PERF_MAX_ATTEMPTED_RUNS", totalBlocks * 4),
    maxFailedAttempts: readInteger("MOSOO_PERF_MAX_FAILED_ATTEMPTS", 0),
    maxUsageTotalTokens: readPositiveInteger("MOSOO_PERF_MAX_USAGE_TOTAL_TOKENS", 200_000),
    maxWallClockMs: readPositiveInteger("MOSOO_PERF_MAX_WALL_CLOCK_MS", 6 * 60 * 60_000),
  };
  if (budget.maxAttemptedRuns !== totalBlocks * 4) {
    throw new Error("Formal cold-start budget must reserve exactly one attempt per planned run.");
  }
  const document = await loadDocument({
    budget,
    experimentId,
    fixture: fixtures.a,
    fixtureB: fixtures.b,
    harnessRevision,
    journey,
    leadMs,
    outputPath,
    seed,
    sourceRegion,
    timeoutMs,
    totalBlocks,
  });
  assertBenchmarkBudget(document);
  const allBlocks = createInterleavedBlockPlans({
    blockCount: totalBlocks,
    blockStart: 0,
    journey,
    seed,
    totalBlocks,
  });
  validateRecordedRuns(document, allBlocks, experimentId, seed);
  const refreshSummary = () => {
    document.summary = summarizeColdStartExperiment({
      deployments: document.deployments,
      discardedBlocks: document.discardedBlocks.length,
      failedAttempts: document.failedAttempts.length,
      journey,
      pendingAttempt: document.pendingAttempt !== null,
      pendingDeployment: document.pendingDeployment !== null,
      leadMs,
      leadToleranceMs: COLD_START_LEAD_TOLERANCE_MS,
      runs: document.runs,
      seed,
      totalBlocks,
    });
    document.updatedAt = new Date().toISOString();
  };

  if (document.pendingDeployment !== null) {
    // ponytail: fail closed; add tag-based rollout recovery only if interruptions recur.
    throw new Error(
      `Deployment ${document.pendingDeployment.ordinal} may already have changed remote state; start a new experiment instead of silently adding a rollout.`,
    );
  }
  const persistPending = async (attempt: PendingAttempt) => {
    document.pendingAttempt = attempt;
    refreshSummary();
    await writeDocument(outputPath, document);
  };
  const reconcileDocumentAttempt = async (
    attempt: PendingAttempt,
    eagerIdentity: Promise<unknown> | null,
    workerIdentityError: Error | null,
  ) => {
    const deployment = document.deployments.find(
      (candidate) => candidate.ordinal === attempt.deploymentOrdinal,
    );
    if (deployment === undefined) {
      throw new Error("Pending attempt references an unknown deployment.");
    }

    return reconcilePendingAttempt({
      attempt,
      captureIdentity: async (current) => {
        const capture = async () => {
          const sample = current.sample;
          if (sample?.runId === null || sample?.threadId === null || sample === null) {
            throw new Error("Identity capture requires a sampled Thread and Run.");
          }
          return parseIdentity(
            await runHook(hookPath, harnessRevision, current.stack, "identity", {
              attemptStartedAt: current.attemptStartedAt,
              deployment,
              experimentId,
              observation: {
                observedAt: sample.completedAt,
                runId: sample.runId,
                threadId: sample.threadId,
              },
              plan: pendingPlan(current),
            }),
          );
        };

        if (eagerIdentity !== null) {
          try {
            return parseIdentity(await eagerIdentity);
          } catch {
            return retryEvidence(capture);
          }
        }
        return retryEvidence(capture);
      },
      captureTrace: async (current) => {
        const sample = current.sample;
        if (sample?.runId === null || sample?.threadId === null || sample === null) {
          throw new Error("Trace capture requires a sampled Thread and Run.");
        }
        return captureFixedTraceEvidence({
          capture: () =>
            runHook(hookPath, harnessRevision, current.stack, "trace", {
              deployment,
              experimentId,
              observation: { runId: sample.runId, threadId: sample.threadId },
              plan: pendingPlan(current),
            }),
          expected: {
            ...(current.identity === null
              ? {}
              : { driverCreatedAt: current.identity.driverCreatedAt }),
            journey: current.journey,
            runId: sample.runId,
            threadId: sample.threadId,
            variant: current.variant,
          },
        });
      },
      deleteThread: (threadId) => deleteThread(fixtures[attempt.stack], threadId),
      persist: persistPending,
      verifyCleanup: async (current) => {
        if (
          current.identity === null ||
          current.sample?.threadId === null ||
          current.sample === null
        ) {
          throw new Error("Cleanup verification requires sampled runtime identity.");
        }
        return parseCleanup(
          await runHook(hookPath, harnessRevision, current.stack, "cleanup", {
            deployment,
            experimentId,
            identity: current.identity,
            plan: pendingPlan(current),
            threadId: current.sample.threadId,
          }),
          current.cleanup.threadDeleted,
        );
      },
      validateIdentity: (_current, identity) => {
        if (workerIdentityError !== null) {
          throw workerIdentityError;
        }
        assertIdentityMatchesDeployment(identity, deployment);
      },
    });
  };

  if (document.pendingAttempt !== null) {
    console.log(
      `[cold-ab] recover key=${runKey(document.pendingAttempt)} stage=${document.pendingAttempt.stage}`,
    );
    const recovered = await reconcileDocumentAttempt(document.pendingAttempt, null, null);
    document.failedAttempts.push(archiveRecoveredAttempt(recovered));
    document.pendingAttempt = null;
  }

  discardPartialBlocks(document);
  // Recompute derived fields on every resume. Raw runs are the evidence; the
  // summary must follow the current, tested gate semantics rather than remain
  // stale when a benchmark-only validation bug is corrected.
  refreshSummary();
  await writeDocument(outputPath, document);
  const blocks = createInterleavedBlockPlans({
    blockCount,
    blockStart,
    journey,
    seed,
    totalBlocks,
  });
  const runCountByBlock = new Map<number, number>();

  for (const run of document.runs) {
    runCountByBlock.set(run.block, (runCountByBlock.get(run.block) ?? 0) + 1);
  }

  const completedBlocks = new Set(
    [...runCountByBlock.entries()].filter(([, count]) => count === 4).map(([block]) => block),
  );

  const executionOrdinal = document.executions.length + 1;
  document.executions.push({
    blockCount,
    blockStart,
    harnessRevision,
    ordinal: executionOrdinal,
    startedAt: new Date().toISOString(),
  });
  document.updatedAt = new Date().toISOString();
  await writeDocument(outputPath, document);

  const activeDeployments = new Map<string, DeploymentIdentity>();

  const ensurePhaseDeployments = async (phase: CrossoverPhase) => {
    for (const stack of ["a", "b"] as const) {
      const key = `${phase}:${stack}`;
      const variant: BenchmarkVariant = (phase === 1) === (stack === "a") ? "before" : "after";
      let deployment = document.deployments.find(
        (candidate) => candidate.phase === phase && candidate.stack === stack,
      );
      if (deployment === undefined) {
        const ordinal = document.deployments.length + 1;
        console.log(
          `[cold-ab] deploy ordinal=${ordinal} phase=${phase} stack=${stack} variant=${variant}`,
        );
        document.pendingDeployment = {
          ordinal,
          phase,
          stack,
          startedAt: new Date().toISOString(),
          variant,
        };
        refreshSummary();
        await writeDocument(outputPath, document);
        deployment = parseDeployment(
          await runHook(hookPath, harnessRevision, stack, "deploy", {
            experimentId,
            ordinal,
            phase,
            stack,
            variant,
          }),
          { ordinal, phase, stack, variant },
        );
        assertDeploymentTreatmentStable(document.deployments, deployment);
        document.deployments.push(deployment);
        document.pendingDeployment = null;
        document.updatedAt = new Date().toISOString();
        await writeDocument(outputPath, document);
      }
      activeDeployments.set(key, deployment);
    }
  };

  for (const block of blocks) {
    if (completedBlocks.has(block.block)) {
      console.log(`[cold-ab] skip block=${block.block} (four runs recorded)`);
      continue;
    }

    await ensurePhaseDeployments(block.runs[0].phase);

    for (const plan of block.runs) {
      assertBenchmarkBudget(document, { reserveRun: true });
      const deployment = activeDeployments.get(`${plan.phase}:${plan.stack}`);

      if (deployment === undefined || deployment.variant !== plan.variant) {
        throw new Error("Cold-start run has no active deployment.");
      }

      const nonce = createPairNonce(experimentId, seed, plan.pair, executionOrdinal);
      const attemptStartedAt = new Date().toISOString();
      let pending = createPendingAttempt({
        attemptStartedAt,
        deploymentOrdinal: deployment.ordinal,
        executionOrdinal,
        nonce,
        plan,
      });
      let identityPromise: Promise<unknown> | null = null;
      let workerIdentityError: Error | null = null;
      await persistPending(pending);
      console.log(
        `[cold-ab] start block=${plan.block}/${totalBlocks} pattern=${plan.blockOrder} position=${plan.position} pair=${plan.pair} order=${plan.pairOrder} variant=${plan.variant}`,
      );
      await assertHarnessRevision(hookPath, harnessRevision);
      let sample: ColdStartRunResult;
      try {
        sample = await runColdStartSample({
          fixture: fixtures[plan.stack],
          journey: plan.journey,
          leadMs,
          nonce,
          onFirstAssistantText: (observation) => {
            if (!httpWorkerIdentityMatches(plan.journey, deployment.workerVersionId, observation)) {
              workerIdentityError ??= new Error(
                `HTTP Worker identity mismatch: expected=${deployment.workerVersionId} create=${observation.workerVersionCreate ?? "missing"} send=${plan.journey === "one-shot" ? "not-applicable" : (observation.workerVersionSend ?? "missing")} stream=${observation.workerVersionStream ?? "missing"}.`,
              );
              return;
            }

            identityPromise ??= runHook(hookPath, harnessRevision, plan.stack, "identity", {
              attemptStartedAt,
              deployment,
              experimentId,
              observation: {
                observedAt: observation.observedAt,
                runId: observation.runId,
                threadId: observation.threadId,
              },
              plan,
            });
            void identityPromise.catch(() => {});
          },
          plan: toColdStartRunPlan(plan),
          timeoutMs,
        });
      } catch (error) {
        pending = withAttemptFailure(pending, "sample", error);
        await persistPending(pending);
        throw error;
      }
      pending = {
        ...pending,
        sample,
        stage: "sampled",
        updatedAt: new Date().toISOString(),
      };
      await persistPending(pending);
      const completed = await reconcileDocumentAttempt(
        pending,
        identityPromise,
        workerIdentityError,
      );
      await assertHarnessRevision(hookPath, harnessRevision);
      if (completed.primaryError !== null) {
        document.failedAttempts.push(archiveRecoveredAttempt(completed));
        document.pendingAttempt = null;
        discardPartialBlocks(document);
        refreshSummary();
        await writeDocument(outputPath, document);
        throw new Error(completed.primaryError.message);
      }
      const run = completedAttemptRun(completed);
      document.runs.push(run);
      document.pendingAttempt = null;
      refreshSummary();
      await writeDocument(outputPath, document);
      assertBenchmarkBudget(document);
      console.log(
        sample.failure === null
          ? `[cold-ab] done key=${runKey(plan)} intent_first_text=${formatMs(sample.metrics.intentToFirstAssistantTextMs)} send_first_text=${formatMs(sample.metrics.sendToFirstAssistantTextMs)} completed=${formatMs(sample.metrics.runCompletedMs)} chunks=${sample.metrics.assistantChunkCount} semantic=${sample.output.valid}`
          : `[cold-ab] fail key=${runKey(plan)} stage=${sample.failure.stage} first_text=${formatMs(sample.metrics.firstAssistantTextMs)} reason=${sample.failure.message}`,
      );
    }

    completedBlocks.add(block.block);
  }

  const paired = document.summary.pairedSendToFirstAssistantText;
  const prewarm = document.summary.prewarm;
  const budgetUsage = assertBenchmarkBudget(document);
  console.log(
    `[cold-ab] summary blocks=${paired.completeBlocks}/${totalBlocks} pairs=${paired.completePairs}/${paired.totalPairs} delta=${formatMs(paired.medianAfterMinusBeforeMs)} improvement=${paired.medianImprovementPercent?.toFixed(1) ?? "n/a"}% prewarm_deadline=${prewarm.deadlineHits}/${prewarm.expectedAfterRuns} late=${prewarm.lateRuns} unknown=${prewarm.unknownRuns} prepare_warm=${prewarm.prepareWarmRuns} output=${document.summary.output.equivalentRuns}/${document.summary.output.expectedRuns} identity=${document.summary.identity.completeRuns}/${document.summary.identity.expectedRuns} trace=${document.summary.trace.completeRuns}/${document.summary.trace.expectedRuns} retain=${document.summary.gate.retain}`,
  );
  console.log(
    `[cold-ab] budget runs=${budgetUsage.attemptedRuns}/${budget.maxAttemptedRuns} failed=${budgetUsage.failedAttempts}/${budget.maxFailedAttempts} tokens=${budgetUsage.usageTotalTokens}/${budget.maxUsageTotalTokens} elapsed=${formatMs(budgetUsage.elapsedMs)}/${formatMs(budget.maxWallClockMs)}`,
  );
  console.log(`[cold-ab] output=${resolve(outputPath)}`);
}

if (import.meta.main) {
  await main();
}
