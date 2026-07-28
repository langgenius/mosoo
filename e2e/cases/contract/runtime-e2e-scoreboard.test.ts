import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRuntimeE2EScoreboard } from "../../bin/runtime-e2e-scoreboard";
import {
  renderRuntimeE2EScoreboardMarkdown,
  runtimeE2ESamplesFromColdStartDocument,
  summarizeRuntimeE2EScoreboard,
} from "../../lib/runtime-e2e-scoreboard";
import type {
  RuntimeE2EMetric,
  RuntimeE2ESample,
  RuntimeE2EStageEvidence,
} from "../../lib/runtime-e2e-scoreboard";

function available<T>(value: T): RuntimeE2EMetric<T> {
  return { source: "test", status: "available", value };
}

function measured(elapsedMs: number): RuntimeE2EStageEvidence {
  return { elapsedMs, evidenceId: "event-1", source: "test", status: "measured" };
}

function completeSample(path: "cold" | "warm", ttftMs: number): RuntimeE2ESample {
  return {
    browserApply: measured(ttftMs),
    correlationId: `${path}:run`,
    d1Commit: measured(2),
    interDeltaP95Ms: available(20),
    path: available(path),
    providerDirectVisibleCharactersPerSecond: available(200),
    providerFirstDelta: measured(1),
    runId: `${path}-run`,
    sessionId: `${path}-session`,
    terminalSucceeded: available(true),
    transportReconnectRecovered: available(true),
    ttftMs: available(ttftMs),
    viewerPublish: measured(3),
    visibleCharactersPerSecond: available(100),
  };
}

describe("runtime E2E performance scoreboard", () => {
  test("scores cold and warm runs with p99 and matched provider-direct rate", () => {
    const scoreboard = summarizeRuntimeE2EScoreboard(
      [completeSample("cold", 100), completeSample("cold", 200), completeSample("warm", 50)],
      "2026-07-28T00:00:00.000Z",
    );

    expect(scoreboard.cold.ttftMs).toEqual({
      source: "first visible output at the recorded consumer boundary",
      status: "available",
      value: { n: 2, p50: 100, p95: 200, p99: 200 },
    });
    expect(scoreboard.cold.visibleOutputRateVsProviderDirect).toMatchObject({
      status: "available",
      value: { p50: 0.5, p95: 0.5, p99: 0.5 },
    });
    expect(scoreboard.cold.terminalSuccess).toMatchObject({
      status: "available",
      value: { attempts: 2, rate: 1, successes: 2 },
    });
    expect(scoreboard.cold.transportReconnectRecovery).toMatchObject({
      status: "available",
      value: { attempts: 2, rate: 1, successes: 2 },
    });
    expect(scoreboard.cold.correlation.completeSamples).toBe(2);
  });

  test("adapts frozen cold-start evidence without inventing unavailable timings", () => {
    const document = {
      discardedBlocks: [],
      failedAttempts: [
        {
          sample: {
            failure: { message: "provider failed", stage: "sample" },
            metrics: {},
            output: { valid: false },
            runId: null,
            threadId: null,
          },
          trace: null,
        },
      ],
      runs: [
        {
          sample: {
            failure: null,
            metrics: {
              assistantTextCharacters: 100,
              firstAssistantTextMs: 120,
              interChunkP95Ms: 30,
              runCompletedMs: 620,
              sendToFirstAssistantTextMs: 80,
            },
            output: { valid: true },
            runId: "run-1",
            threadId: "session-1",
          },
          trace: {
            timings: [
              {
                eventId: "timing-prepare",
                timing: {
                  path: "cold",
                  phases: [],
                  runId: "run-1",
                  sessionId: "session-1",
                  source: "api",
                  stage: "prepare_run",
                },
              },
              {
                eventId: "timing-provider",
                timing: {
                  path: "cold",
                  phases: [{ durationMs: 40, name: "provider.first_event" }],
                  runId: "run-1",
                  sessionId: "session-1",
                  source: "driver",
                  stage: "driver_turn",
                },
              },
            ],
          },
        },
      ],
      schemaVersion: "mosoo.cold-start-ab.v12",
    };
    const scoreboard = summarizeRuntimeE2EScoreboard(
      runtimeE2ESamplesFromColdStartDocument(document),
      "2026-07-28T00:00:00.000Z",
    );
    const markdown = renderRuntimeE2EScoreboardMarkdown(scoreboard);

    expect(scoreboard.cold.ttftMs).toMatchObject({
      status: "available",
      value: { p50: 80, p95: 80, p99: 80 },
    });
    expect(scoreboard.cold.correlation.stages.providerFirstDelta.observed).toBe(1);
    expect(scoreboard.cold.correlation.stages.d1Commit.unavailable).toBe(1);
    expect(scoreboard.cold.correlation.stages.browserApply.unavailable).toBe(1);
    expect(scoreboard.cold.visibleOutputRateVsProviderDirect.status).toBe("unavailable");
    expect(scoreboard.cold.transportReconnectRecovery.status).toBe("unavailable");
    expect(scoreboard.overallTerminalSuccess).toMatchObject({
      status: "available",
      value: { attempts: 2, rate: 0.5, successes: 1 },
    });
    expect(scoreboard.unclassifiedSamples).toBe(1);
    expect(markdown).toContain("unavailable");
  });

  test("writes separate JSON and Markdown artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mosoo-runtime-e2e-scoreboard-"));
    const inputPath = join(directory, "input.json");
    const outputPath = join(directory, "scoreboard");

    try {
      await writeFile(
        inputPath,
        '{"discardedBlocks":[],"failedAttempts":[],"runs":[],"schemaVersion":"mosoo.cold-start-ab.v12"}\n',
      );
      await runRuntimeE2EScoreboard(inputPath, outputPath);

      expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({
        schema: "mosoo.runtime-e2e-scoreboard.v1",
        totalSamples: 0,
      });
      expect(await readFile(`${outputPath}.md`, "utf8")).toContain(
        "# Runtime E2E performance scoreboard",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
