import assert from "node:assert/strict";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseRuntimeBenchmarkFixture, runColdStartSample } from "../lib/cold-start-benchmark";
import type {
  ColdStartRunPlan,
  ColdStartRunResult,
  RuntimeBenchmarkFixture,
} from "../lib/cold-start-benchmark";
import { stackHookEnvironment } from "./cold-start-ab";

const HOOK_RESULT_PREFIX = "MOSOO_PERF_HOOK_RESULT=";

type Stack = "a" | "b";
type Variant = "after" | "before";

interface PlannedRun extends ColdStartRunPlan {
  readonly position: number;
}

const plans: readonly PlannedRun[] = [
  {
    order: "ab",
    pair: 1,
    phase: 1,
    position: 1,
    sequence: 1,
    stack: "a",
    variant: "before",
  },
  {
    order: "ab",
    pair: 1,
    phase: 1,
    position: 2,
    sequence: 2,
    stack: "b",
    variant: "after",
  },
  {
    order: "ba",
    pair: 2,
    phase: 1,
    position: 3,
    sequence: 1,
    stack: "b",
    variant: "after",
  },
  {
    order: "ba",
    pair: 2,
    phase: 1,
    position: 4,
    sequence: 2,
    stack: "a",
    variant: "before",
  },
  {
    order: "ba",
    pair: 17,
    phase: 2,
    position: 1,
    sequence: 1,
    stack: "a",
    variant: "after",
  },
  {
    order: "ba",
    pair: 17,
    phase: 2,
    position: 2,
    sequence: 2,
    stack: "b",
    variant: "before",
  },
  {
    order: "ab",
    pair: 18,
    phase: 2,
    position: 3,
    sequence: 1,
    stack: "b",
    variant: "before",
  },
  {
    order: "ab",
    pair: 18,
    phase: 2,
    position: 4,
    sequence: 2,
    stack: "a",
    variant: "after",
  },
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length === 0) {
    throw new Error(`Intrusion benchmark requires ${name}.`);
  }
  return value;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

function metricDeltas(
  runs: readonly ColdStartRunResult[],
  read: (run: ColdStartRunResult) => number | null,
) {
  const complete = new Map<number, Partial<Record<Variant, number>>>();
  for (const run of runs) {
    const value = read(run);
    if (value !== null && run.failure === null) {
      complete.set(run.pair, {
        ...complete.get(run.pair),
        [run.variant]: value,
      });
    }
  }
  const deltas = [...complete.entries()].flatMap(([pair, values]) =>
    values.after === undefined || values.before === undefined
      ? []
      : [{ deltaMs: values.after - values.before, pair }],
  );
  return {
    deltas,
    medianAfterMinusBeforeMs: median(deltas.map(({ deltaMs }) => deltaMs)),
  };
}

function summarize(runs: readonly ColdStartRunResult[]) {
  const ttft = metricDeltas(runs, (run) => run.metrics.sendToFirstAssistantTextMs);
  return {
    correctRuns: runs.filter((run) => run.failure === null && run.output.valid).length,
    createAccepted: metricDeltas(runs, (run) => run.metrics.createAcceptedMs),
    failures: runs.filter((run) => run.failure !== null).length,
    phaseTtftMedianAfterMinusBeforeMs: Object.fromEntries(
      [1, 2].map((phase) => [
        phase,
        metricDeltas(
          runs.filter((run) => run.phase === phase),
          (run) => run.metrics.sendToFirstAssistantTextMs,
        ).medianAfterMinusBeforeMs,
      ]),
    ),
    runCompleted: metricDeltas(runs, (run) => run.metrics.runCompletedMs),
    ttft,
  };
}

async function readFixture(path: string): Promise<RuntimeBenchmarkFixture> {
  return parseRuntimeBenchmarkFixture(JSON.parse(await readFile(path, "utf8")) as unknown);
}

async function writeArtifact(path: string, artifact: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function deploy(input: {
  readonly experimentId: string;
  readonly harnessRevision: string;
  readonly hookPath: string;
  readonly ordinal: number;
  readonly phase: number;
  readonly stack: Stack;
  readonly variant: Variant;
}): Promise<Record<string, unknown>> {
  const child = Bun.spawn(
    [
      process.execPath,
      input.hookPath,
      "deploy",
      JSON.stringify({
        experimentId: input.experimentId,
        harnessRevision: input.harnessRevision,
        ordinal: input.ordinal,
        phase: input.phase,
        stack: input.stack,
        variant: input.variant,
      }),
    ],
    {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...process.env, ...stackHookEnvironment(input.stack) },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Intrusion deploy failed: ${stderr.trim().slice(-4_000)}`);
  }
  const line = stdout.split(/\r?\n/u).findLast((entry) => entry.startsWith(HOOK_RESULT_PREFIX));
  if (line === undefined) {
    throw new Error("Intrusion deploy did not return provenance.");
  }
  const result: unknown = JSON.parse(line.slice(HOOK_RESULT_PREFIX.length));
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Intrusion deploy returned invalid provenance.");
  }
  return result as Record<string, unknown>;
}

async function deleteAndVerify(
  fixture: RuntimeBenchmarkFixture,
  threadId: string,
): Promise<string> {
  const url = `${fixture.baseURL}/api/v1/threads/${encodeURIComponent(threadId)}`;
  const headers = { Authorization: `Bearer ${fixture.pat}` };
  const deleted = await fetch(url, { headers, method: "DELETE" });
  await deleted.body?.cancel().catch(() => {});
  if (!deleted.ok && deleted.status !== 404) {
    throw new Error(`Intrusion Thread delete failed with HTTP ${deleted.status}.`);
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(url, { headers });
    await response.body?.cancel().catch(() => {});
    if (response.status === 404) {
      return new Date().toISOString();
    }
    await Bun.sleep(1_000);
  }
  throw new Error("Intrusion Thread delete was not externally observable within 60 seconds.");
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(plans.length, 8);
    for (const pair of [1, 2, 17, 18]) {
      assert.deepEqual(
        plans
          .filter((plan) => plan.pair === pair)
          .map((plan) => plan.variant)
          .toSorted(),
        ["after", "before"],
      );
    }
    console.log("perf-intrusion-ab self-test passed");
    return;
  }

  const outputPath = resolve(requireEnv("MOSOO_PERF_OUTPUT"));
  await access(outputPath).then(
    () => {
      throw new Error("Intrusion output already exists; use a new experiment ID.");
    },
    () => {},
  );
  const experimentId = requireEnv("MOSOO_PERF_EXPERIMENT_ID");
  const harnessRevision = requireEnv("MOSOO_PERF_EXPECTED_HARNESS_REVISION");
  const hookPath = resolve(requireEnv("MOSOO_PERF_HOOK"));
  const timeoutMs = Number(process.env["MOSOO_PERF_TIMEOUT_MS"] ?? 180_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("MOSOO_PERF_TIMEOUT_MS must be a positive integer.");
  }
  const fixtures = {
    a: await readFixture(requireEnv("MOSOO_PERF_FIXTURE_A")),
    b: await readFixture(requireEnv("MOSOO_PERF_FIXTURE_B")),
  };
  const artifact = {
    schemaVersion: "mosoo.perf-intrusion-ab.v1",
    experimentId,
    createdAt: new Date().toISOString(),
    method: {
      pairs: 4,
      pattern: ["ABBA", "BAAB"],
      physicalContainerIdentityVerified: false,
      scope: "measurement-layer timing intrusion only; never eligible for product promotion",
      threadDeletionVerifiedByPublicApi: true,
    },
    deployments: [] as Record<string, unknown>[],
    runs: [] as Array<{
      cleanup: { threadDeleted: true; verifiedAt: string };
      position: number;
      sample: ColdStartRunResult;
    }>,
    summary: summarize([]),
  };

  let ordinal = 0;
  for (const phase of [1, 2]) {
    const deploymentPlans =
      phase === 1
        ? ([
            { stack: "a", variant: "before" },
            { stack: "b", variant: "after" },
          ] as const)
        : ([
            { stack: "a", variant: "after" },
            { stack: "b", variant: "before" },
          ] as const);
    for (const deploymentPlan of deploymentPlans) {
      ordinal += 1;
      console.log(
        `[intrusion-ab] deploy ordinal=${ordinal} phase=${phase} stack=${deploymentPlan.stack} variant=${deploymentPlan.variant}`,
      );
      artifact.deployments.push(
        await deploy({
          ...deploymentPlan,
          experimentId,
          harnessRevision,
          hookPath,
          ordinal,
          phase,
        }),
      );
      await writeArtifact(outputPath, artifact);
    }

    for (const plan of plans.filter((candidate) => candidate.phase === phase)) {
      const nonce = `MOSOO_INTRUSION_${experimentId}_${plan.pair}_${plan.sequence}`.toUpperCase();
      console.log(
        `[intrusion-ab] start phase=${phase} position=${plan.position} pair=${plan.pair} variant=${plan.variant}`,
      );
      const sample = await runColdStartSample({
        fixture: fixtures[plan.stack],
        journey: "one-shot",
        nonce,
        plan,
        timeoutMs,
      });
      if (sample.threadId === null) {
        throw new Error("Intrusion sample did not create a Thread to clean up.");
      }
      const verifiedAt = await deleteAndVerify(fixtures[plan.stack], sample.threadId);
      artifact.runs.push({
        cleanup: { threadDeleted: true, verifiedAt },
        position: plan.position,
        sample,
      });
      artifact.summary = summarize(artifact.runs.map((run) => run.sample));
      await writeArtifact(outputPath, artifact);
      console.log(
        `[intrusion-ab] done phase=${phase} position=${plan.position} ttft=${sample.metrics.sendToFirstAssistantTextMs ?? "failed"}ms valid=${sample.output.valid}`,
      );
      if (sample.failure !== null || !sample.output.valid) {
        throw new Error(
          `Intrusion sample failed: ${sample.failure?.message ?? sample.output.reason}`,
        );
      }
    }
  }
  console.log(`[intrusion-ab] output=${outputPath}`);
}

if (import.meta.main) {
  await main();
}
