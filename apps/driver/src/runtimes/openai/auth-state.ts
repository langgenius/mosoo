import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isTruthy } from "../../core/truthiness";
interface OpenAiApiKeyAuthStateInput {
  env: NodeJS.ProcessEnv;
  runtimeHome: string;
}

interface OpenAiApiKeyAuthStateResult {
  authJsonPath: string;
  hasApiKey: boolean;
  written: boolean;
}

interface OpenAiModelProviderConfigInput {
  env: NodeJS.ProcessEnv;
  provider: string;
  runtimeHome: string;
}

interface OpenAiModelProviderConfigResult {
  configTomlPath: string;
  provider: string;
  written: boolean;
}

const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible";
const OPENAI_COMPATIBLE_API_KEY_ENV_NAME = "OPENAI_COMPATIBLE_API_KEY";
const OPENAI_COMPATIBLE_BASE_URL_ENV_NAME = "OPENAI_COMPATIBLE_BASE_URL";
const DISABLED_RUNTIME_FEATURES = ["plugins", "remote_plugin", "tool_suggest"] as const;

function readOpenAiApiKey(env: NodeJS.ProcessEnv): string | null {
  const value = env["OPENAI_API_KEY"]?.trim();
  return value ?? null;
}

function readEnvVar(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return isTruthy(value) ? value : null;
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

async function writeFileIfChanged(
  path: string,
  contents: string,
  options?: { mode?: number },
): Promise<boolean> {
  const existing = await readFile(path, "utf8").catch(() => null);

  if (existing === contents) {
    if (options?.mode !== undefined) {
      const fileStat = await stat(path);
      const currentMode = fileStat.mode & 0o777;

      if (currentMode !== options.mode) {
        await chmod(path, options.mode);
      }
    }

    return false;
  }

  await writeFile(path, contents, { encoding: "utf8" });

  if (options?.mode !== undefined) {
    await chmod(path, options.mode);
  }

  return true;
}

export async function materializeOpenAiApiKeyAuthState(
  input: OpenAiApiKeyAuthStateInput,
): Promise<OpenAiApiKeyAuthStateResult> {
  const authJsonPath = join(input.runtimeHome, "auth.json");
  const apiKey = readOpenAiApiKey(input.env);

  if (!isTruthy(apiKey)) {
    return {
      authJsonPath,
      hasApiKey: false,
      written: false,
    };
  }

  await mkdir(input.runtimeHome, { recursive: true });
  const written = await writeFileIfChanged(
    authJsonPath,
    `${JSON.stringify(
      {
        OPENAI_API_KEY: apiKey,
        auth_mode: "apikey",
        last_refresh: null,
        tokens: null,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  return {
    authJsonPath,
    hasApiKey: true,
    written,
  };
}

export async function materializeOpenAiModelProviderConfig(
  input: OpenAiModelProviderConfigInput,
): Promise<OpenAiModelProviderConfigResult> {
  const configTomlPath = join(input.runtimeHome, "config.toml");

  const lines = [
    "[features]",
    ...DISABLED_RUNTIME_FEATURES.map((feature) => `${feature} = false`),
    "",
  ];

  if (input.provider === OPENAI_COMPATIBLE_PROVIDER_ID) {
    const apiKey = readEnvVar(input.env, OPENAI_COMPATIBLE_API_KEY_ENV_NAME);
    const baseUrl = readEnvVar(input.env, OPENAI_COMPATIBLE_BASE_URL_ENV_NAME);

    if (apiKey === null || baseUrl === null) {
      throw new Error(
        "OpenAI-compatible provider requires OPENAI_COMPATIBLE_API_KEY and OPENAI_COMPATIBLE_BASE_URL.",
      );
    }

    lines.unshift(
      `model_provider = ${toTomlString(input.provider)}`,
      "",
      `[model_providers.${toTomlString(input.provider)}]`,
      'name = "Mosoo OpenAI-Compatible"',
      `base_url = ${toTomlString(baseUrl)}`,
      `env_key = ${toTomlString(OPENAI_COMPATIBLE_API_KEY_ENV_NAME)}`,
      'wire_api = "responses"',
      "",
    );
  }

  await mkdir(input.runtimeHome, { recursive: true });
  const written = await writeFileIfChanged(configTomlPath, lines.join("\n"));

  return {
    configTomlPath,
    provider: input.provider,
    written,
  };
}
