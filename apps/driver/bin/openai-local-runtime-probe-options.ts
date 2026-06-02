import { OPENAI_DEFAULT_MODEL_ID } from "@mosoo/contracts/models";

import {
  DEFAULT_EXECUTABLE,
  LOCAL_RUNTIME_EXECUTABLE_ENV,
} from "./openai-local-runtime-probe-types";
import type { RuntimeProbeOptions } from "./openai-local-runtime-probe-types";

interface ParseProbeOptionsInput {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

const PROBE_FLAGS = new Set(["--help", "--thread-only"]);

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return `${absolute ? "/" : ""}${segments.join("/")}` || ".";
}

function resolvePath(cwd: string, path: string): string {
  return normalizePath(path.startsWith("/") ? path : `${cwd}/${path}`);
}

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return fallback;
  }

  const parsed = Number(trimmed);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected ${name} to be a positive integer, got ${value}.`);
  }

  return parsed;
}

function parseEnvFlag(name: string, value: string | undefined): boolean {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed.length === 0 || trimmed === "0") {
    return false;
  }

  if (trimmed === "1") {
    return true;
  }

  throw new Error(`Expected ${name} to be 0 or 1, got ${value}.`);
}

export function parseProbeOptions(input: ParseProbeOptionsInput): RuntimeProbeOptions {
  for (const arg of input.args) {
    if (!PROBE_FLAGS.has(arg)) {
      throw new Error(`Unsupported flag: ${arg}. Run with --help for usage.`);
    }
  }

  const args = new Set(input.args);

  return {
    commandTimeoutMs: parsePositiveInt(
      "LOCAL_RUNTIME_COMMAND_TIMEOUT_MS",
      input.env["LOCAL_RUNTIME_COMMAND_TIMEOUT_MS"],
      120_000,
    ),
    cwd: resolvePath(input.cwd, input.env["LOCAL_RUNTIME_CWD"]?.trim() || input.cwd),
    executable:
      input.env[LOCAL_RUNTIME_EXECUTABLE_ENV]?.trim() ||
      input.env["LOCAL_RUNTIME_EXECUTABLE"]?.trim() ||
      DEFAULT_EXECUTABLE,
    keepHome: parseEnvFlag("LOCAL_RUNTIME_KEEP_HOME", input.env["LOCAL_RUNTIME_KEEP_HOME"]),
    model: input.env["OPENAI_MODEL"]?.trim() || OPENAI_DEFAULT_MODEL_ID,
    prompt: input.env["LOCAL_RUNTIME_PROMPT"]?.trim() || "Reply with exactly: ok",
    requestTimeoutMs: parsePositiveInt(
      "LOCAL_RUNTIME_REQUEST_TIMEOUT_MS",
      input.env["LOCAL_RUNTIME_REQUEST_TIMEOUT_MS"],
      60_000,
    ),
    showStderr: parseEnvFlag("LOCAL_RUNTIME_SHOW_STDERR", input.env["LOCAL_RUNTIME_SHOW_STDERR"]),
    threadOnly: args.has("--thread-only"),
  };
}

export function readProbeOptions(): RuntimeProbeOptions {
  const argv = process.argv.slice(2);
  const args = new Set(argv);

  if (args.has("--help")) {
    printHelp();
    process.exit(0);
  }

  return parseProbeOptions({
    args: argv,
    cwd: process.cwd(),
    env: process.env,
  });
}

function printHelp(): void {
  console.log(`Usage:
  OPENAI_API_KEY=... vp run --filter @mosoo/driver openai:local-probe

Optional:
  OPENAI_MODEL                         model id, defaults to repo OpenAI default
  LOCAL_RUNTIME_PROMPT                 turn input, defaults to a tiny reply request
  LOCAL_RUNTIME_CWD                    child cwd, defaults to current directory
  LOCAL_RUNTIME_EXECUTABLE             executable override
  ${LOCAL_RUNTIME_EXECUTABLE_ENV}      executable override used by the driver
  LOCAL_RUNTIME_REQUEST_TIMEOUT_MS     per-request timeout, default 60000
  LOCAL_RUNTIME_COMMAND_TIMEOUT_MS     whole probe timeout, default 120000
  LOCAL_RUNTIME_SHOW_STDERR=1          print stderr tail even on success
  LOCAL_RUNTIME_KEEP_HOME=1            keep temporary runtime home after exit

Flags:
  --thread-only                        stop after thread start
  --help                               print this help
`);
}
