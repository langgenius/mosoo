import {
  EventType,
  MOSOO_CUSTOM_EVENT,
  parseAgUiSessionEventJson,
  readRuntimeE2EStageEvidence,
} from "@mosoo/ag-ui-session";
import type { RuntimeE2EObservedAt } from "@mosoo/ag-ui-session";
import type { Page, WebSocket as PlaywrightWebSocket } from "@playwright/test";

import { TURN_TIMEOUT_MS } from "./runtime-progress";
import type { TurnLatency } from "./runtime-progress";

export {
  RUNTIME_E2E_BROWSER_EXCLUSION_POLICY,
  RUNTIME_E2E_BROWSER_FAILURE_POLICY,
} from "./runtime-e2e-scoreboard";

export const RUNTIME_E2E_BROWSER_SCHEMA = "mosoo.runtime-e2e-browser.v1";
const RUNTIME_E2E_BROWSER_APPLY_DATA_KEY = "mosooRuntimeE2EApply";

export interface RuntimeE2EBrowserStage extends RuntimeE2EObservedAt {
  readonly evidenceId: string;
}

export interface RuntimeE2EBrowserRun {
  readonly browserApply: RuntimeE2EBrowserStage;
  readonly browserFrameReceived: RuntimeE2EBrowserStage;
  readonly correlationId: string;
  readonly d1Commit: RuntimeE2EBrowserStage;
  readonly interDeltaP95Ms: number | null;
  readonly outputCharacters: number;
  readonly outputEquivalent: boolean;
  readonly providerFirstDelta: RuntimeE2EBrowserStage;
  readonly runId: string;
  readonly sessionId: string;
  readonly terminalStatus: string;
  readonly terminalSucceeded: boolean;
  readonly transportReconnectRecovered: boolean | null;
  readonly ttftMs: number;
  readonly turnCompletedMs: number | null;
  readonly viewerPublish: RuntimeE2EBrowserStage;
  readonly visibleCharactersPerSecond: number | null;
}

export interface RuntimeE2EBrowserCorrelatedRun extends RuntimeE2EBrowserRun {
  readonly d1EventId: string;
  readonly d1Seq: number;
  readonly pair: number;
  readonly path: "cold" | "warm";
}

interface ActiveTurn {
  readonly assistantMessageIds: Set<string>;
  readonly deltaTimestamps: number[];
  evidence: ReturnType<typeof readRuntimeE2EStageEvidence>;
  firstFrameReceivedAt: number | null;
  readonly label: string;
  messageId: string | null;
  outputText: string;
  terminalAt: number | null;
  terminalStatus: string | null;
}

function percentile(values: readonly number[], percentage: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} requires ${field}.`);
  }

  return value;
}

function readBrowserApplyMarker(value: unknown): {
  readonly clockDomain: string;
  readonly epochMs: number;
  readonly renderedText: string;
} {
  if (!isRecord(value)) {
    throw new Error("Runtime E2E browser apply marker must be an object.");
  }

  const epochMs = value["epochMs"];
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs) || epochMs < 0) {
    throw new Error("Runtime E2E browser apply marker requires epochMs.");
  }

  return {
    clockDomain: requireString(value, "clockDomain", "Runtime E2E browser apply marker"),
    epochMs,
    renderedText: requireString(value, "renderedText", "Runtime E2E browser apply marker"),
  };
}

export function correlateRuntimeE2EBrowserRun(
  run: RuntimeE2EBrowserRun,
  traceValue: unknown,
  pair: number,
): RuntimeE2EBrowserCorrelatedRun {
  if (!Number.isSafeInteger(pair) || pair < 1) {
    throw new Error("Runtime E2E browser run requires a positive pair number.");
  }
  if (!isRecord(traceValue)) {
    throw new Error("Runtime E2E trace must be an object.");
  }

  const firstVisibleDelta = traceValue["firstVisibleDelta"];
  if (!isRecord(firstVisibleDelta)) {
    throw new Error("Runtime E2E trace did not retain the first visible D1 delta.");
  }

  const sourceEventId = requireString(
    firstVisibleDelta,
    "sourceEventId",
    "Runtime E2E first visible delta",
  );
  const occurredAt = Date.parse(
    requireString(firstVisibleDelta, "occurredAt", "Runtime E2E first visible delta"),
  );
  const d1RowCreatedAt = Date.parse(
    requireString(firstVisibleDelta, "d1RowCreatedAt", "Runtime E2E first visible delta"),
  );
  const seq = firstVisibleDelta["seq"];

  if (
    sourceEventId !== run.correlationId ||
    !Number.isFinite(occurredAt) ||
    occurredAt !== run.providerFirstDelta.epochMs ||
    !Number.isFinite(d1RowCreatedAt) ||
    d1RowCreatedAt > run.d1Commit.epochMs ||
    !Number.isSafeInteger(seq) ||
    (seq as number) < 0
  ) {
    throw new Error("Runtime E2E trace did not match the correlated first delta.");
  }

  const timings = traceValue["timings"];
  if (!Array.isArray(timings)) {
    throw new Error("Runtime E2E trace.timings must be an array.");
  }

  const prepareRun = timings.find((value) => {
    if (!isRecord(value) || !isRecord(value["timing"])) {
      return false;
    }
    const timing = value["timing"];
    return (
      timing["runId"] === run.runId &&
      timing["sessionId"] === run.sessionId &&
      timing["source"] === "api" &&
      timing["stage"] === "prepare_run"
    );
  });
  const timing =
    isRecord(prepareRun) && isRecord(prepareRun["timing"]) ? prepareRun["timing"] : null;
  const path = timing?.["path"];

  if (path !== "cold" && path !== "warm") {
    throw new Error("Runtime E2E trace did not classify the run as cold or warm.");
  }

  return {
    ...run,
    d1EventId: requireString(firstVisibleDelta, "eventId", "Runtime E2E first visible delta"),
    d1Seq: seq as number,
    pair,
    path,
  };
}

function readSessionId(socket: PlaywrightWebSocket): string | null {
  const match = /\/api\/ag-ui\/session\/([^/?#]+)/u.exec(new URL(socket.url()).pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function createRuntimeE2EBrowserProbe(
  page: Page,
  nowEpochMs: () => number = Date.now,
): {
  readonly finishTurn: (
    latency: TurnLatency,
    expectedOutput: string,
    transportReconnectRecovered: boolean | null,
  ) => Promise<RuntimeE2EBrowserRun>;
  readonly forceReconnect: (sessionId: string, disconnect: () => Promise<void>) => Promise<boolean>;
  readonly startTurn: (label: string) => Promise<void>;
} {
  let activeTurn: ActiveTurn | null = null;
  const activeSockets = new Map<string, number>();
  let closedSockets = 0;
  let openedSockets = 0;
  let stateSyncFrames = 0;

  page.on("websocket", (socket) => {
    const sessionId = readSessionId(socket);

    if (sessionId === null) {
      return;
    }

    activeSockets.set(sessionId, (activeSockets.get(sessionId) ?? 0) + 1);
    openedSockets += 1;

    socket.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") {
        return;
      }

      let event;

      try {
        event = parseAgUiSessionEventJson(frame.payload);
      } catch {
        return;
      }

      if (event.type === EventType.STATE_SNAPSHOT) {
        stateSyncFrames += 1;
      }

      const turn = activeTurn;
      if (turn === null) {
        return;
      }
      const observedAt = nowEpochMs();

      if (event.type === EventType.TEXT_MESSAGE_START && event.role === "assistant") {
        turn.assistantMessageIds.add(event.messageId);
        return;
      }

      if (
        event.type === EventType.TEXT_MESSAGE_CONTENT &&
        turn.assistantMessageIds.has(event.messageId) &&
        event.delta.length > 0
      ) {
        const evidence = readRuntimeE2EStageEvidence(event);

        if (turn.evidence === null) {
          if (evidence === null) {
            return;
          }
          turn.evidence = evidence;
          turn.firstFrameReceivedAt = observedAt;
          turn.messageId = event.messageId;
        }
        if (event.messageId !== turn.messageId) {
          return;
        }

        turn.deltaTimestamps.push(observedAt);
        turn.outputText += event.delta;
        return;
      }

      if (
        event.type === EventType.CUSTOM &&
        event.name === MOSOO_CUSTOM_EVENT.sessionRunUpdated.name &&
        turn.evidence !== null &&
        event.value.run.id === turn.evidence.runId &&
        ["cancelled", "completed", "expired", "failed"].includes(event.value.run.status)
      ) {
        turn.terminalAt = observedAt;
        turn.terminalStatus = event.value.run.status;
      }
    });

    socket.on("close", () => {
      const remaining = (activeSockets.get(sessionId) ?? 1) - 1;
      if (remaining === 0) {
        activeSockets.delete(sessionId);
      } else {
        activeSockets.set(sessionId, remaining);
      }
      closedSockets += 1;
    });
  });

  async function waitFor(predicate: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + TURN_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (predicate()) {
        return;
      }
      await page.waitForTimeout(50);
    }

    throw new Error(message);
  }

  return {
    async finishTurn(latency, expectedOutput, transportReconnectRecovered) {
      const turn = activeTurn;

      if (turn === null) {
        throw new Error("Runtime E2E browser probe has no active turn.");
      }

      await waitFor(
        () => turn.evidence !== null && turn.terminalStatus !== null,
        `Runtime E2E turn ${turn.label} did not expose correlated terminal evidence.`,
      );
      activeTurn = null;

      const evidence = turn.evidence;
      const browserFrameReceivedAt = turn.firstFrameReceivedAt;

      if (
        evidence === null ||
        evidence.viewerPublish === undefined ||
        browserFrameReceivedAt === null
      ) {
        throw new Error(`Runtime E2E turn ${turn.label} is missing a core stage.`);
      }
      await page.waitForFunction(
        (dataKey) => document.documentElement.dataset[dataKey] !== undefined,
        RUNTIME_E2E_BROWSER_APPLY_DATA_KEY,
        { timeout: TURN_TIMEOUT_MS },
      );
      const browserApply = readBrowserApplyMarker(
        await page.evaluate((dataKey) => {
          const raw = document.documentElement.dataset[dataKey];
          return raw === undefined ? null : JSON.parse(raw);
        }, RUNTIME_E2E_BROWSER_APPLY_DATA_KEY),
      );
      if (
        browserApply.epochMs < latency.sendClickedAtEpochMs ||
        !expectedOutput.startsWith(browserApply.renderedText) ||
        !turn.outputText.startsWith(browserApply.renderedText)
      ) {
        throw new Error(`Runtime E2E turn ${turn.label} browser apply did not match its stream.`);
      }

      const gaps = turn.deltaTimestamps
        .slice(1)
        .map((timestamp, index) => timestamp - (turn.deltaTimestamps[index] ?? timestamp));
      const firstDeltaAt = turn.deltaTimestamps[0] ?? null;
      const visibleDurationMs =
        firstDeltaAt === null || turn.terminalAt === null ? null : turn.terminalAt - firstDeltaAt;

      return {
        browserApply: {
          clockDomain: browserApply.clockDomain,
          evidenceId: evidence.correlationId,
          epochMs: browserApply.epochMs,
        },
        browserFrameReceived: {
          clockDomain: "playwright.node.wall",
          evidenceId: evidence.correlationId,
          epochMs: browserFrameReceivedAt,
        },
        correlationId: evidence.correlationId,
        d1Commit: {
          ...evidence.d1Commit,
          evidenceId: evidence.correlationId,
        },
        interDeltaP95Ms: percentile(gaps, 95),
        outputCharacters: turn.outputText.length,
        outputEquivalent: turn.outputText === expectedOutput,
        providerFirstDelta: {
          ...evidence.providerFirstDelta,
          evidenceId: evidence.correlationId,
        },
        runId: evidence.runId,
        sessionId: evidence.sessionId,
        terminalStatus: turn.terminalStatus ?? "unknown",
        terminalSucceeded:
          turn.terminalStatus === "completed" && turn.outputText === expectedOutput,
        transportReconnectRecovered,
        ttftMs: round(Math.max(0, browserApply.epochMs - latency.sendClickedAtEpochMs)),
        turnCompletedMs:
          turn.terminalAt === null
            ? null
            : round(Math.max(0, turn.terminalAt - latency.sendClickedAtEpochMs)),
        viewerPublish: {
          ...evidence.viewerPublish,
          evidenceId: evidence.correlationId,
        },
        visibleCharactersPerSecond:
          visibleDurationMs === null || visibleDurationMs <= 0
            ? null
            : round((turn.outputText.length * 1_000) / visibleDurationMs),
      };
    },
    async forceReconnect(sessionId, disconnect) {
      if ((activeSockets.get(sessionId) ?? 0) === 0) {
        throw new Error("Runtime E2E reconnect probe has no active Session socket.");
      }

      const closedBefore = closedSockets;
      const openedBefore = openedSockets;
      const stateSyncBefore = stateSyncFrames;
      await disconnect();
      await waitFor(
        () =>
          closedSockets > closedBefore &&
          openedSockets > openedBefore &&
          stateSyncFrames > stateSyncBefore &&
          (activeSockets.get(sessionId) ?? 0) > 0,
        "Runtime E2E Session socket did not reconnect after fault injection.",
      );
      return true;
    },
    async startTurn(label) {
      if (activeTurn !== null) {
        throw new Error(`Runtime E2E turn ${activeTurn.label} is still active.`);
      }

      await page.evaluate((dataKey) => {
        const state = globalThis as typeof globalThis & {
          mosooRuntimeE2EApplyObserver?: MutationObserver;
        };
        state.mosooRuntimeE2EApplyObserver?.disconnect();
        delete document.documentElement.dataset[dataKey];

        const selector = '[class~="group/aui-msg"]';
        const baselineCount = document.querySelectorAll(selector).length;
        const observer = new MutationObserver(() => {
          const renderedText =
            [...document.querySelectorAll<HTMLElement>(selector)]
              .slice(baselineCount)
              .map((message) => message.textContent?.trim() ?? "")
              .find((text) => text.length > 0 && !/^Thinking(?:…|\.\.\.)?$/u.test(text)) ?? null;

          if (renderedText === null) {
            return;
          }

          observer.disconnect();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              document.documentElement.dataset[dataKey] = JSON.stringify({
                clockDomain: "browser.performance.timeOrigin",
                epochMs: performance.timeOrigin + performance.now(),
                renderedText,
              });
            });
          });
        });
        state.mosooRuntimeE2EApplyObserver = observer;
        observer.observe(document.body, { characterData: true, childList: true, subtree: true });
      }, RUNTIME_E2E_BROWSER_APPLY_DATA_KEY);

      activeTurn = {
        assistantMessageIds: new Set(),
        deltaTimestamps: [],
        evidence: null,
        firstFrameReceivedAt: null,
        label,
        messageId: null,
        outputText: "",
        terminalAt: null,
        terminalStatus: null,
      };
    },
  };
}
