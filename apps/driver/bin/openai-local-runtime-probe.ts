#!/usr/bin/env bun
import type { BunRuntime } from "../../../dev/config/bun-script-types";
import { readProbeOptions } from "./openai-local-runtime-probe-options";
import { OpenAiLocalRuntimeProbeRunner } from "./openai-local-runtime-probe-runner";
import { DEFAULT_EXECUTABLE, formatMs } from "./openai-local-runtime-probe-types";
import type {
  PhaseRecord,
  RuntimeProbeOptions,
  RuntimeThread,
  RuntimeTurn,
} from "./openai-local-runtime-probe-types";

declare const Bun: BunRuntime;

function printSummary(input: {
  readonly completedTurn: RuntimeTurn | null;
  readonly homeKept: boolean;
  readonly options: RuntimeProbeOptions;
  readonly phases: readonly PhaseRecord[];
  readonly runtimeHome: string;
  readonly stderrTail: string;
  readonly thread: RuntimeThread | null;
  readonly turnStart: RuntimeTurn | null;
}): void {
  const totalMs = input.phases.reduce((sum, phase) => sum + phase.durationMs, 0);
  const summary = {
    completedTurn: input.completedTurn,
    executable:
      input.options.executable === DEFAULT_EXECUTABLE
        ? "default-runtime-executable"
        : input.options.executable,
    home: input.homeKept ? input.runtimeHome : "removed",
    model: input.options.model,
    phases: input.phases.map((phase) => ({
      durationMs: Math.round(phase.durationMs),
      name: phase.name,
      ok: phase.ok,
    })),
    thread: input.thread,
    totalMs: Math.round(totalMs),
    turnStart: input.turnStart,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log("");
  console.log("Phase table:");
  for (const phase of input.phases) {
    console.log(`- ${phase.ok ? "ok" : "fail"} ${phase.name}: ${formatMs(phase.durationMs)}`);
  }

  const shouldPrintStderr =
    input.options.showStderr ||
    input.phases.some((phase) => !phase.ok) ||
    (input.completedTurn !== null && input.completedTurn.error !== null);

  if (shouldPrintStderr && input.stderrTail.trim().length > 0) {
    console.log("");
    console.log("stderr tail:");
    console.log(input.stderrTail.trim());
  }
}

async function createRuntimeHome(): Promise<string> {
  const tmpRoot = process.env["TMPDIR"]?.trim() || "/tmp";
  const runtimeHome = `${tmpRoot.replace(/\/+$/u, "")}/mosoo-openai-runtime-${crypto.randomUUID()}`;
  await Bun.write(`${runtimeHome}/.keep`, "");
  return runtimeHome;
}

async function removeRuntimeHome(runtimeHome: string): Promise<void> {
  await Bun.$`rm -rf ${runtimeHome}`.quiet();
}

async function main(): Promise<void> {
  const options = readProbeOptions();
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey || apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is required in the environment.");
  }

  const runtimeHome = await createRuntimeHome();
  const probe = new OpenAiLocalRuntimeProbeRunner(options);
  let thread: RuntimeThread | null = null;
  let turnStart: RuntimeTurn | null = null;
  let completedTurn: RuntimeTurn | null = null;

  const timeout = setTimeout(() => {
    probe.stop();
  }, options.commandTimeoutMs).unref();

  try {
    const result = await probe.run(runtimeHome);
    thread = result.thread;
    turnStart = result.turnStart;
    completedTurn = result.completedTurn;
    if (completedTurn?.status === "failed") {
      throw new Error(completedTurn.error ?? "Runtime turn failed.");
    }
  } finally {
    clearTimeout(timeout);
    probe.stop();
    if (!options.keepHome) {
      await removeRuntimeHome(runtimeHome);
    }
    printSummary({
      completedTurn,
      homeKept: options.keepHome,
      options,
      phases: probe.phases,
      runtimeHome,
      stderrTail: probe.stderrTail,
      thread,
      turnStart,
    });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Runtime probe failed.");
  process.exit(1);
});
