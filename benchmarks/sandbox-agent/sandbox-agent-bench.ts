#!/usr/bin/env bun
import type { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

type Command = "preflight" | "run";
type ScenarioMode = "create_thread" | "followup" | "interrupt" | "lifecycle" | "stream";

interface CliOptions {
  agentId: string;
  baseUrl: string;
  cloudflare: "optional" | "required" | "skip";
  concurrency: number;
  envFile: string;
  interactive: boolean;
  outputDir: string;
  pat: string;
  pollMs: number;
  repeat: number;
  scenarios: string[];
  timeoutMs: number;
}

interface ScenarioDefinition {
  category: string;
  description: string;
  expectedToken: string;
  id: string;
  mode: ScenarioMode;
  prompt: string;
  setupPrompt?: string;
  setupToken?: string;
  title: string;
}

interface PromptCatalog {
  defaultScenarios: string[];
  scenarios: ScenarioDefinition[];
  version: number;
}

interface HttpJsonResult {
  elapsedMs: number;
  ok: boolean;
  payload: unknown;
  status: number;
}

interface PublicThreadSummary {
  id: string;
  last_run_id?: string | null;
  status?: string | null;
}

interface PublicThreadRunSummary {
  id: string;
  status: string;
}

interface PublicThreadEventLogEntry {
  content: string;
  durationMs: number | null;
  id: string;
  occurredAt: string;
  status: string;
  tokens: number | null;
  type: string;
}

interface TraceEvent {
  contentPreview: string;
  durationMs: number | null;
  elapsedMs: number;
  id: string;
  status: string;
  tokens: number | null;
  type: string;
}

interface PollResult {
  completedMs: number | null;
  firstAssistantTextMs: number | null;
  seenEventIds: string[];
  terminalRunStatus: string | null;
  tokenCompletedMs: number | null;
  trace: TraceEvent[];
}

interface CaseResult {
  attempt: number;
  category: string;
  completedMs: number | null;
  createThreadMs: number | null;
  error: string | null;
  firstAssistantTextMs: number | null;
  mode: ScenarioMode;
  scenarioId: string;
  scenarioTitle: string;
  sendEventAcceptedMs: number | null;
  success: boolean;
  terminalRunStatus: string | null;
  threadId: string | null;
  tokenCompletedMs: number | null;
  trace: TraceEvent[];
}

interface PreflightCheck {
  detail: string;
  name: string;
  required: boolean;
  status: "ok" | "warn" | "fail" | "skip";
}

interface BenchmarkRunResult {
  agentId: string;
  baseUrl: string;
  cases: CaseResult[];
  cloudflareCheck: string;
  createdAt: string;
  promptCatalogVersion: number;
  runId: string;
}

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = dirname(CURRENT_FILE);
const REPO_ROOT = resolvePath(CURRENT_DIR, "../..");
const PROMPTS_PATH = join(CURRENT_DIR, "prompts.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_OUTPUT_ROOT = join(REPO_ROOT, "outputs", "sandbox-agent-bench");
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_MS = 500;
const TERMINAL_GRACE_MS = 30_000;

function roundMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nowRunId(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function printUsage(): void {
  console.log(`Sandbox Agent benchmark

Usage:
  bun benchmarks/sandbox-agent/sandbox-agent-bench.ts preflight [options]
  bun benchmarks/sandbox-agent/sandbox-agent-bench.ts run [options]

Options:
  --base-url <url>          Local Mosoo API origin. Default: ${DEFAULT_BASE_URL}
  --agent-id <id>           Published simple Agent ID.
  --pat <token>             Mosoo Personal Access Token. Prefer env or hidden prompt.
  --env-file <path>         Optional env file to load before reading env vars.
  --scenario <id>           Scenario to run. Repeat flag for multiple. Defaults to prompts.json defaults.
  --repeat <n>              Attempts per scenario. Default: 1.
  --concurrency <n>         Concurrent case count. Default: 1.
  --output-dir <path>       Artifact directory. Default: outputs/sandbox-agent-bench/<run-id>.
  --timeout-ms <n>          Per-turn timeout. Default: ${DEFAULT_TIMEOUT_MS}.
  --poll-ms <n>             Thread event poll interval. Default: ${DEFAULT_POLL_MS}.
  --require-cloudflare      Fail preflight if wrangler whoami is unavailable.
  --skip-cloudflare         Skip wrangler whoami.
  --non-interactive         Fail instead of prompting for missing required values.
  -h, --help                Show this help.

Environment:
  MOSOO_BENCH_BASE_URL
  MOSOO_BENCH_AGENT_ID
  MOSOO_BENCH_PAT
  MOSOO_BENCH_OUTPUT_DIR
  MOSOO_BENCH_REPEAT
  MOSOO_BENCH_CONCURRENCY
`);
}

function takeValue(
  argv: string[],
  index: number,
  flag: string,
): { nextIndex: number; value: string } {
  const inlinePrefix = `${flag}=`;
  const current = argv[index] ?? "";

  if (current.startsWith(inlinePrefix)) {
    return { nextIndex: index, value: current.slice(inlinePrefix.length) };
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }

  return { nextIndex: index + 1, value };
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return Number.parseInt(value, 10);
}

function parseArgs(argv: string[]): { command: Command; options: Partial<CliOptions> } {
  const args = [...argv];
  const first = args.shift();

  if (first === "-h" || first === "--help") {
    printUsage();
    process.exit(0);
  }

  const command: Command = first === "run" || first === "preflight" ? first : "preflight";
  const rest = first === command ? args : argv;
  const options: Partial<CliOptions> = {};
  const scenarios: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? "";

    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--non-interactive") {
      options.interactive = false;
      continue;
    }

    if (arg === "--require-cloudflare") {
      options.cloudflare = "required";
      continue;
    }

    if (arg === "--skip-cloudflare") {
      options.cloudflare = "skip";
      continue;
    }

    if (arg === "--scenario" || arg.startsWith("--scenario=")) {
      const read = takeValue(rest, index, "--scenario");
      scenarios.push(read.value);
      index = read.nextIndex;
      continue;
    }

    if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      const read = takeValue(rest, index, "--base-url");
      options.baseUrl = read.value;
      index = read.nextIndex;
      continue;
    }

    if (arg === "--agent-id" || arg.startsWith("--agent-id=")) {
      const read = takeValue(rest, index, "--agent-id");
      options.agentId = read.value;
      index = read.nextIndex;
      continue;
    }

    if (arg === "--pat" || arg.startsWith("--pat=")) {
      const read = takeValue(rest, index, "--pat");
      options.pat = read.value;
      index = read.nextIndex;
      continue;
    }

    if (arg === "--env-file" || arg.startsWith("--env-file=")) {
      const read = takeValue(rest, index, "--env-file");
      options.envFile = read.value;
      index = read.nextIndex;
      continue;
    }

    if (arg === "--output-dir" || arg.startsWith("--output-dir=")) {
      const read = takeValue(rest, index, "--output-dir");
      options.outputDir = read.value;
      index = read.nextIndex;
      continue;
    }

    if (arg === "--repeat" || arg.startsWith("--repeat=")) {
      const read = takeValue(rest, index, "--repeat");
      options.repeat = parsePositiveInteger(read.value, "--repeat");
      index = read.nextIndex;
      continue;
    }

    if (arg === "--concurrency" || arg.startsWith("--concurrency=")) {
      const read = takeValue(rest, index, "--concurrency");
      options.concurrency = parsePositiveInteger(read.value, "--concurrency");
      index = read.nextIndex;
      continue;
    }

    if (arg === "--timeout-ms" || arg.startsWith("--timeout-ms=")) {
      const read = takeValue(rest, index, "--timeout-ms");
      options.timeoutMs = parsePositiveInteger(read.value, "--timeout-ms");
      index = read.nextIndex;
      continue;
    }

    if (arg === "--poll-ms" || arg.startsWith("--poll-ms=")) {
      const read = takeValue(rest, index, "--poll-ms");
      options.pollMs = parsePositiveInteger(read.value, "--poll-ms");
      index = read.nextIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (scenarios.length > 0) {
    options.scenarios = scenarios;
  }

  return { command, options };
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();

  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return null;
  }

  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
  if (!match?.[1]) {
    throw new Error(`Invalid env line: ${line}`);
  }

  let value = match[2] ?? "";

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key: match[1], value };
}

async function loadEnvFile(path: string): Promise<void> {
  if (path.length === 0 || !existsSync(path)) {
    return;
  }

  const content = await readFile(path, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);

    if (parsed && process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function promptPlain(label: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(label);
    process.stdin.resume();
    process.stdin.once("data", (data: Buffer) => {
      resolve(data.toString("utf8").trim());
    });
  });
}

function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return promptPlain(label);
  }

  return new Promise((resolve) => {
    let value = "";

    const cleanup = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.off("data", onData);
      process.stdout.write("\n");
    };

    const onData = (data: Buffer): void => {
      const text = data.toString("utf8");

      if (text === "\u0003") {
        cleanup();
        process.exit(130);
      }

      if (text === "\r" || text === "\n") {
        cleanup();
        resolve(value.trim());
        return;
      }

      if (text === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += text;
    };

    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function maskSecret(value: string): string {
  if (value.length === 0) {
    return "missing";
  }

  if (value.length <= 8) {
    return "present";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function printHeader(title: string): void {
  console.log("");
  console.log("=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

function printCredentialNotice(): void {
  printHeader("Credential preflight");
  console.log("Local Mosoo controls the run. Cloudflare online Workers/Sandbox execute it.");
  console.log("Secrets are accepted from env or hidden prompt and are never written to reports.");
  console.log("");
}

async function resolveConfig(
  command: Command,
  cliOptions: Partial<CliOptions>,
  catalog: PromptCatalog,
): Promise<CliOptions> {
  const envFile = cliOptions.envFile ?? process.env["MOSOO_BENCH_ENV_FILE"] ?? "";
  await loadEnvFile(envFile);

  const interactive =
    cliOptions.interactive ??
    (process.env["MOSOO_BENCH_NON_INTERACTIVE"] !== "1" && process.stdin.isTTY);
  const runId = nowRunId();
  const outputDir =
    cliOptions.outputDir ??
    process.env["MOSOO_BENCH_OUTPUT_DIR"] ??
    join(DEFAULT_OUTPUT_ROOT, runId);
  const config: CliOptions = {
    agentId: cliOptions.agentId ?? process.env["MOSOO_BENCH_AGENT_ID"] ?? "",
    baseUrl: cliOptions.baseUrl ?? process.env["MOSOO_BENCH_BASE_URL"] ?? DEFAULT_BASE_URL,
    cloudflare:
      cliOptions.cloudflare ??
      (process.env["MOSOO_BENCH_REQUIRE_CLOUDFLARE"] === "1" ? "required" : "optional"),
    concurrency:
      cliOptions.concurrency ??
      parsePositiveInteger(process.env["MOSOO_BENCH_CONCURRENCY"] ?? "1", "concurrency"),
    envFile,
    interactive,
    outputDir,
    pat: cliOptions.pat ?? process.env["MOSOO_BENCH_PAT"] ?? "",
    pollMs:
      cliOptions.pollMs ??
      parsePositiveInteger(process.env["MOSOO_BENCH_POLL_MS"] ?? `${DEFAULT_POLL_MS}`, "pollMs"),
    repeat:
      cliOptions.repeat ?? parsePositiveInteger(process.env["MOSOO_BENCH_REPEAT"] ?? "1", "repeat"),
    scenarios: cliOptions.scenarios ?? catalog.defaultScenarios,
    timeoutMs:
      cliOptions.timeoutMs ??
      parsePositiveInteger(
        process.env["MOSOO_BENCH_TIMEOUT_MS"] ?? `${DEFAULT_TIMEOUT_MS}`,
        "timeoutMs",
      ),
  };

  const missingRequired =
    command === "run"
      ? config.agentId.length === 0 || config.pat.length === 0 || config.baseUrl.length === 0
      : false;

  if (!interactive && missingRequired) {
    throw new Error(
      [
        "Missing required benchmark credentials.",
        "Set MOSOO_BENCH_BASE_URL, MOSOO_BENCH_AGENT_ID, and MOSOO_BENCH_PAT.",
      ].join("\n"),
    );
  }

  if (interactive && command === "run") {
    printCredentialNotice();

    if (config.baseUrl.length === 0) {
      config.baseUrl = await promptPlain(`Local Mosoo API origin [${DEFAULT_BASE_URL}]: `);
      if (config.baseUrl.length === 0) {
        config.baseUrl = DEFAULT_BASE_URL;
      }
    }

    if (config.agentId.length === 0) {
      config.agentId = await promptPlain("Published simple Agent ID: ");
    }

    if (config.pat.length === 0) {
      config.pat = await promptSecret("Mosoo PAT (hidden): ");
    }
  }

  return config;
}

function joinApiPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/$/u, "");
  const nextPath =
    basePath.endsWith("/api") && path.startsWith("/api/")
      ? `${basePath}${path.slice("/api".length)}`
      : `${basePath}${path}`;

  url.pathname = nextPath.replace(/\/{2,}/gu, "/");
  url.search = "";
  return url.toString();
}

async function requestJson(
  config: Pick<CliOptions, "baseUrl" | "pat" | "timeoutMs">,
  input: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
    path: string;
  },
): Promise<HttpJsonResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...input.headers,
  };

  if (config.pat.length > 0) {
    headers["Authorization"] = `Bearer ${config.pat}`;
  }

  if (input.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(joinApiPath(config.baseUrl, input.path), {
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      headers,
      method: input.method ?? "GET",
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text.length === 0 ? null : JSON.parse(text);

    return {
      elapsedMs: roundMs(performance.now() - startedAt),
      ok: response.ok,
      payload,
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function requireJson(
  config: Pick<CliOptions, "baseUrl" | "pat" | "timeoutMs">,
  input: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
    path: string;
  },
  action: string,
): Promise<HttpJsonResult> {
  const response = await requestJson(config, input);

  if (!response.ok) {
    throw new Error(`${action} failed: ${response.status} ${JSON.stringify(response.payload)}`);
  }

  return response;
}

function readThreadSummary(payload: unknown): PublicThreadSummary {
  if (!isRecord(payload) || !isRecord(payload["thread"])) {
    throw new Error("Response did not include thread.");
  }

  const id = readString(payload["thread"]["id"]);
  if (id === null) {
    throw new Error("Response thread did not include id.");
  }

  return {
    id,
    last_run_id: readString(payload["thread"]["last_run_id"]),
    status: readString(payload["thread"]["status"]),
  };
}

function readRunSummary(payload: unknown): PublicThreadRunSummary | null {
  if (!isRecord(payload) || !isRecord(payload["run"])) {
    return null;
  }

  const id = readString(payload["run"]["id"]);
  const status = readString(payload["run"]["status"]);

  return id === null || status === null ? null : { id, status };
}

function createIdempotencyKey(scenarioId: string, attempt: number): string {
  return `sandbox-bench-${scenarioId}-${attempt}-${crypto.randomUUID()}`;
}

function renderPrompt(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function createLongContext(): string {
  return Array.from({ length: 80 }, (_, index) => {
    const lineNumber = String(index + 1).padStart(2, "0");
    return `context-line-${lineNumber}: benchmark filler text for sandbox latency measurement.`;
  }).join("\n");
}

async function createThread(
  config: CliOptions,
  scenario: ScenarioDefinition,
  attempt: number,
  prompt: string,
): Promise<{ elapsedMs: number; run: PublicThreadRunSummary | null; threadId: string }> {
  const response = await requireJson(
    config,
    {
      body: {
        client_external_ref: `sandbox-bench:${scenario.id}:${attempt}:${Date.now()}`,
        input: {
          content: [{ text: prompt, type: "text" }],
          type: "user.message",
        },
      },
      headers: {
        "Idempotency-Key": createIdempotencyKey(scenario.id, attempt),
      },
      method: "POST",
      path: `/api/v1/agents/${encodeURIComponent(config.agentId)}/threads`,
    },
    "create thread",
  );
  const thread = readThreadSummary(response.payload);

  return {
    elapsedMs: response.elapsedMs,
    run: readRunSummary(response.payload),
    threadId: thread.id,
  };
}

async function sendThreadEvent(
  config: CliOptions,
  scenario: ScenarioDefinition,
  attempt: number,
  threadId: string,
  event: Record<string, unknown>,
): Promise<{ elapsedMs: number; run: PublicThreadRunSummary | null }> {
  const response = await requireJson(
    config,
    {
      body: { events: [event] },
      headers: {
        "Idempotency-Key": createIdempotencyKey(`${scenario.id}-event`, attempt),
      },
      method: "POST",
      path: `/api/v1/threads/${encodeURIComponent(threadId)}/events`,
    },
    "send thread event",
  );
  const run =
    isRecord(response.payload) && Array.isArray(response.payload["events"])
      ? readRunSummary(response.payload["events"][0])
      : null;

  return { elapsedMs: response.elapsedMs, run };
}

function readPublicThreadEvent(value: unknown): PublicThreadEventLogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value["id"]);
  const type = readString(value["type"]);
  const content = readString(value["content"]);
  const occurredAt = readString(value["occurredAt"]);
  const status = readString(value["status"]);

  if (id === null || type === null || content === null || occurredAt === null || status === null) {
    return null;
  }

  return {
    content,
    durationMs: typeof value["durationMs"] === "number" ? value["durationMs"] : null,
    id,
    occurredAt,
    status,
    tokens: typeof value["tokens"] === "number" ? value["tokens"] : null,
    type,
  };
}

function terminalStatusFromType(type: string): string | null {
  if (!type.startsWith("run.")) {
    return null;
  }

  const status = type.slice("run.".length);
  return ["cancelled", "completed", "expired", "failed"].includes(status) ? status : null;
}

function toTraceEvent(event: PublicThreadEventLogEntry, elapsedMs: number): TraceEvent {
  return {
    contentPreview: event.content.slice(0, 160),
    durationMs: event.durationMs,
    elapsedMs,
    id: event.id,
    status: event.status,
    tokens: event.tokens,
    type: event.type,
  };
}

async function listThreadEvents(
  config: CliOptions,
  threadId: string,
): Promise<PublicThreadEventLogEntry[]> {
  const response = await requireJson(
    config,
    {
      path: `/api/v1/threads/${encodeURIComponent(threadId)}/events?limit=1000`,
    },
    "list thread events",
  );

  if (!isRecord(response.payload) || !Array.isArray(response.payload["events"])) {
    throw new Error("Thread events response did not include events.");
  }

  return response.payload["events"].flatMap((event) => {
    const parsed = readPublicThreadEvent(event);
    return parsed === null ? [] : [parsed];
  });
}

async function pollThreadForToken(
  config: CliOptions,
  input: {
    expectedToken: string;
    initialSeenEventIds?: Iterable<string>;
    startedAt: number;
    threadId: string;
  },
): Promise<PollResult> {
  const deadline = input.startedAt + config.timeoutMs;
  const seenEventIds = new Set(input.initialSeenEventIds ?? []);
  const trace: TraceEvent[] = [];
  let assistantText = "";
  let firstAssistantTextMs: number | null = null;
  let tokenCompletedMs: number | null = null;
  let terminalRunStatus: string | null = null;
  let completedMs: number | null = null;

  while (performance.now() < deadline && tokenCompletedMs === null) {
    const events = await listThreadEvents(config, input.threadId);

    for (const event of events) {
      if (seenEventIds.has(event.id)) {
        continue;
      }

      seenEventIds.add(event.id);
      const elapsedMs = roundMs(performance.now() - input.startedAt);
      trace.push(toTraceEvent(event, elapsedMs));
      const terminalStatus = terminalStatusFromType(event.type);

      if (terminalStatus !== null) {
        terminalRunStatus = terminalStatus;
        completedMs = elapsedMs;
      }

      if (event.type === "run.failed") {
        throw new Error("Run failed before producing the expected token.");
      }

      if (!event.type.startsWith("agent.message") || event.content.trim().length === 0) {
        continue;
      }

      if (firstAssistantTextMs === null) {
        firstAssistantTextMs = elapsedMs;
      }

      assistantText += event.content;

      if (assistantText.includes(input.expectedToken)) {
        tokenCompletedMs = elapsedMs;
        break;
      }
    }

    if (tokenCompletedMs === null) {
      await Bun.sleep(config.pollMs);
    }
  }

  if (tokenCompletedMs === null) {
    throw new Error(`Expected token ${input.expectedToken} was not observed.`);
  }

  const terminalDeadline = performance.now() + TERMINAL_GRACE_MS;
  while (performance.now() < terminalDeadline && terminalRunStatus === null) {
    const events = await listThreadEvents(config, input.threadId);

    for (const event of events) {
      if (seenEventIds.has(event.id)) {
        continue;
      }

      seenEventIds.add(event.id);
      const elapsedMs = roundMs(performance.now() - input.startedAt);
      trace.push(toTraceEvent(event, elapsedMs));
      const terminalStatus = terminalStatusFromType(event.type);

      if (terminalStatus !== null) {
        terminalRunStatus = terminalStatus;
        completedMs = elapsedMs;
        break;
      }
    }

    if (terminalRunStatus === null) {
      await Bun.sleep(config.pollMs);
    }
  }

  return {
    completedMs,
    firstAssistantTextMs,
    seenEventIds: [...seenEventIds],
    terminalRunStatus,
    tokenCompletedMs,
    trace,
  };
}

function createEmptyFailure(
  scenario: ScenarioDefinition,
  attempt: number,
  error: unknown,
  partial?: Partial<CaseResult>,
): CaseResult {
  return {
    attempt,
    category: scenario.category,
    completedMs: null,
    createThreadMs: null,
    error: error instanceof Error ? error.message : String(error),
    firstAssistantTextMs: null,
    mode: scenario.mode,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    sendEventAcceptedMs: null,
    success: false,
    terminalRunStatus: null,
    threadId: null,
    tokenCompletedMs: null,
    trace: [],
    ...partial,
  };
}

async function runCreateThreadScenario(
  config: CliOptions,
  scenario: ScenarioDefinition,
  attempt: number,
): Promise<CaseResult> {
  const startedAt = performance.now();
  let threadId: string | null = null;

  try {
    const prompt = renderPrompt(scenario.prompt, {
      expectedToken: scenario.expectedToken,
      longContext: createLongContext(),
    });
    const created = await createThread(config, scenario, attempt, prompt);
    threadId = created.threadId;
    const poll = await pollThreadForToken(config, {
      expectedToken: scenario.expectedToken,
      startedAt,
      threadId,
    });

    return {
      attempt,
      category: scenario.category,
      completedMs: poll.completedMs,
      createThreadMs: created.elapsedMs,
      error: null,
      firstAssistantTextMs: poll.firstAssistantTextMs,
      mode: scenario.mode,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      sendEventAcceptedMs: null,
      success: true,
      terminalRunStatus: poll.terminalRunStatus,
      threadId,
      tokenCompletedMs: poll.tokenCompletedMs,
      trace: poll.trace,
    };
  } catch (error) {
    return createEmptyFailure(scenario, attempt, error, {
      createThreadMs: null,
      threadId,
    });
  }
}

async function runFollowupScenario(
  config: CliOptions,
  scenario: ScenarioDefinition,
  attempt: number,
): Promise<CaseResult> {
  let threadId: string | null = null;
  let createThreadMs: number | null = null;

  try {
    if (!scenario.setupPrompt || !scenario.setupToken) {
      throw new Error("Follow-up scenario is missing setupPrompt or setupToken.");
    }

    const setupStartedAt = performance.now();
    const setupPrompt = renderPrompt(scenario.setupPrompt, {
      setupToken: scenario.setupToken,
    });
    const created = await createThread(config, scenario, attempt, setupPrompt);
    createThreadMs = created.elapsedMs;
    threadId = created.threadId;
    const setupPoll = await pollThreadForToken(config, {
      expectedToken: scenario.setupToken,
      startedAt: setupStartedAt,
      threadId,
    });
    const followupStartedAt = performance.now();
    const followupPrompt = renderPrompt(scenario.prompt, {
      expectedToken: scenario.expectedToken,
      longContext: createLongContext(),
    });
    const sent = await sendThreadEvent(config, scenario, attempt, threadId, {
      clientRequestId: `sandbox-bench-${scenario.id}-${attempt}-${Date.now()}`,
      text: followupPrompt,
      type: "user_message",
    });
    const followupPoll = await pollThreadForToken(config, {
      expectedToken: scenario.expectedToken,
      initialSeenEventIds: setupPoll.seenEventIds,
      startedAt: followupStartedAt,
      threadId,
    });

    return {
      attempt,
      category: scenario.category,
      completedMs: followupPoll.completedMs,
      createThreadMs,
      error: null,
      firstAssistantTextMs: followupPoll.firstAssistantTextMs,
      mode: scenario.mode,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      sendEventAcceptedMs: sent.elapsedMs,
      success: true,
      terminalRunStatus: followupPoll.terminalRunStatus,
      threadId,
      tokenCompletedMs: followupPoll.tokenCompletedMs,
      trace: [...setupPoll.trace, ...followupPoll.trace],
    };
  } catch (error) {
    return createEmptyFailure(scenario, attempt, error, {
      createThreadMs,
      threadId,
    });
  }
}

async function runInterruptScenario(
  config: CliOptions,
  scenario: ScenarioDefinition,
  attempt: number,
): Promise<CaseResult> {
  const startedAt = performance.now();
  let threadId: string | null = null;
  let createThreadMs: number | null = null;

  try {
    const prompt = renderPrompt(scenario.prompt, {
      expectedToken: scenario.expectedToken,
      longContext: createLongContext(),
    });
    const created = await createThread(config, scenario, attempt, prompt);
    createThreadMs = created.elapsedMs;
    threadId = created.threadId;
    await Bun.sleep(1_000);
    const interrupted = await sendThreadEvent(config, scenario, attempt, threadId, {
      runId: created.run?.id ?? null,
      type: "user_interrupt",
    });
    const poll = await pollThreadForToken(config, {
      expectedToken: scenario.expectedToken,
      startedAt,
      threadId,
    });

    return {
      attempt,
      category: scenario.category,
      completedMs: poll.completedMs,
      createThreadMs,
      error: null,
      firstAssistantTextMs: poll.firstAssistantTextMs,
      mode: scenario.mode,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      sendEventAcceptedMs: interrupted.elapsedMs,
      success: true,
      terminalRunStatus: poll.terminalRunStatus,
      threadId,
      tokenCompletedMs: poll.tokenCompletedMs,
      trace: poll.trace,
    };
  } catch (error) {
    return createEmptyFailure(scenario, attempt, error, {
      createThreadMs,
      threadId,
    });
  }
}

async function runLifecycleScenario(
  config: CliOptions,
  scenario: ScenarioDefinition,
  attempt: number,
): Promise<CaseResult> {
  const base = await runCreateThreadScenario(config, scenario, attempt);

  if (!base.success || base.threadId === null) {
    return base;
  }

  const lifecycleStartedAt = performance.now();

  try {
    await requireJson(
      config,
      { path: `/api/v1/threads/${encodeURIComponent(base.threadId)}` },
      "retrieve thread",
    );
    await requireJson(
      config,
      { path: `/api/v1/agents/${encodeURIComponent(config.agentId)}/threads?archived=false` },
      "list threads",
    );
    await requireJson(
      config,
      {
        method: "POST",
        path: `/api/v1/threads/${encodeURIComponent(base.threadId)}/archive`,
      },
      "archive thread",
    );
    await requireJson(
      config,
      {
        method: "POST",
        path: `/api/v1/threads/${encodeURIComponent(base.threadId)}/unarchive`,
      },
      "unarchive thread",
    );
    await requireJson(
      config,
      {
        method: "DELETE",
        path: `/api/v1/threads/${encodeURIComponent(base.threadId)}`,
      },
      "delete thread",
    );

    return {
      ...base,
      completedMs: roundMs(performance.now() - lifecycleStartedAt),
      mode: "lifecycle",
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

function parseSseEvents(buffer: string): { events: unknown[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts.flatMap((part) => {
    const dataLines = part
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    const data = dataLines.join("\n");

    if (data.length === 0 || data === "[DONE]") {
      return [];
    }

    try {
      return [JSON.parse(data)];
    } catch {
      return [];
    }
  });

  return { events, rest };
}

async function streamThreadForToken(
  config: CliOptions,
  input: {
    expectedToken: string;
    startedAt: number;
    threadId: string;
  },
): Promise<PollResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const response = await fetch(
    joinApiPath(
      config.baseUrl,
      `/api/v1/threads/${encodeURIComponent(input.threadId)}/events/stream?limit=1000`,
    ),
    {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${config.pat}`,
      },
      signal: controller.signal,
    },
  );

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    throw new Error(`stream thread events failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const trace: TraceEvent[] = [];
  const seenEventIds = new Set<string>();
  let rest = "";
  let assistantText = "";
  let firstAssistantTextMs: number | null = null;
  let tokenCompletedMs: number | null = null;
  let terminalRunStatus: string | null = null;
  let completedMs: number | null = null;

  try {
    while (tokenCompletedMs === null) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      const parsed = parseSseEvents(`${rest}${decoder.decode(chunk.value, { stream: true })}`);
      rest = parsed.rest;

      for (const rawEvent of parsed.events) {
        const event = readPublicThreadEvent(rawEvent);

        if (event === null || seenEventIds.has(event.id)) {
          continue;
        }

        seenEventIds.add(event.id);
        const elapsedMs = roundMs(performance.now() - input.startedAt);
        trace.push(toTraceEvent(event, elapsedMs));
        const terminalStatus = terminalStatusFromType(event.type);

        if (terminalStatus !== null) {
          terminalRunStatus = terminalStatus;
          completedMs = elapsedMs;
        }

        if (event.type === "run.failed") {
          throw new Error("Run failed before producing the expected token.");
        }

        if (!event.type.startsWith("agent.message") || event.content.trim().length === 0) {
          continue;
        }

        if (firstAssistantTextMs === null) {
          firstAssistantTextMs = elapsedMs;
        }

        assistantText += event.content;

        if (assistantText.includes(input.expectedToken)) {
          tokenCompletedMs = elapsedMs;
          break;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    clearTimeout(timeout);
  }

  if (tokenCompletedMs === null) {
    throw new Error(`Stream did not include ${input.expectedToken}.`);
  }

  return {
    completedMs,
    firstAssistantTextMs,
    seenEventIds: [...seenEventIds],
    terminalRunStatus,
    tokenCompletedMs,
    trace,
  };
}

async function runStreamScenario(
  config: CliOptions,
  scenario: ScenarioDefinition,
  attempt: number,
): Promise<CaseResult> {
  const startedAt = performance.now();
  let threadId: string | null = null;

  try {
    const prompt = renderPrompt(scenario.prompt, {
      expectedToken: scenario.expectedToken,
      longContext: createLongContext(),
    });
    const created = await createThread(config, scenario, attempt, prompt);
    threadId = created.threadId;
    const poll = await streamThreadForToken(config, {
      expectedToken: scenario.expectedToken,
      startedAt,
      threadId,
    });

    return {
      attempt,
      category: scenario.category,
      completedMs: poll.completedMs,
      createThreadMs: created.elapsedMs,
      error: null,
      firstAssistantTextMs: poll.firstAssistantTextMs,
      mode: scenario.mode,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      sendEventAcceptedMs: null,
      success: true,
      terminalRunStatus: poll.terminalRunStatus,
      threadId,
      tokenCompletedMs: poll.tokenCompletedMs,
      trace: poll.trace,
    };
  } catch (error) {
    return createEmptyFailure(scenario, attempt, error, {
      threadId,
    });
  }
}

async function runScenario(
  config: CliOptions,
  scenario: ScenarioDefinition,
  attempt: number,
): Promise<CaseResult> {
  switch (scenario.mode) {
    case "create_thread":
      return runCreateThreadScenario(config, scenario, attempt);
    case "followup":
      return runFollowupScenario(config, scenario, attempt);
    case "interrupt":
      return runInterruptScenario(config, scenario, attempt);
    case "lifecycle":
      return runLifecycleScenario(config, scenario, attempt);
    case "stream":
      return runStreamScenario(config, scenario, attempt);
  }
}

function commandStatus(command: string, args: string[]): PreflightCheck {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    return {
      detail: result.error.message,
      name: `${command} ${args.join(" ")}`,
      required: false,
      status: "warn",
    };
  }

  if (result.status !== 0) {
    return {
      detail: (result.stderr || result.stdout).trim(),
      name: `${command} ${args.join(" ")}`,
      required: false,
      status: "warn",
    };
  }

  return {
    detail: result.stdout.trim().split("\n")[0] ?? "ok",
    name: `${command} ${args.join(" ")}`,
    required: false,
    status: "ok",
  };
}

async function runPreflight(config: CliOptions): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];

  checks.push({
    detail: config.baseUrl,
    name: "Local Mosoo API origin",
    required: true,
    status: config.baseUrl.length > 0 ? "ok" : "fail",
  });
  checks.push({
    detail: config.agentId.length > 0 ? config.agentId : "Set MOSOO_BENCH_AGENT_ID.",
    name: "Published simple Agent ID",
    required: true,
    status: config.agentId.length > 0 ? "ok" : "fail",
  });
  checks.push({
    detail: maskSecret(config.pat),
    name: "Mosoo PAT",
    required: true,
    status: config.pat.length > 0 ? "ok" : "fail",
  });

  try {
    const health = await requestJson(config, { path: "/api/health" });
    checks.push({
      detail: health.ok ? JSON.stringify(health.payload) : `HTTP ${health.status}`,
      name: "Local Mosoo API health",
      required: true,
      status: health.ok ? "ok" : "fail",
    });
  } catch (error) {
    checks.push({
      detail: error instanceof Error ? error.message : String(error),
      name: "Local Mosoo API health",
      required: true,
      status: "fail",
    });
  }

  try {
    const openApi = await requestJson(config, { path: "/api/v1/openapi.json" });
    checks.push({
      detail: openApi.ok ? "openapi available" : `HTTP ${openApi.status}`,
      name: "Public API route",
      required: true,
      status: openApi.ok ? "ok" : "fail",
    });
  } catch (error) {
    checks.push({
      detail: error instanceof Error ? error.message : String(error),
      name: "Public API route",
      required: true,
      status: "fail",
    });
  }

  if (config.agentId.length > 0 && config.pat.length > 0) {
    try {
      const auth = await requestJson(config, {
        path: `/api/v1/agents/${encodeURIComponent(config.agentId)}/threads?archived=false`,
      });
      checks.push({
        detail: auth.ok ? "PAT can list Agent threads" : `HTTP ${auth.status}`,
        name: "PAT and Agent access",
        required: true,
        status: auth.ok ? "ok" : "fail",
      });
    } catch (error) {
      checks.push({
        detail: error instanceof Error ? error.message : String(error),
        name: "PAT and Agent access",
        required: true,
        status: "fail",
      });
    }
  }

  checks.push(commandStatus("mosoo", ["version"]));

  if (config.cloudflare === "skip") {
    checks.push({
      detail: "Skipped by --skip-cloudflare.",
      name: "Cloudflare Wrangler identity",
      required: false,
      status: "skip",
    });
  } else {
    const wrangler = commandStatus("wrangler", ["whoami"]);
    checks.push({
      ...wrangler,
      detail:
        wrangler.status === "ok"
          ? wrangler.detail
          : `${wrangler.detail || "not authenticated"}; run wrangler login for Cloudflare visibility.`,
      name: "Cloudflare Wrangler identity",
      required: config.cloudflare === "required",
      status:
        config.cloudflare === "required" && wrangler.status !== "ok" ? "fail" : wrangler.status,
    });
  }

  return checks;
}

function printChecks(checks: PreflightCheck[]): void {
  printHeader("Preflight result");

  for (const check of checks) {
    const marker =
      check.status === "ok"
        ? "[ok]"
        : check.status === "skip"
          ? "[skip]"
          : check.status === "warn"
            ? "[warn]"
            : "[fail]";
    const required = check.required ? "required" : "optional";
    console.log(`${marker} ${check.name} (${required})`);
    console.log(`     ${check.detail}`);
  }
}

function preflightHasFailure(checks: PreflightCheck[]): boolean {
  return checks.some((check) => check.status === "fail");
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] ?? null;
}

function formatNullableMs(value: number | null): string {
  return value === null ? "" : `${value}`;
}

function csvEscape(value: string | number | boolean | null): string {
  if (value === null) {
    return "";
  }

  const text = String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderCsv(cases: CaseResult[]): string {
  const headers = [
    "scenarioId",
    "attempt",
    "mode",
    "success",
    "threadId",
    "createThreadMs",
    "sendEventAcceptedMs",
    "firstAssistantTextMs",
    "tokenCompletedMs",
    "completedMs",
    "terminalRunStatus",
    "error",
  ];
  const rows = cases.map((result) =>
    [
      result.scenarioId,
      result.attempt,
      result.mode,
      result.success,
      result.threadId,
      result.createThreadMs,
      result.sendEventAcceptedMs,
      result.firstAssistantTextMs,
      result.tokenCompletedMs,
      result.completedMs,
      result.terminalRunStatus,
      result.error,
    ]
      .map(csvEscape)
      .join(","),
  );

  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}

function scenarioSummaryRows(cases: CaseResult[]): string {
  const scenarioIds = [...new Set(cases.map((result) => result.scenarioId))];

  return scenarioIds
    .map((scenarioId) => {
      const scenarioCases = cases.filter((result) => result.scenarioId === scenarioId);
      const successes = scenarioCases.filter((result) => result.success).length;
      const firstText = scenarioCases.flatMap((result) =>
        result.firstAssistantTextMs === null ? [] : [result.firstAssistantTextMs],
      );
      const token = scenarioCases.flatMap((result) =>
        result.tokenCompletedMs === null ? [] : [result.tokenCompletedMs],
      );

      return [
        `| \`${scenarioId}\``,
        `${scenarioCases.length}`,
        `${successes}`,
        formatNullableMs(percentile(firstText, 50)),
        formatNullableMs(percentile(firstText, 95)),
        formatNullableMs(percentile(token, 50)),
        formatNullableMs(percentile(token, 95)),
        "|",
      ].join(" | ");
    })
    .join("\n");
}

function renderSummary(result: BenchmarkRunResult): string {
  const successes = result.cases.filter((item) => item.success).length;
  const firstText = result.cases.flatMap((item) =>
    item.firstAssistantTextMs === null ? [] : [item.firstAssistantTextMs],
  );
  const token = result.cases.flatMap((item) =>
    item.tokenCompletedMs === null ? [] : [item.tokenCompletedMs],
  );
  const failures = result.cases.filter((item) => !item.success);

  return `# Sandbox Agent Benchmark Summary

## Run Summary

| Field | Value |
| --- | --- |
| Run ID | ${result.runId} |
| Created At | ${result.createdAt} |
| Local Mosoo base URL | ${result.baseUrl} |
| Agent ID | ${result.agentId} |
| Agent profile | Default/simple Agent, no Skills/MCP/Spaces |
| Cloudflare account check | ${result.cloudflareCheck} |
| Total cases | ${result.cases.length} |
| Success rate | ${successes}/${result.cases.length} |
| p50 first assistant text ms | ${formatNullableMs(percentile(firstText, 50))} |
| p95 first assistant text ms | ${formatNullableMs(percentile(firstText, 95))} |
| p50 token complete ms | ${formatNullableMs(percentile(token, 50))} |
| p95 token complete ms | ${formatNullableMs(percentile(token, 95))} |

## Scenario Results

| Scenario | Attempts | Success | p50 first text ms | p95 first text ms | p50 token ms | p95 token ms | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${scenarioSummaryRows(result.cases)}

## Failures

| Scenario | Thread ID | Error |
| --- | --- | --- |
${
  failures.length === 0
    ? "| none |  |  |"
    : failures
        .map(
          (failure) =>
            `| \`${failure.scenarioId}\` | ${failure.threadId ?? ""} | ${failure.error ?? ""} |`,
        )
        .join("\n")
}
`;
}

async function writeArtifacts(result: BenchmarkRunResult, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(outputDir, "results.csv"), renderCsv(result.cases));
  await writeFile(join(outputDir, "summary.md"), renderSummary(result));
}

async function loadPromptCatalog(): Promise<PromptCatalog> {
  const payload = JSON.parse(await readFile(PROMPTS_PATH, "utf8")) as unknown;

  if (!isRecord(payload) || !Array.isArray(payload["scenarios"])) {
    throw new Error("Invalid prompts.json.");
  }

  return payload as PromptCatalog;
}

function selectScenarios(catalog: PromptCatalog, scenarioIds: string[]): ScenarioDefinition[] {
  const byId = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));
  return scenarioIds.map((scenarioId) => {
    const scenario = byId.get(scenarioId);

    if (!scenario) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }

    return scenario;
  });
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();

      if (item === undefined) {
        return;
      }

      await worker(item);
    }
  });

  await Promise.all(workers);
}

async function runBenchmark(
  config: CliOptions,
  catalog: PromptCatalog,
): Promise<BenchmarkRunResult> {
  const checks = await runPreflight(config);
  printChecks(checks);

  if (preflightHasFailure(checks)) {
    throw new Error("Preflight failed. Fix required credentials or local service health first.");
  }

  const scenarios = selectScenarios(catalog, config.scenarios);
  const work = scenarios.flatMap((scenario) =>
    Array.from({ length: config.repeat }, (_, index) => ({
      attempt: index + 1,
      scenario,
    })),
  );
  const cases: CaseResult[] = [];

  printHeader("Benchmark run");
  console.log(`Scenarios: ${scenarios.map((scenario) => scenario.id).join(", ")}`);
  console.log(`Repeat: ${config.repeat}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Output: ${config.outputDir}`);

  await runWithConcurrency(work, config.concurrency, async (item) => {
    const result = await runScenario(config, item.scenario, item.attempt);
    cases.push(result);
    console.log(
      `${result.success ? "[ok]" : "[fail]"} ${result.scenarioId} #${result.attempt} ${
        result.tokenCompletedMs === null ? "" : `${result.tokenCompletedMs}ms`
      } ${result.error ?? ""}`,
    );
  });

  const wrangler = checks.find((check) => check.name === "Cloudflare Wrangler identity");

  return {
    agentId: config.agentId,
    baseUrl: config.baseUrl,
    cases: cases.toSorted((left, right) =>
      left.scenarioId === right.scenarioId
        ? left.attempt - right.attempt
        : left.scenarioId.localeCompare(right.scenarioId),
    ),
    cloudflareCheck: wrangler ? `${wrangler.status}: ${wrangler.detail}` : "not checked",
    createdAt: new Date().toISOString(),
    promptCatalogVersion: catalog.version,
    runId: config.outputDir.split("/").at(-1) ?? nowRunId(),
  };
}

async function main(): Promise<void> {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    const catalog = await loadPromptCatalog();
    const config = await resolveConfig(command, options, catalog);

    if (command === "preflight") {
      const checks = await runPreflight(config);
      printChecks(checks);

      if (preflightHasFailure(checks)) {
        process.exitCode = 1;
      }

      return;
    }

    const result = await runBenchmark(config, catalog);
    await writeArtifacts(result, config.outputDir);
    printHeader("Artifacts");
    console.log(join(config.outputDir, "summary.md"));
    console.log(join(config.outputDir, "results.json"));
    console.log(join(config.outputDir, "results.csv"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
