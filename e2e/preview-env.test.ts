import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function runEnvCommand(
  command: string,
  env: Record<string, string> = {},
): PreflightResult & {
  stdout: string;
} {
  const result = Bun.spawnSync({
    cmd: ["bash", "-c", `source ./e2e/preview-env.sh; ${command}`],
    env: {
      PATH: process.env["PATH"] ?? "",
      ...env,
    },
  });

  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

async function withEnvFile<T>(content: string, run: (path: string) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mosoo-e2e-env-"));
  const path = join(dir, ".env");

  try {
    await Bun.write(path, content);
    return await run(path);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("Preview live harness environment preflight", () => {
  test("loads repo env file values", async () => {
    const result = await withEnvFile(
      [
        "MOSOO_E2E_PROVIDER=anthropic",
        "MOSOO_E2E_PROVIDER_API_KEY='provider-key'",
        'MOSOO_E2E_BASE_URL="http://localhost:5174"',
        "WEB_DEV_PORT = 5174",
      ].join("\n"),
      (path) =>
        runEnvCommand(
          "load_repo_env; printf '%s\\n' \"$MOSOO_E2E_PROVIDER:$MOSOO_E2E_PROVIDER_API_KEY:$MOSOO_E2E_BASE_URL:$WEB_DEV_PORT\"",
          {
            MOSOO_ENV_FILE: path,
          },
        ),
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "anthropic:provider-key:http://localhost:5174:5174\n",
    });
  });

  test("keeps shell environment values over repo env file values", async () => {
    const result = await withEnvFile("MOSOO_E2E_PROVIDER=openai\n", (path) =>
      runEnvCommand("load_repo_env; printf '%s\\n' \"$MOSOO_E2E_PROVIDER\"", {
        MOSOO_ENV_FILE: path,
        MOSOO_E2E_PROVIDER: "anthropic",
      }),
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "anthropic\n",
    });
  });

  test("rejects invalid E2E env file lines", async () => {
    const result = await withEnvFile("not valid\n", (path) =>
      runEnvCommand("load_repo_env", {
        MOSOO_ENV_FILE: path,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid E2E env line 1 in ");
  });

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
