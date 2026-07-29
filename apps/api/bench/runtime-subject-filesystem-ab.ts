import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  SANDBOX_CACHE_PATH,
  SANDBOX_MEMORY_PATH,
  SANDBOX_SESSION_ROOT,
} from "@mosoo/agent-driver/paths";

import { prepareRuntimeSubjectFilesystem } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-platform";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";

type FilesystemHandle = Pick<SandboxHandle, "mkdir" | "setKeepAlive">;
type Variant = "after" | "before";

interface Sample {
  readonly block: number;
  readonly durationMs: number;
  readonly maxConcurrentCalls: number;
  readonly position: number;
  readonly rpcCalls: number;
  readonly variant: Variant;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function createBlockPlan(block: number): readonly Variant[] {
  return block % 2 === 0
    ? ["before", "after", "after", "before"]
    : ["after", "before", "before", "after"];
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[midpoint] ?? 0)
    : ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function createDelayedHandle(delayMs: number): {
  readonly handle: FilesystemHandle;
  snapshot(): {
    readonly maxConcurrentCalls: number;
    readonly rpcCalls: number;
  };
} {
  let activeCalls = 0;
  let maxConcurrentCalls = 0;
  let rpcCalls = 0;
  const operation = async () => {
    activeCalls += 1;
    rpcCalls += 1;
    maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
    await Bun.sleep(delayMs);
    activeCalls -= 1;
  };

  return {
    handle: {
      mkdir: operation,
      setKeepAlive: operation,
    },
    snapshot: () => ({ maxConcurrentCalls, rpcCalls }),
  };
}

async function prepareSerially(subject: FilesystemHandle): Promise<void> {
  await subject.setKeepAlive(true);
  await Promise.all([
    subject.mkdir(SANDBOX_CACHE_PATH, { recursive: true }),
    subject.mkdir(SANDBOX_MEMORY_PATH, { recursive: true }),
    subject.mkdir(SANDBOX_SESSION_ROOT, { recursive: true }),
  ]);
}

async function main(): Promise<void> {
  const blocks = readPositiveInteger("MOSOO_RUNTIME_SUBJECT_FILESYSTEM_BENCH_BLOCKS", 16);
  const delayMs = readPositiveInteger("MOSOO_RUNTIME_SUBJECT_FILESYSTEM_BENCH_DELAY_MS", 25);

  const run = async (variant: Variant): Promise<Omit<Sample, "block" | "position">> => {
    const delayed = createDelayedHandle(delayMs);
    const startedAt = performance.now();

    if (variant === "before") {
      await prepareSerially(delayed.handle);
    } else {
      await prepareRuntimeSubjectFilesystem(delayed.handle);
    }

    return {
      durationMs: performance.now() - startedAt,
      ...delayed.snapshot(),
      variant,
    };
  };

  await run("before");
  await run("after");

  const samples: Sample[] = [];
  for (let block = 0; block < blocks; block += 1) {
    for (const [position, variant] of createBlockPlan(block).entries()) {
      samples.push({ ...(await run(variant)), block, position });
    }
  }

  const before = samples.filter((sample) => sample.variant === "before");
  const after = samples.filter((sample) => sample.variant === "after");

  if (
    before.some((sample) => sample.rpcCalls !== 4 || sample.maxConcurrentCalls !== 3) ||
    after.some((sample) => sample.rpcCalls !== 4 || sample.maxConcurrentCalls !== 4)
  ) {
    throw new Error("Runtime subject filesystem treatment identity was not preserved.");
  }

  const pairedDeltas: number[] = [];
  for (let index = 0; index < samples.length; index += 2) {
    const pair = samples.slice(index, index + 2);
    const beforeSample = pair.find((sample) => sample.variant === "before");
    const afterSample = pair.find((sample) => sample.variant === "after");

    if (beforeSample === undefined || afterSample === undefined) {
      throw new Error(`Pair ${index / 2 + 1} is not balanced.`);
    }

    pairedDeltas.push(afterSample.durationMs - beforeSample.durationMs);
  }

  const beforeDurations = before.map((sample) => sample.durationMs);
  const afterDurations = after.map((sample) => sample.durationMs);
  const beforeMedian = median(beforeDurations);
  const afterMedian = median(afterDurations);
  const output = {
    method: {
      blocks,
      delayMs,
      pairs: blocks * 2,
      pattern: "alternating ABBA/BAAB",
      treatment: {
        after: "setKeepAlive and the three mkdir RPCs begin in one Promise.all",
        before: "setKeepAlive completes before the three mkdir RPCs begin",
      },
    },
    samples: samples.map((sample) => ({
      ...sample,
      durationMs: round(sample.durationMs),
    })),
    summary: {
      after: {
        medianMs: round(afterMedian),
        p95Ms: round(percentile(afterDurations, 0.95)),
        runs: after.length,
      },
      before: {
        medianMs: round(beforeMedian),
        p95Ms: round(percentile(beforeDurations, 0.95)),
        runs: before.length,
      },
      medianAfterMinusBeforeMs: round(afterMedian - beforeMedian),
      medianImprovementPercent: round(((beforeMedian - afterMedian) / beforeMedian) * 100),
      pairedMedianDeltaMs: round(median(pairedDeltas)),
    },
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const outputPath = process.env["MOSOO_RUNTIME_SUBJECT_FILESYSTEM_BENCH_OUTPUT"]?.trim();

  if (outputPath === undefined || outputPath.length === 0) {
    console.log(serialized.trimEnd());
    return;
  }

  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, serialized, { mode: 0o600 });
  await chmod(absolutePath, 0o600);
  console.log(JSON.stringify({ output: absolutePath, summary: output.summary }));
}

await main();
