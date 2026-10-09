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
const RUNTIME_CONTROL_ORIGIN_ENV_KEY = "MOSOO_RUNTIME_CONTROL_ORIGIN";
const USE_DEFAULT_DOCKER_ENV_KEY = "MOSOO_API_DEV_USE_DEFAULT_DOCKER";
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
  const env = { ...process.env };

  applyLocalDockerHost(env);

  return env;
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
  const runtimeProxyHost = process.platform === "linux" ? "172.17.0.1" : "host.docker.internal";

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
): Promise<number> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  return child.exited;
}

const buildExitCode = await run(vpBin, ["run", "--filter", "agent-driver", "build"], {
  cwd: repoRoot,
});
if (buildExitCode !== 0) {
  process.exit(buildExitCode);
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
const wranglerExitCode = await run(
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
process.exit(wranglerExitCode);
