import { performance } from "node:perf_hooks";

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const TURN_TIMEOUT_MS = 240_000;

export interface LatencyTraceEvent {
  elapsedMs: number;
  name: string | null;
  runStatus: string | null;
  type: string | null;
}

export interface TurnLatency {
  firstAssistantTextMs: number;
  label: string;
  terminalRunStatus: string | null;
  trace: LatencyTraceEvent[];
  turnCompletedMs: number | null;
}

interface ActiveTurn {
  label: string;
  sendStartedAt: number;
  trace: LatencyTraceEvent[];
}

function roundMs(value: number): number {
  return Math.round(value);
}

async function waitForNewExactText(
  page: Page,
  input: {
    baselineCount: number;
    expectedToken: string;
    sendStartedAt: number;
  },
): Promise<number> {
  const tokenLocator = page.getByText(input.expectedToken, { exact: true });
  const deadline = performance.now() + TURN_TIMEOUT_MS;

  while (performance.now() < deadline) {
    const visibleCount = await tokenLocator.count();

    if (visibleCount > input.baselineCount) {
      return roundMs(performance.now() - input.sendStartedAt);
    }

    await page.waitForTimeout(50);
  }

  throw new Error(
    `Preview latency turn did not render token ${input.expectedToken} after ${TURN_TIMEOUT_MS}ms.`,
  );
}

export function createLatencyProbe(): {
  readonly startTurn: (label: string) => {
    readonly sendStartedAt: number;
    readonly wait: (input: { readonly visibleText: Promise<number> }) => Promise<TurnLatency>;
  };
} {
  let activeTurn: ActiveTurn | null = null;

  return {
    startTurn(label) {
      if (activeTurn !== null) {
        throw new Error(`Latency turn ${activeTurn.label} is still active.`);
      }

      const turn: ActiveTurn = {
        label,
        sendStartedAt: performance.now(),
        trace: [],
      };
      activeTurn = turn;

      return {
        sendStartedAt: turn.sendStartedAt,
        async wait(input: { readonly visibleText: Promise<number> }): Promise<TurnLatency> {
          const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new Error(`Preview latency turn ${label} timed out after ${TURN_TIMEOUT_MS}ms.`),
              );
            }, TURN_TIMEOUT_MS);
          });
          const firstAssistantTextMs = await Promise.race([input.visibleText, timeout]);
          activeTurn = null;

          return {
            firstAssistantTextMs,
            label,
            terminalRunStatus: null,
            trace: turn.trace,
            turnCompletedMs: null,
          };
        },
      };
    },
  };
}

export async function sendMeasuredTurn(
  page: Page,
  probe: ReturnType<typeof createLatencyProbe>,
  input: {
    expectedToken: string;
    label: string;
    prompt: string;
  },
): Promise<TurnLatency> {
  const baselineTokenCount = await page.getByText(input.expectedToken, { exact: true }).count();
  await page.getByTestId("agent-session-composer-input").fill(input.prompt);
  const turn = probe.startTurn(input.label);
  await page.getByTestId("agent-session-send").click();
  const latency = await turn.wait({
    visibleText: waitForNewExactText(page, {
      baselineCount: baselineTokenCount,
      expectedToken: input.expectedToken,
      sendStartedAt: turn.sendStartedAt,
    }),
  });
  await expect(page.getByTestId("agent-session-pill")).toContainText("Ready", {
    timeout: 30_000,
  });
  return latency;
}
