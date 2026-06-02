import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { expect, test } from "@playwright/test";
import type { TestInfo } from "@playwright/test";

import { createLatencyProbe, sendMeasuredTurn } from "./preview-latency-probe";
import type { TurnLatency } from "./preview-latency-probe";
import {
  createPersonalAccessTokenForPublicApi,
  publishAgentForPublicApi,
  runPublicApiCreateThreadLatency,
} from "./preview-latency-public-api";
import type { PublicApiCreateThreadLatency } from "./preview-latency-public-api";
import {
  configureProviderCompanyKey,
  createPreviewRuntimeAgent,
  createPreviewRunId,
  getPreviewSmokeEmail,
  loginWithMosooAiBackdoor,
  requirePreviewRuntimeCredential,
  verifyPreviewReadinessBlocker,
} from "./preview-live-harness";
import { createRuntimeSignalCollector } from "./runtime-signal-collector";

const runId = createPreviewRunId();
const smokeEmail = getPreviewSmokeEmail(runId);
const benchmarkLabel = process.env["MOSOO_E2E_LATENCY_LABEL"]?.trim() || "preview-latency";
const outputPath = process.env["MOSOO_E2E_LATENCY_OUTPUT"]?.trim() ?? "";
const gitCommit = process.env["MOSOO_E2E_GIT_COMMIT"]?.trim() ?? "unknown";
const smokeAgentName = `Preview latency ${benchmarkLabel} ${runId}`;

const FIRST_TURN_TOKEN = "LATENCY_READY_TOKEN";
const REOPEN_TURN_TOKEN = "LATENCY_REOPEN_TOKEN";
const PUBLIC_API_TURN_TOKEN = "LATENCY_PUBLIC_API_TOKEN";

interface BenchmarkResult {
  agentId: string;
  baseURL: string;
  benchmarkLabel: string;
  createdAt: string;
  gitCommit: string;
  publicApiTurns: PublicApiCreateThreadLatency[];
  runId: string;
  turns: TurnLatency[];
}

async function writeBenchmarkResult(result: BenchmarkResult, testInfo: TestInfo): Promise<void> {
  const payload = `${JSON.stringify(result, null, 2)}\n`;

  await testInfo.attach("preview-latency-result", {
    body: Buffer.from(payload),
    contentType: "application/json",
  });

  if (outputPath.length === 0) {
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, payload);
}

test("Preview latency captures first assistant text for initial dispatch and reopen", async ({
  page,
}, testInfo) => {
  const runtimeCredential = requirePreviewRuntimeCredential();
  const runtimeSignals = createRuntimeSignalCollector({
    source: "preview-latency",
  });
  const probe = createLatencyProbe();

  runtimeSignals.attachToPage(page);
  runtimeSignals.checkpoint("preview-latency.login.start", {
    email: smokeEmail,
  });
  await loginWithMosooAiBackdoor(page, smokeEmail);
  runtimeSignals.checkpoint("preview-latency.agent.create.start", {
    agentName: smokeAgentName,
  });
  const agentId = await createPreviewRuntimeAgent(page, {
    name: smokeAgentName,
    runtimeButtonName: runtimeCredential.runtimeButtonName,
  });
  await verifyPreviewReadinessBlocker(page, agentId);
  runtimeSignals.checkpoint("preview-latency.provider.configure.start", {
    agentId,
    provider: runtimeCredential.providerId,
  });
  await configureProviderCompanyKey(page, {
    apiKey: runtimeCredential.apiKey,
    providerId: runtimeCredential.providerId,
    runId,
  });

  const writeProgress = async (
    turns: TurnLatency[],
    publicApiTurns: PublicApiCreateThreadLatency[] = [],
  ): Promise<void> => {
    await writeBenchmarkResult(
      {
        agentId,
        baseURL: testInfo.project.use.baseURL ?? "unknown",
        benchmarkLabel,
        createdAt: new Date().toISOString(),
        gitCommit,
        publicApiTurns,
        runId,
        turns,
      },
      testInfo,
    );
  };

  await page.goto(`/agent/${agentId}?tab=preview`);
  await expect(page.getByTestId("agent-preview-panel")).toBeVisible();
  await expect(page.getByTestId("agent-session-pill")).toContainText("Ready", {
    timeout: 30_000,
  });

  runtimeSignals.checkpoint("preview-latency.initial-dispatch.start", { agentId });
  const initialDispatch = await sendMeasuredTurn(page, probe, {
    expectedToken: FIRST_TURN_TOKEN,
    label: "initial_dispatch",
    prompt: `Reply with exactly ${FIRST_TURN_TOKEN}. Do not use tools.`,
  });
  await writeProgress([initialDispatch]);

  await page.reload();
  await expect(page.getByTestId("agent-preview-panel")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("agent-session-pill")).toContainText("Ready", {
    timeout: 30_000,
  });

  runtimeSignals.checkpoint("preview-latency.reopen-dispatch.start", { agentId });
  const reopenDispatch = await sendMeasuredTurn(page, probe, {
    expectedToken: REOPEN_TURN_TOKEN,
    label: "reopen_dispatch",
    prompt: `Follow up in the same thread. Reply with exactly ${REOPEN_TURN_TOKEN}. Do not use tools.`,
  });
  await writeProgress([initialDispatch, reopenDispatch]);

  runtimeSignals.checkpoint("preview-latency.public-api.publish.start", { agentId });
  await publishAgentForPublicApi(page, { agentId });
  const publicApiToken = await createPersonalAccessTokenForPublicApi(page, {
    label: `Preview latency ${runId}`,
  });
  runtimeSignals.checkpoint("preview-latency.public-api.create-thread.start", { agentId });
  const publicApiCreateThread = await runPublicApiCreateThreadLatency(page, {
    agentId,
    expectedToken: PUBLIC_API_TURN_TOKEN,
    label: "public_api_create_thread",
    pat: publicApiToken,
  });
  await writeProgress([initialDispatch, reopenDispatch], [publicApiCreateThread]);

  await runtimeSignals.sampleResources(page, "after-preview-latency");
  runtimeSignals.checkpoint("preview-latency.exit", { agentId });
  runtimeSignals.assertCoverage();
  await runtimeSignals.attachArtifact(testInfo);
  await writeProgress([initialDispatch, reopenDispatch], [publicApiCreateThread]);
});
