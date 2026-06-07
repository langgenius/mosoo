import { describe, expect, test } from "bun:test";

interface PreflightResult {
  exitCode: number;
  stderr: string;
}

function runPreflight(functionName: string, env: Record<string, string> = {}): PreflightResult {
  const result = Bun.spawnSync({
    cmd: ["bash", "-c", `source ./e2e/preview-env.sh; ${functionName}`],
    env: {
      PATH: process.env["PATH"] ?? "",
      ...env,
    },
  });

  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
  };
}

describe("Preview live harness environment preflight", () => {
  test("accepts the default OpenAI Preview smoke credential inputs", () => {
    expect(runPreflight("require_preview_smoke_env")).toEqual({
      exitCode: 1,
      stderr:
        "Preview live smoke requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_OPENAI_API_KEY for MOSOO_E2E_PROVIDER=openai.\n",
    });
    expect(
      runPreflight("require_preview_smoke_env", {
        MOSOO_E2E_PROVIDER_API_KEY: "placeholder",
      }).exitCode,
    ).toBe(0);
    expect(
      runPreflight("require_preview_smoke_env", {
        MOSOO_E2E_OPENAI_API_KEY: "placeholder",
      }).exitCode,
    ).toBe(0);
  });

  test("accepts Anthropic Preview smoke credential inputs", () => {
    expect(
      runPreflight("require_preview_smoke_env", {
        MOSOO_E2E_PROVIDER: "anthropic",
      }),
    ).toEqual({
      exitCode: 1,
      stderr:
        "Preview live smoke requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_ANTHROPIC_API_KEY for MOSOO_E2E_PROVIDER=anthropic.\n",
    });
    expect(
      runPreflight("require_preview_smoke_env", {
        MOSOO_E2E_ANTHROPIC_API_KEY: "placeholder",
        MOSOO_E2E_PROVIDER: "anthropic",
      }).exitCode,
    ).toBe(0);
  });

  test("rejects unsupported Preview smoke providers", () => {
    expect(
      runPreflight("require_preview_smoke_env", {
        MOSOO_E2E_PROVIDER: "other",
      }),
    ).toEqual({
      exitCode: 1,
      stderr:
        "Preview live smoke supports MOSOO_E2E_PROVIDER=openai or MOSOO_E2E_PROVIDER=anthropic.\n",
    });
  });

  test("accepts the default OpenAI latency credential inputs", () => {
    expect(runPreflight("require_preview_latency_env")).toEqual({
      exitCode: 1,
      stderr:
        "Preview latency requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_OPENAI_API_KEY for MOSOO_E2E_PROVIDER=openai.\n",
    });
    expect(
      runPreflight("require_preview_latency_env", {
        MOSOO_E2E_PROVIDER_API_KEY: "placeholder",
      }).exitCode,
    ).toBe(0);
    expect(
      runPreflight("require_preview_latency_env", {
        MOSOO_E2E_OPENAI_API_KEY: "placeholder",
      }).exitCode,
    ).toBe(0);
  });

  test("accepts Anthropic latency credential inputs", () => {
    expect(
      runPreflight("require_preview_latency_env", {
        MOSOO_E2E_PROVIDER: "anthropic",
      }),
    ).toEqual({
      exitCode: 1,
      stderr:
        "Preview latency requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_ANTHROPIC_API_KEY for MOSOO_E2E_PROVIDER=anthropic.\n",
    });
    expect(
      runPreflight("require_preview_latency_env", {
        MOSOO_E2E_ANTHROPIC_API_KEY: "placeholder",
        MOSOO_E2E_PROVIDER: "anthropic",
      }).exitCode,
    ).toBe(0);
  });

  test("rejects unsupported latency providers", () => {
    expect(
      runPreflight("require_preview_latency_env", {
        MOSOO_E2E_PROVIDER: "other",
      }),
    ).toEqual({
      exitCode: 1,
      stderr:
        "Preview latency supports MOSOO_E2E_PROVIDER=openai or MOSOO_E2E_PROVIDER=anthropic.\n",
    });
  });
});
