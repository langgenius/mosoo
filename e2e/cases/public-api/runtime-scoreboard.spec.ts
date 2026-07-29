import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test } from "@playwright/test";

import { parseRuntimeBenchmarkFixture } from "../../lib/cold-start-benchmark";
import { loginWithMosooAiBackdoor } from "../../lib/dev-auth";
import {
  RUNTIME_E2E_BROWSER_EXCLUSION_POLICY,
  RUNTIME_E2E_BROWSER_FAILURE_POLICY,
  RUNTIME_E2E_BROWSER_SCHEMA,
  correlateRuntimeE2EBrowserRun,
  createRuntimeE2EBrowserProbe,
} from "../../lib/runtime-e2e-browser";
import type { RuntimeE2EBrowserCorrelatedRun } from "../../lib/runtime-e2e-browser";
import {
  RUNTIME_E2E_EXPECTED_OUTPUT,
  RUNTIME_E2E_PROMPT,
  RUNTIME_E2E_SYSTEM_PROMPT,
  sha256Text,
} from "../../lib/runtime-e2e-workload";
import { createLatencyProbe, sendMeasuredTurn } from "../../lib/runtime-progress";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim() ?? "";

  if (value.length === 0) {
    throw new Error(`Runtime E2E browser benchmark requires ${name}.`);
  }

  return value;
}

function readPairIds(): number[] {
  const values = (process.env["MOSOO_E2E_RUNTIME_SCOREBOARD_PAIR_IDS"]?.trim() || "1,2,17,18")
    .split(",")
    .map((value) => Number(value.trim()));

  if (
    values.length !== 4 ||
    new Set(values).size !== 4 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new Error(
      "MOSOO_E2E_RUNTIME_SCOREBOARD_PAIR_IDS must contain exactly four distinct positive integers.",
    );
  }

  return values;
}

async function readRuntimeTrace(
  page: Parameters<typeof createRuntimeE2EBrowserProbe>[0],
  input: {
    baseURL: string;
    perfAuthToken: string;
    runId: string;
    sessionId: string;
  },
): Promise<unknown> {
  const url = new URL("/v1/internal/performance/runtime-trace", `${input.baseURL}/`);
  url.searchParams.set("runId", input.runId);
  url.searchParams.set("threadId", input.sessionId);
  const response = await page.request.get(url.toString(), {
    headers: { "x-mosoo-perf-auth": input.perfAuthToken },
    timeout: 30_000,
  });

  if (!response.ok()) {
    throw new Error(`Runtime E2E trace failed with HTTP ${response.status()}.`);
  }

  return response.json();
}

test("DeepSeek Preview emits a correlated runtime E2E scoreboard artifact", async ({ page }) => {
  const fixturePath = requireEnv("MOSOO_E2E_RUNTIME_FIXTURE_INPUT");
  const outputPath = requireEnv("MOSOO_E2E_RUNTIME_BROWSER_OUTPUT");
  const perfAuthToken = requireEnv("MOSOO_E2E_PERF_AUTH_TOKEN");
  const email = requireEnv("MOSOO_E2E_EMAIL");
  const fixture = parseRuntimeBenchmarkFixture(JSON.parse(await readFile(fixturePath, "utf8")));
  const pairIds = readPairIds();
  const webOrigin = new URL(requireEnv("MOSOO_E2E_BASE_URL")).origin;
  const failedSamples: Array<{
    readonly pair: number;
    readonly sampleIndex: number;
    readonly stage: "browser_turn";
  }> = [];
  const excludedSamples: never[] = [];
  const samples: RuntimeE2EBrowserCorrelatedRun[] = [];
  const latencyProbe = createLatencyProbe({ page });
  const browserProbe = createRuntimeE2EBrowserProbe(page);

  if (fixture.providerId !== "deepseek" || fixture.runtimeId !== "acp-fallback") {
    throw new Error("Runtime E2E browser benchmark requires a DeepSeek ACP fixture.");
  }

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin !== webOrigin || !url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    await route.continue({
      headers: {
        ...request.headers(),
        "x-mosoo-perf-auth": perfAuthToken,
      },
    });
  });
  await loginWithMosooAiBackdoor(page, email);
  await page.goto(`/agent/${fixture.agentId}?tab=preview`);
  await expect(page.getByTestId("agent-preview-panel")).toBeVisible();
  await expect(page.getByTestId("agent-session-pill")).toContainText("Ready", {
    timeout: 60_000,
  });

  const writeArtifact = async (): Promise<void> => {
    const artifact = {
      createdAt: new Date().toISOString(),
      excludedSamples,
      exclusionPolicy: RUNTIME_E2E_BROWSER_EXCLUSION_POLICY,
      failedSamples,
      failurePolicy: RUNTIME_E2E_BROWSER_FAILURE_POLICY,
      fixture: {
        agentConfigSha256: fixture.agentConfigSha256,
        agentId: fixture.agentId,
        model: fixture.model,
        providerId: fixture.providerId,
        runtimeId: fixture.runtimeId,
      },
      gitCommit: process.env["MOSOO_E2E_GIT_COMMIT"]?.trim() || "unknown",
      pairIds,
      sampleTarget: pairIds.length,
      samples,
      schemaVersion: RUNTIME_E2E_BROWSER_SCHEMA,
      workload: {
        expectedOutputSha256: sha256Text(RUNTIME_E2E_EXPECTED_OUTPUT),
        promptSha256: sha256Text(RUNTIME_E2E_PROMPT),
        systemPromptSha256: sha256Text(RUNTIME_E2E_SYSTEM_PROMPT),
      },
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
    await chmod(outputPath, 0o600);
  };

  let reconnectRecovered: boolean | null = null;

  for (const [index, pair] of pairIds.entries()) {
    try {
      const label = `runtime_e2e_${index + 1}`;
      await browserProbe.startTurn(label);
      const latency = await sendMeasuredTurn(page, latencyProbe, {
        expectedToken: RUNTIME_E2E_EXPECTED_OUTPUT,
        label,
        prompt: RUNTIME_E2E_PROMPT,
      });
      const run = await browserProbe.finishTurn(
        latency,
        RUNTIME_E2E_EXPECTED_OUTPUT,
        reconnectRecovered,
      );
      const trace = await readRuntimeTrace(page, {
        baseURL: fixture.baseURL,
        perfAuthToken,
        runId: run.runId,
        sessionId: run.sessionId,
      });

      samples.push(correlateRuntimeE2EBrowserRun(run, trace, pair));
      await writeArtifact();

      if (index === 0) {
        reconnectRecovered = await browserProbe.forceReconnect(run.sessionId, async () => {
          const url = new URL(
            "/v1/internal/performance/runtime-disconnect-viewers",
            `${fixture.baseURL}/`,
          );
          url.searchParams.set("threadId", run.sessionId);
          const response = await page.request.post(url.toString(), {
            headers: { "x-mosoo-perf-auth": perfAuthToken },
            timeout: 30_000,
          });

          if (!response.ok()) {
            throw new Error(
              `Runtime E2E reconnect injection failed with HTTP ${response.status()}.`,
            );
          }
        });
      } else {
        reconnectRecovered = null;
      }
    } catch (error) {
      failedSamples.push({ pair, sampleIndex: index + 1, stage: "browser_turn" });
      await writeArtifact();
      throw error;
    }
  }

  await writeArtifact();
});
