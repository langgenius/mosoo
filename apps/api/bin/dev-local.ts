#!/usr/bin/env bun
import type { BunRuntime } from "../../../config/bun-script-types";
import {
  createProviderFetchProxyVarArgs,
  startLocalProviderFetchProxy,
} from "./dev-local-provider-proxy";

declare const Bun: BunRuntime;

const scriptDir = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/\/$/u, "");
const apiDir = `${scriptDir}/..`;
const repoRoot = `${apiDir}/../..`;
const vpBin = `${repoRoot}/node_modules/.bin/vp`;
const wranglerBin = `${apiDir}/node_modules/.bin/wrangler`;
const DOCKER_HOST_ENV_KEY = "DOCKER_HOST";
const DEV_DOCKER_HOST_ENV_KEY = "MOSOO_API_DEV_DOCKER_HOST";
const DEV_RUNTIME_PROXY_HOST_ENV_KEY = "MOSOO_API_DEV_RUNTIME_PROXY_HOST";
const RUNTIME_CONTROL_ORIGIN_ENV_KEY = "MOSOO_RUNTIME_CONTROL_ORIGIN";
const LARK_SIDECAR_DISABLED_ENV_KEY = "MOSOO_LARK_SIDECAR_DISABLED";
const LARK_SIDECAR_SECRET_ENV_KEY = "MOSOO_LARK_SIDECAR_SECRET";
const SCRUB_HOST_PROXY_ENV_KEY = "MOSOO_API_DEV_SCRUB_HOST_PROXY";
const USE_DEFAULT_DOCKER_ENV_KEY = "MOSOO_API_DEV_USE_DEFAULT_DOCKER";
const SCHEDULED_HANDLER_PUMP_INTERVAL_ENV_KEY = "MOSOO_API_DEV_SCHEDULED_PUMP_INTERVAL_MS";
const SCHEDULED_HANDLER_PUMP_DEFAULT_INTERVAL_MS = 60_000;
const SCHEDULED_HANDLER_PUMP_BOOT_DELAY_MS = 5_000;
const SCHEDULED_HANDLER_PUMP_MIN_INTERVAL_MS = 1_000;
const HOST_PROXY_ENV_KEYS = ["http_proxy", "https_proxy", "all_proxy", "no_proxy"] as const;
const RUNTIME_NO_PROXY_DEFAULTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

const RUNTIME_PROXY_VAR_MAPPINGS = [
  {
    hostKeys: ["http_proxy", "HTTP_PROXY"],
    runtimeBinding: "MOSOO_RUNTIME_HTTP_PROXY",
  },
  {
    hostKeys: ["https_proxy", "HTTPS_PROXY"],
    runtimeBinding: "MOSOO_RUNTIME_HTTPS_PROXY",
  },
  {
    hostKeys: ["all_proxy", "ALL_PROXY"],
    runtimeBinding: "MOSOO_RUNTIME_ALL_PROXY",
  },
] as const;

interface RunResult {
  code: number;
}

function getExitCode(result: RunResult): number {
  return result.code;
}

async function getMacDockerDesktopHost(): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  const home = process.env.HOME?.trim();
  if (home === undefined || home.length === 0) {
    return null;
  }

  const socketPath = `${home}/.docker/run/docker.sock`;

  if (!(await Bun.file(socketPath).exists())) {
    return null;
  }

  return `unix://${socketPath}`;
}

async function applyLocalDockerHost(env: NodeJS.ProcessEnv): Promise<void> {
  const configuredDockerHost = env[DEV_DOCKER_HOST_ENV_KEY]?.trim();

  if (configuredDockerHost !== undefined && configuredDockerHost.length > 0) {
    env[DOCKER_HOST_ENV_KEY] = configuredDockerHost;
    writeStderr(
      `[mosoo/api] Using ${DEV_DOCKER_HOST_ENV_KEY} for wrangler dev: ${configuredDockerHost}`,
    );
    return;
  }

  if (env[USE_DEFAULT_DOCKER_ENV_KEY] === "1") {
    const inheritedDockerHost = env[DOCKER_HOST_ENV_KEY]?.trim();
    if (inheritedDockerHost !== undefined && inheritedDockerHost.length > 0) {
      writeStderr(
        `[mosoo/api] Keeping inherited ${DOCKER_HOST_ENV_KEY} for wrangler dev: ${inheritedDockerHost}`,
      );
    }
    return;
  }

  const dockerDesktopHost = await getMacDockerDesktopHost();

  if (dockerDesktopHost === null) {
    return;
  }

  const inheritedDockerHost = env[DOCKER_HOST_ENV_KEY]?.trim();
  env[DOCKER_HOST_ENV_KEY] = dockerDesktopHost;
  const dockerHostMessage =
    inheritedDockerHost !== undefined && inheritedDockerHost.length > 0
      ? `[mosoo/api] Overriding inherited ${DOCKER_HOST_ENV_KEY}=${inheritedDockerHost} with Docker Desktop socket for wrangler dev: ${dockerDesktopHost}.`
      : `[mosoo/api] Using Docker Desktop socket for wrangler dev: ${dockerDesktopHost}.`;

  writeStderr(
    [
      dockerHostMessage,
      `Set ${DEV_DOCKER_HOST_ENV_KEY}=unix:///path/to/docker.sock to choose a different engine.`,
      `Set ${USE_DEFAULT_DOCKER_ENV_KEY}=1 to keep the current Docker context.`,
    ].join(" "),
  );
}

async function createWranglerDevEnv(): Promise<NodeJS.ProcessEnv> {
  const hostEnv = getHostEnv();
  const scrubHostProxy =
    hostEnv[SCRUB_HOST_PROXY_ENV_KEY] === "1" && hostEnv.MOSOO_API_DEV_USE_HOST_PROXY !== "1";
  const env = scrubHostProxy ? omitHostProxyEnv(hostEnv) : { ...hostEnv };
  const scrubbedKeys = HOST_PROXY_ENV_KEYS.filter((key) => {
    const value = hostEnv[key];
    return typeof value === "string" && value.length > 0;
  });

  if (scrubHostProxy && scrubbedKeys.length > 0 && env.MOSOO_API_DEV_LOG_PROXY_SCRUB !== "0") {
    writeStderr(
      [
        "[mosoo/api] Scrubbed host proxy env before wrangler dev:",
        scrubbedKeys.join(", "),
        `Unset ${SCRUB_HOST_PROXY_ENV_KEY} or set MOSOO_API_DEV_USE_HOST_PROXY=1 to keep control-plane provider egress aligned with the host.`,
      ].join(" "),
    );
  } else if (scrubbedKeys.length > 0 && env.MOSOO_API_DEV_LOG_PROXY_SCRUB !== "0") {
    writeStderr(
      [
        "[mosoo/api] Keeping host proxy env for wrangler dev:",
        scrubbedKeys.join(", "),
        `Set ${SCRUB_HOST_PROXY_ENV_KEY}=1 to scrub it for a clean-network run.`,
      ].join(" "),
    );
  }

  await applyLocalDockerHost(env);

  return env;
}

function getHostEnv(): NodeJS.ProcessEnv {
  const { env } = process;
  return env;
}

function isHostProxyEnvKey(key: string): key is (typeof HOST_PROXY_ENV_KEYS)[number] {
  return HOST_PROXY_ENV_KEYS.some((candidate) => candidate === key);
}

function omitHostProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (!isHostProxyEnvKey(key)) {
      next[key] = value;
    }
  }

  return next;
}

function getRuntimeProxyHost(env: NodeJS.ProcessEnv): string {
  const explicit = env[DEV_RUNTIME_PROXY_HOST_ENV_KEY]?.trim();

  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }

  return process.platform === "linux" ? "172.17.0.1" : "host.docker.internal";
}

function toContainerReachableProxyUrl(rawValue: string, runtimeProxyHost: string): string {
  const value = rawValue.trim();

  if (value.length === 0) {
    return value;
  }

  try {
    const url = new URL(value);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") {
      url.hostname = runtimeProxyHost;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function toRuntimeNoProxy(value: string | undefined): string {
  const entries = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  for (const entry of RUNTIME_NO_PROXY_DEFAULTS) {
    entries.add(entry);
  }

  return [...entries].join(",");
}

function createRuntimeProxyVarArgs(env: NodeJS.ProcessEnv): string[] {
  const args: string[] = [];
  const forwardedKeys: string[] = [];
  const runtimeProxyHost = getRuntimeProxyHost(env);

  for (const mapping of RUNTIME_PROXY_VAR_MAPPINGS) {
    const value = readNonEmptyEnvValue(env, mapping.hostKeys);

    if (value === undefined) {
      continue;
    }

    args.push(
      "--var",
      `${mapping.runtimeBinding}:${toContainerReachableProxyUrl(value, runtimeProxyHost)}`,
    );
    forwardedKeys.push(mapping.hostKeys[0]);
  }

  if (forwardedKeys.length === 0) {
    return args;
  }

  args.push(
    "--var",
    `MOSOO_RUNTIME_NO_PROXY:${toRuntimeNoProxy(readNonEmptyEnvValue(env, ["no_proxy", "NO_PROXY"]))}`,
  );
  writeStderr(
    `[mosoo/api] Forwarding host proxy env to runtime sandbox via ${runtimeProxyHost}: ${forwardedKeys.join(", ")}`,
  );

  return args;
}

function createRuntimeControlOriginVarArgs(env: NodeJS.ProcessEnv): string[] {
  const value = env[RUNTIME_CONTROL_ORIGIN_ENV_KEY]?.trim();
  return value === undefined || value.length === 0
    ? []
    : ["--var", `${RUNTIME_CONTROL_ORIGIN_ENV_KEY}:${value}`];
}

function unquoteDevVarValue(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function readLocalDevVars(): Promise<Record<string, string>> {
  const devVarsPath = `${apiDir}/.dev.vars`;

  if (!(await Bun.file(devVarsPath).exists())) {
    return {};
  }

  const entries: Record<string, string> = {};
  const content = await Bun.file(devVarsPath).text();

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = unquoteDevVarValue(line.slice(separatorIndex + 1));
    entries[key] = value;
  }

  return entries;
}

function readNonEmptyEnvValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();

    if (value !== undefined && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

async function createWeChatIlinkBaseUrlVarArgs(env: NodeJS.ProcessEnv): Promise<string[]> {
  const devVars = await readLocalDevVars();
  const value =
    readNonEmptyEnvValue(env, ["WECHAT_ILINK_BASE_URL"]) ??
    readNonEmptyEnvValue(devVars, ["WECHAT_ILINK_BASE_URL"]);

  return typeof value === "string" && value.trim().length > 0
    ? ["--var", `WECHAT_ILINK_BASE_URL:${value.trim()}`]
    : [];
}

// Wrangler dev does not fire `[triggers] crons` automatically; cron-driven flows like
// channel_final_delivery_job stay queued until something POSTs `/cdn-cgi/handler/scheduled`.
// This pump mirrors the prod `* * * * *` cron locally so Slack/Discord/Lark/Telegram/WeChat
// replies drain without manual curls. Returns null when explicitly disabled.
function parseScheduledHandlerPumpIntervalMs(env: NodeJS.ProcessEnv): number | null {
  const raw = env[SCHEDULED_HANDLER_PUMP_INTERVAL_ENV_KEY]?.trim();
  if (raw === undefined || raw.length === 0) {
    return SCHEDULED_HANDLER_PUMP_DEFAULT_INTERVAL_MS;
  }
  if (raw === "0" || raw.toLowerCase() === "off") {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < SCHEDULED_HANDLER_PUMP_MIN_INTERVAL_MS) {
    return SCHEDULED_HANDLER_PUMP_DEFAULT_INTERVAL_MS;
  }
  return parsed;
}

function startScheduledHandlerPump(port: string, intervalMs: number): void {
  const url = `http://127.0.0.1:${port}/cdn-cgi/handler/scheduled`;
  let announced = false;

  const fire = async (): Promise<void> => {
    try {
      const response = await fetch(url, { method: "POST" });
      if (response.ok && !announced) {
        announced = true;
        writeStderr(
          `[mosoo/api] Local scheduled-handler pump active at ${url} every ${Math.round(intervalMs / 1000)}s. ` +
            `Mirrors the prod * * * * * cron so cron-picked channel queues drain locally. ` +
            `Set ${SCHEDULED_HANDLER_PUMP_INTERVAL_ENV_KEY}=off to disable.`,
        );
      }
    } catch {
      // wrangler is not listening yet; retry on the next tick
    }
  };

  setTimeout(() => {
    void fire();
    setInterval(() => void fire(), intervalMs);
  }, SCHEDULED_HANDLER_PUMP_BOOT_DELAY_MS);
}

// The official Lark long-connection SDK is Node-only, so local dev runs it in a
// sidecar process and authenticates loopback callbacks with a boot secret.
function shouldStartLarkSidecar(env: NodeJS.ProcessEnv): boolean {
  const raw = env[LARK_SIDECAR_DISABLED_ENV_KEY]?.trim().toLowerCase();
  return raw !== "1" && raw !== "true" && raw !== "yes";
}

function createLarkSidecarVarArgs(secret: string): string[] {
  return ["--var", `${LARK_SIDECAR_SECRET_ENV_KEY}:${secret}`];
}

function startLarkSidecar(input: {
  apiDir: string;
  env: NodeJS.ProcessEnv;
  secret: string;
  workerUrl: string;
}): void {
  const child = Bun.spawn([vpBin, "exec", "bun", "bin/lark-ws-sidecar.ts"], {
    cwd: input.apiDir,
    env: {
      ...input.env,
      MOSOO_API_BASE_URL: input.workerUrl,
      [LARK_SIDECAR_SECRET_ENV_KEY]: input.secret,
    },
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  void child.exited.then((code) => {
    if (code !== 0 && code !== 130 && code !== 143) {
      writeStderr(`[mosoo/api] Lark WebSocket sidecar exited unexpectedly (code=${code})`);
    }
  });

  process.on("exit", () => {
    try {
      child.kill();
    } catch {
      // best effort
    }
  });

  writeStderr(
    `[mosoo/api] Lark WebSocket sidecar started (pid=${child.pid ?? "?"}, worker=${input.workerUrl}). ` +
      `Set ${LARK_SIDECAR_DISABLED_ENV_KEY}=1 to disable.`,
  );
}

function resolveDevWebOrigin(env: NodeJS.ProcessEnv): string {
  const explicit = env.WEB_ORIGIN?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }

  const port = env.WEB_DEV_PORT?.trim() ?? "5173";
  return `http://localhost:${port}`;
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env ?? getHostEnv(),
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  return { code: await child.exited };
}

const buildResult = await run(vpBin, ["run", "--filter", "agent-driver", "build"], {
  cwd: repoRoot,
});
if (buildResult.code !== 0) {
  process.exit(getExitCode(buildResult));
}

const wranglerEnv = await createWranglerDevEnv();
const wranglerPort = wranglerEnv.WRANGLER_DEV_PORT?.trim() ?? "8787";
const webDevPort = wranglerEnv.WEB_DEV_PORT?.trim() ?? "5173";
const webOrigin = resolveDevWebOrigin(wranglerEnv);
const providerFetchProxy = await startLocalProviderFetchProxy(wranglerEnv);
const usingDefaultPorts = wranglerPort === "8787" && webDevPort === "5173";
for (const line of [
  "[mosoo/api] ┌──────────────────────────────────────────────────────────────",
  `[mosoo/api] │ Worktree dev port pair: web=:${webDevPort} · api=:${wranglerPort}`,
  `[mosoo/api] │ WEB_ORIGIN=${webOrigin}`,
  "[mosoo/api] └──────────────────────────────────────────────────────────────",
]) {
  writeStderr(line);
}
if (usingDefaultPorts) {
  writeStderr(
    "[mosoo/api] Default ports (5173/8787). If another local checkout is also running, " +
      "set WEB_DEV_PORT + WRANGLER_DEV_PORT for this shell to avoid " +
      "port collisions and CORS mismatches.",
  );
}
const scheduledPumpIntervalMs = parseScheduledHandlerPumpIntervalMs(wranglerEnv);
if (scheduledPumpIntervalMs !== null) {
  startScheduledHandlerPump(wranglerPort, scheduledPumpIntervalMs);
}
const larkSidecarEnabled = shouldStartLarkSidecar(wranglerEnv);
const larkSidecarSecret = larkSidecarEnabled ? crypto.randomUUID() : null;
if (larkSidecarEnabled && larkSidecarSecret) {
  startLarkSidecar({
    apiDir,
    env: wranglerEnv,
    secret: larkSidecarSecret,
    workerUrl: `http://127.0.0.1:${wranglerPort}`,
  });
}
const wranglerResult = await run(
  wranglerBin,
  [
    "dev",
    "--local",
    "--ip",
    "0.0.0.0",
    "--port",
    wranglerPort,
    "--var",
    `WEB_ORIGIN:${webOrigin}`,
    ...createProviderFetchProxyVarArgs(providerFetchProxy),
    ...createRuntimeControlOriginVarArgs(wranglerEnv),
    ...createRuntimeProxyVarArgs(wranglerEnv),
    ...(await createWeChatIlinkBaseUrlVarArgs(wranglerEnv)),
    ...(larkSidecarSecret ? createLarkSidecarVarArgs(larkSidecarSecret) : []),
  ],
  {
    cwd: apiDir,
    env: wranglerEnv,
  },
);
process.exit(getExitCode(wranglerResult));
