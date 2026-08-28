#!/usr/bin/env bun
import type { BunRuntime } from "../../../config/bun-script-types";
import { resolveMacDockerHost } from "./dev-local-docker-host";
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
const SCRUB_HOST_PROXY_ENV_KEY = "MOSOO_API_DEV_SCRUB_HOST_PROXY";
const USE_DEFAULT_DOCKER_ENV_KEY = "MOSOO_API_DEV_USE_DEFAULT_DOCKER";
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

function applyLocalDockerHost(env: NodeJS.ProcessEnv): void {
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

  const localDockerHost = resolveMacDockerHost(process.platform, process.env.HOME);

  if (localDockerHost === null) {
    return;
  }

  const inheritedDockerHost = env[DOCKER_HOST_ENV_KEY]?.trim();
  env[DOCKER_HOST_ENV_KEY] = localDockerHost.host;
  const dockerHostMessage =
    inheritedDockerHost !== undefined && inheritedDockerHost.length > 0
      ? `[mosoo/api] Overriding inherited ${DOCKER_HOST_ENV_KEY}=${inheritedDockerHost} with ${localDockerHost.name} socket for wrangler dev: ${localDockerHost.host}.`
      : `[mosoo/api] Using ${localDockerHost.name} socket for wrangler dev: ${localDockerHost.host}.`;

  writeStderr(
    [
      dockerHostMessage,
      `Set ${DEV_DOCKER_HOST_ENV_KEY}=unix:///path/to/docker.sock to choose a different engine.`,
      `Set ${USE_DEFAULT_DOCKER_ENV_KEY}=1 to keep the current Docker context.`,
    ].join(" "),
  );
}

function createWranglerDevEnv(): NodeJS.ProcessEnv {
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

  applyLocalDockerHost(env);

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

function readNonEmptyEnvValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();

    if (value !== undefined && value.length > 0) {
      return value;
    }
  }

  return undefined;
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

const wranglerEnv = createWranglerDevEnv();
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
  ],
  {
    cwd: apiDir,
    env: wranglerEnv,
  },
);
process.exit(getExitCode(wranglerResult));
