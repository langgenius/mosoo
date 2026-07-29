import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseRuntimeBenchmarkFixture } from "../lib/cold-start-benchmark";
import {
  RUNTIME_E2E_EXPECTED_OUTPUT,
  RUNTIME_E2E_PROMPT,
  RUNTIME_E2E_SYSTEM_PROMPT,
  sha256Text,
} from "../lib/runtime-e2e-workload";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";

  if (value.length === 0) {
    throw new Error(`Runtime E2E provider-direct benchmark requires ${name}.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function main(): Promise<void> {
  const apiKey = requireEnv("DEEPSEEK_API_KEY");
  const fixturePath = requireEnv("MOSOO_E2E_RUNTIME_FIXTURE_INPUT");
  const outputPath = requireEnv("MOSOO_E2E_PROVIDER_DIRECT_OUTPUT");
  const fixture = parseRuntimeBenchmarkFixture(JSON.parse(await readFile(fixturePath, "utf8")));
  const inheritedEnv = Object.fromEntries(
    [
      "ALL_PROXY",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "LANG",
      "LC_ALL",
      "NODE_EXTRA_CA_CERTS",
      "NODE_USE_ENV_PROXY",
      "NO_PROXY",
      "SSL_CERT_FILE",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "all_proxy",
      "http_proxy",
      "https_proxy",
      "no_proxy",
    ].flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );

  if (fixture.providerId !== "deepseek" || fixture.runtimeId !== "acp-fallback") {
    throw new Error("Runtime E2E provider-direct benchmark requires a DeepSeek ACP fixture.");
  }

  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const child = Bun.spawn(["bun", "apps/driver/bench/ttft-bench.ts"], {
    cwd: repoRoot,
    env: {
      ...inheritedEnv,
      DEEPSEEK_API_KEY: apiKey,
      HOME: process.env["HOME"] ?? "",
      PATH: process.env["PATH"] ?? "",
      TMPDIR: process.env["TMPDIR"] ?? "/tmp",
      TTFT_CUSTOM_EXPECT: RUNTIME_E2E_EXPECTED_OUTPUT,
      TTFT_CUSTOM_PROMPT: RUNTIME_E2E_PROMPT,
      TTFT_CUSTOM_SYSTEM_PROMPT: RUNTIME_E2E_SYSTEM_PROMPT,
      TTFT_OPENCODE_API_KEY_ENV: "DEEPSEEK_API_KEY",
      TTFT_OPENCODE_MODEL: fixture.model,
      TTFT_OPENCODE_PROVIDER: fixture.providerId,
      TTFT_OUTPUT: outputPath,
      TTFT_RUNTIMES: "opencode",
      TTFT_SCENARIOS: "custom",
      TTFT_STAMP: process.env["MOSOO_E2E_GIT_COMMIT"]?.trim() || "runtime-e2e",
      TTFT_TRIALS: process.env["MOSOO_E2E_PROVIDER_DIRECT_SAMPLES"]?.trim() || "4",
    },
    stderr: "inherit",
    stdout: "inherit",
  });

  delete process.env["DEEPSEEK_API_KEY"];

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Runtime E2E provider-direct benchmark exited with ${exitCode}.`);
  }

  const artifact: unknown = JSON.parse(await readFile(outputPath, "utf8"));
  if (!isRecord(artifact)) {
    throw new Error("Runtime E2E provider-direct artifact must be an object.");
  }
  const cells = artifact["cells"];
  const cell = Array.isArray(cells) && cells.length === 1 && isRecord(cells[0]) ? cells[0] : null;

  if (
    artifact["schemaVersion"] !== "mosoo.driver-ttft.v2" ||
    cell === null ||
    cell["providerId"] !== fixture.providerId ||
    cell["runtimeId"] !== fixture.runtimeId ||
    cell["model"] !== fixture.model ||
    cell["promptSha256"] !== sha256Text(RUNTIME_E2E_PROMPT) ||
    cell["systemPromptSha256"] !== sha256Text(RUNTIME_E2E_SYSTEM_PROMPT) ||
    cell["expectedOutputSha256"] !== sha256Text(RUNTIME_E2E_EXPECTED_OUTPUT) ||
    cell["outputValidation"] !== "exact"
  ) {
    throw new Error("Runtime E2E provider-direct artifact provenance did not match the fixture.");
  }
}

await main();
