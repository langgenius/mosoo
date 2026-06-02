import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  materializeOpenAiApiKeyAuthState,
  materializeOpenAiModelProviderConfig,
} from "../src/runtimes/openai/auth-state";

let runtimeHomes: string[] = [];

async function createRuntimeHome(): Promise<string> {
  const runtimeHome = await mkdtemp(join(tmpdir(), "mosoo-openai-auth-"));
  runtimeHomes.push(runtimeHome);
  return runtimeHome;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${label} to be an object.`);
  }

  return value as Record<string, unknown>;
}

async function readGeneratedConfig(path: string): Promise<Record<string, unknown>> {
  return requireRecord(Bun.TOML.parse(await readFile(path, "utf8")), "generated config");
}

function expectDisabledRuntimeFeatures(config: Record<string, unknown>): void {
  expect(requireRecord(config["features"], "runtime features")).toMatchObject({
    plugins: false,
    remote_plugin: false,
    tool_suggest: false,
  });
}

afterEach(async () => {
  await Promise.all(
    runtimeHomes.map((runtimeHome) => rm(runtimeHome, { force: true, recursive: true })),
  );
  runtimeHomes = [];
});

describe("OpenAI app-server auth state", () => {
  test("skips unchanged API key auth writes", async () => {
    const runtimeHome = await createRuntimeHome();
    const input = {
      env: {
        OPENAI_API_KEY: "openai-key",
      },
      runtimeHome,
    };

    await expect(materializeOpenAiApiKeyAuthState(input)).resolves.toMatchObject({
      hasApiKey: true,
      written: true,
    });
    await expect(materializeOpenAiApiKeyAuthState(input)).resolves.toMatchObject({
      hasApiKey: true,
      written: false,
    });
  });

  test("writes model provider config for OpenAI-compatible credentials", async () => {
    const runtimeHome = await createRuntimeHome();

    const result = await materializeOpenAiModelProviderConfig({
      env: {
        OPENAI_COMPATIBLE_API_KEY: "compat-key",
        OPENAI_COMPATIBLE_BASE_URL: "https://compat.example/v1",
      },
      provider: "openai-compatible",
      runtimeHome,
    });

    expect(result.written).toBe(true);
    const config = await readGeneratedConfig(result.configTomlPath);
    const modelProviders = requireRecord(config["model_providers"], "model providers");

    expect(config["model_provider"]).toBe("openai-compatible");
    expect(modelProviders["openai-compatible"]).toEqual({
      base_url: "https://compat.example/v1",
      env_key: "OPENAI_COMPATIBLE_API_KEY",
      name: "Mosoo OpenAI-Compatible",
      wire_api: "responses",
    });
    expectDisabledRuntimeFeatures(config);
  });

  test("writes generated config for built-in OpenAI auth", async () => {
    const runtimeHome = await createRuntimeHome();

    const result = await materializeOpenAiModelProviderConfig({
      env: {
        OPENAI_API_KEY: "openai-key",
      },
      provider: "openai",
      runtimeHome,
    });

    expect(result.written).toBe(true);
    const config = await readGeneratedConfig(result.configTomlPath);

    expect(config["model_provider"]).toBeUndefined();
    expect(config["model_providers"]).toBeUndefined();
    expectDisabledRuntimeFeatures(config);
  });

  test("skips unchanged generated config writes", async () => {
    const runtimeHome = await createRuntimeHome();
    const input = {
      env: {
        OPENAI_API_KEY: "openai-key",
      },
      provider: "openai",
      runtimeHome,
    };

    await expect(materializeOpenAiModelProviderConfig(input)).resolves.toMatchObject({
      written: true,
    });
    await expect(materializeOpenAiModelProviderConfig(input)).resolves.toMatchObject({
      written: false,
    });
  });

  test("fails OpenAI-compatible provider config when credentials are incomplete", async () => {
    const runtimeHome = await createRuntimeHome();

    await expect(
      materializeOpenAiModelProviderConfig({
        env: {
          OPENAI_COMPATIBLE_API_KEY: "compat-key",
        },
        provider: "openai-compatible",
        runtimeHome,
      }),
    ).rejects.toThrow(
      "OpenAI-compatible provider requires OPENAI_COMPATIBLE_API_KEY and OPENAI_COMPATIBLE_BASE_URL.",
    );
  });
});
