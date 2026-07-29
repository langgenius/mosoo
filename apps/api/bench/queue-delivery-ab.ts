import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  admitApiCommand,
  deliverApiCommand,
} from "../src/modules/api-command/application/api-command-ledger";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "../tests/helpers/public-api-http-test-fixture";

type Variant = "after" | "before";

interface Sample {
  readonly block: number;
  readonly durationMs: number;
  readonly position: number;
  readonly variant: Variant;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[midpoint] ?? 0)
    : ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function createBlockPlan(block: number): readonly Variant[] {
  return block % 2 === 0
    ? ["before", "after", "after", "before"]
    : ["after", "before", "before", "after"];
}

async function main(): Promise<void> {
  const blocks = readPositiveInteger("MOSOO_QUEUE_DELIVERY_BENCH_BLOCKS", 16);
  const queueDelayMs = readPositiveInteger("MOSOO_QUEUE_DELIVERY_BENCH_DELAY_MS", 250);
  const database = await createPublicHttpContractDatabase();
  let queueSends = 0;
  const bindings = createPublicHttpTestBindings(database, {
    apiCommandQueue: {
      sent: [],
      async send(): Promise<void> {
        queueSends += 1;
        await Bun.sleep(queueDelayMs);
      },
    },
  }) as ApiBindings;
  let commandOrdinal = 0;

  const run = async (variant: Variant): Promise<number> => {
    commandOrdinal += 1;
    const startedAt = performance.now();
    const admission = await admitApiCommand(bindings, {
      dedupeKey: `queue-delivery-bench:${commandOrdinal}`,
      kind: "scheduled_maintenance",
      payload: { scheduledTime: commandOrdinal },
    });
    const delivery = deliverApiCommand(bindings, admission);

    if (variant === "before") {
      await delivery;
    }

    const durationMs = performance.now() - startedAt;

    if (variant === "after") {
      await delivery;
    }

    return durationMs;
  };

  await run("before");
  await run("after");
  queueSends = 0;
  const samples: Sample[] = [];

  for (let block = 0; block < blocks; block += 1) {
    for (const [position, variant] of createBlockPlan(block).entries()) {
      samples.push({ block, position, variant, durationMs: await run(variant) });
    }
  }

  if (queueSends !== samples.length) {
    throw new Error(`Expected ${samples.length} Queue sends, observed ${queueSends}.`);
  }

  const before = samples.filter((sample) => sample.variant === "before");
  const after = samples.filter((sample) => sample.variant === "after");
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
      pairs: blocks * 2,
      pattern: "alternating ABBA/BAAB",
      queueDelayMs,
      treatment: {
        after: "return after durable outbox admission; deliver via waitUntil",
        before: "await Queue send and delivery-marker clear before returning",
      },
    },
    samples: samples.map((sample) => ({ ...sample, durationMs: round(sample.durationMs) })),
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
  const outputPath = process.env["MOSOO_QUEUE_DELIVERY_BENCH_OUTPUT"]?.trim();

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
