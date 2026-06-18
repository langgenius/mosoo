import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LoadRepoEnvOptions {
  readonly env?: NodeJS.ProcessEnv;
}

const LOCAL_PROXY_BYPASS = "localhost,127.0.0.1,::1";

function ensureLocalProxyBypass(env: NodeJS.ProcessEnv): void {
  if ((env["NO_PROXY"]?.trim() ?? "").length === 0) {
    env["NO_PROXY"] = LOCAL_PROXY_BYPASS;
  }

  if ((env["no_proxy"]?.trim() ?? "").length === 0) {
    env["no_proxy"] = LOCAL_PROXY_BYPASS;
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function loadRepoEnv(options: LoadRepoEnvOptions = {}): void {
  const env = options.env ?? process.env;
  const configuredEnvPath = env["MOSOO_ENV_FILE"] ?? env["MOSOO_E2E_ENV_FILE"];
  const envPath = configuredEnvPath ? resolve(configuredEnvPath) : resolve(".env");

  if (existsSync(envPath)) {
    let lineNumber = 0;

    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
      lineNumber += 1;
      const trimmed = line.trim();

      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }

      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);

      if (match === null) {
        throw new Error(`Invalid E2E env line ${lineNumber} in ${envPath}.`);
      }

      const key = match[1];
      const rawValue = match[2] ?? "";

      if (key === undefined) {
        throw new Error(`Invalid E2E env line ${lineNumber} in ${envPath}.`);
      }

      if (env[key] !== undefined) {
        continue;
      }

      env[key] = unquoteEnvValue(rawValue);
    }
  }

  ensureLocalProxyBypass(env);
}
