import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";

import { expect } from "@playwright/test";
import type {
  ConsoleMessage,
  Page,
  Request as PlaywrightRequest,
  Response as PlaywrightResponse,
  TestInfo,
  WebSocket as PlaywrightWebSocket,
} from "@playwright/test";

import { formatHarnessError } from "./env-preflight";

export const REQUIRED_RUNTIME_SIGNAL_CATEGORIES = [
  "application_lifecycle",
  "feature_path_execution",
  "data_flow",
  "resource_utilization",
  "errors_exceptions",
] as const;

export type RuntimeSignalCategory = (typeof REQUIRED_RUNTIME_SIGNAL_CATEGORIES)[number];

export type RuntimeSignalValue =
  | boolean
  | null
  | number
  | string
  | readonly RuntimeSignalValue[]
  | { readonly [key: string]: RuntimeSignalValue };

export interface RuntimeHarnessSignal {
  readonly category: RuntimeSignalCategory;
  readonly context?: Record<string, RuntimeSignalValue>;
  readonly name: string;
  readonly observedAt: string;
  readonly source: string;
}

export interface RuntimeSignalCoverageSummary {
  readonly categories: readonly {
    readonly category: RuntimeSignalCategory;
    readonly count: number;
  }[];
  readonly missingCategories: readonly RuntimeSignalCategory[];
  readonly requiredCategories: readonly RuntimeSignalCategory[];
  readonly signalCount: number;
}

export interface RuntimeSignalCoverageOptions {
  readonly fix?: string;
  readonly requiredCategories?: readonly RuntimeSignalCategory[];
}

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

export function summarizeRuntimeSignalCoverage(
  signals: readonly RuntimeHarnessSignal[],
  options: RuntimeSignalCoverageOptions = {},
): RuntimeSignalCoverageSummary {
  const counts = new Map<RuntimeSignalCategory, number>();
  const requiredCategories = options.requiredCategories ?? REQUIRED_RUNTIME_SIGNAL_CATEGORIES;

  for (const category of requiredCategories) {
    counts.set(category, 0);
  }

  for (const signal of signals) {
    counts.set(signal.category, (counts.get(signal.category) ?? 0) + 1);
  }

  const categories = requiredCategories.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));

  return {
    categories,
    missingCategories: categories
      .filter((category) => category.count === 0)
      .map((category) => category.category),
    requiredCategories,
    signalCount: signals.length,
  };
}

export function assertRuntimeSignalCoverage(
  signals: readonly RuntimeHarnessSignal[],
  options: RuntimeSignalCoverageOptions = {},
): void {
  const summary = summarizeRuntimeSignalCoverage(signals, options);

  if (summary.missingCategories.length === 0) {
    return;
  }

  throw new Error(
    formatHarnessError({
      fix:
        options.fix ??
        "Attach `createRuntimeSignalCollector(...).attachToPage(page)` before navigation, add feature checkpoints / resource samples, or record a live-smoke-only gap in the PR / handoff evidence.",
      what: `Runtime signal collection is missing required coverage: ${summary.missingCategories.join(", ")}.`,
      why: "Lecture 11 and the mosoo harness contract require the harness to collect lifecycle, feature path, data flow, resource utilization, and error context signals instead of relying on agent-written logs.",
    }),
  );
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

interface RuntimeHarnessSignalInput {
  readonly category: RuntimeSignalCategory;
  readonly context?: Record<string, RuntimeSignalValue | undefined>;
  readonly name: string;
  readonly observedAt?: string;
  readonly source?: string;
}

interface RuntimeSignalCollectorOptions {
  readonly progress?: boolean | RuntimeSignalProgressOptions;
  readonly source: string;
}

interface RuntimeSignalProgressOptions {
  readonly enabled?: boolean;
  readonly now?: () => number;
  readonly write?: (line: string) => void;
}

interface RuntimeSignalPage {
  on(event: "close" | "domcontentloaded" | "load", listener: () => void): unknown;
  on(event: "console", listener: (message: ConsoleMessage) => void): unknown;
  on(event: "pageerror", listener: (error: Error) => void): unknown;
  on(event: "request" | "requestfailed", listener: (request: PlaywrightRequest) => void): unknown;
  on(event: "response", listener: (response: PlaywrightResponse) => void): unknown;
  on(event: "websocket", listener: (socket: PlaywrightWebSocket) => void): unknown;
  url(): string;
}

interface PerformanceMemorySample {
  readonly jsHeapSizeLimit: number | null;
  readonly totalJSHeapSize: number | null;
  readonly usedJSHeapSize: number | null;
}

type RuntimeWebSocketFrameDirection = "received" | "sent";

type RuntimeWebSocketFramePayload = Buffer | Uint8Array | string;

interface RuntimeSignalProgressReporter {
  readonly now: () => number;
  readonly startedAtMs: number;
  readonly write: (line: string) => void;
}

function compactContext(
  context: Record<string, RuntimeSignalValue | undefined>,
): Record<string, RuntimeSignalValue> {
  const nextContext: Record<string, RuntimeSignalValue> = {};

  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) {
      nextContext[key] = value;
    }
  }

  return nextContext;
}

function getByteLength(payload: RuntimeWebSocketFramePayload): number {
  if (typeof payload === "string") {
    return Buffer.byteLength(payload);
  }

  return payload.byteLength;
}

function getGraphQLOperationName(postData: string | null): string | null {
  if (postData === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(postData);

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const query = (parsed as Record<string, unknown>)["query"];

    if (typeof query !== "string") {
      return null;
    }

    return /\b(?:query|mutation)\s+([A-Za-z0-9_]+)/u.exec(query)?.[1] ?? null;
  } catch {
    return null;
  }
}

function getErrorContext(error: unknown): Record<string, RuntimeSignalValue> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }

  return {
    message: String(error),
    name: "UnknownError",
    stack: null,
  };
}

function createProgressReporter(
  progress: RuntimeSignalCollectorOptions["progress"],
): RuntimeSignalProgressReporter | null {
  if (progress === undefined || progress === false) {
    return null;
  }

  const options = progress === true ? {} : progress;

  if (options.enabled === false) {
    return null;
  }

  const now = options.now ?? (() => Date.now());

  return {
    now,
    startedAtMs: now(),
    write: options.write ?? ((line) => process.stdout.write(`${line}\n`)),
  };
}

function formatProgressElapsed(elapsedMs: number): string {
  return `${(Math.max(0, elapsedMs) / 1000).toFixed(1)}s`;
}

function truncateProgressText(value: string): string {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}

function formatProgressValue(value: RuntimeSignalValue): string {
  if (typeof value === "string") {
    return JSON.stringify(truncateProgressText(value));
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }

  return "{...}";
}

function formatProgressContext(context: RuntimeHarnessSignal["context"]): string {
  if (context === undefined) {
    return "";
  }

  const entries = Object.entries(context);

  if (entries.length === 0) {
    return "";
  }

  return ` ${entries.map(([key, value]) => `${key}=${formatProgressValue(value)}`).join(" ")}`;
}

export function createRuntimeSignalCollector(options: RuntimeSignalCollectorOptions): {
  readonly assertCoverage: (coverageOptions?: RuntimeSignalCoverageOptions) => void;
  readonly attachArtifact: (testInfo: TestInfo, name?: string) => Promise<void>;
  readonly attachToPage: (page: RuntimeSignalPage) => void;
  readonly checkpoint: (name: string, context?: Record<string, RuntimeSignalValue>) => void;
  readonly getSignals: () => readonly RuntimeHarnessSignal[];
  readonly record: (input: RuntimeHarnessSignalInput) => void;
  readonly sampleResources: (page: Page, phase: string) => Promise<void>;
  readonly summarize: () => RuntimeSignalCoverageSummary;
} {
  const signals: RuntimeHarnessSignal[] = [];
  const progress = createProgressReporter(options.progress);

  function emitProgress(signal: RuntimeHarnessSignal): void {
    if (progress === null || signal.category !== "feature_path_execution") {
      return;
    }

    progress.write(
      `[${signal.source}] ${formatProgressElapsed(progress.now() - progress.startedAtMs)} ${
        signal.name
      }${formatProgressContext(signal.context)}`,
    );
  }

  function record(input: RuntimeHarnessSignalInput): void {
    const context = input.context ? compactContext(input.context) : undefined;
    const signal: RuntimeHarnessSignal = {
      category: input.category,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
      name: input.name,
      observedAt: input.observedAt ?? new Date().toISOString(),
      source: input.source ?? options.source,
    };

    signals.push(signal);
    emitProgress(signal);
  }

  function attachToPage(page: RuntimeSignalPage): void {
    record({
      category: "application_lifecycle",
      context: { phase: "startup" },
      name: "browser.collector_installed",
    });
    record({
      category: "errors_exceptions",
      context: { listeners: "pageerror,console.error,requestfailed" },
      name: "browser.error.collector_installed",
    });

    page.on("domcontentloaded", () => {
      record({
        category: "application_lifecycle",
        context: { phase: "ready", url: page.url() },
        name: "browser.domcontentloaded",
      });
    });
    page.on("load", () => {
      record({
        category: "application_lifecycle",
        context: { phase: "running", url: page.url() },
        name: "browser.load",
      });
    });
    page.on("close", () => {
      record({
        category: "application_lifecycle",
        context: { phase: "shutdown" },
        name: "browser.close",
      });
    });
    page.on("request", (request) => {
      const requestUrl = request.url();

      if (!requestUrl.includes("/api/graphql")) {
        return;
      }

      record({
        category: "data_flow",
        context: {
          method: request.method(),
          operationName: getGraphQLOperationName(request.postData()),
          url: requestUrl,
        },
        name: "graphql.request",
      });
    });
    page.on("response", (response) => {
      const responseUrl = response.url();

      if (!responseUrl.includes("/api/graphql")) {
        return;
      }

      record({
        category: "data_flow",
        context: {
          status: response.status(),
          url: responseUrl,
        },
        name: "graphql.response",
      });
    });
    page.on("requestfailed", (request) => {
      record({
        category: "errors_exceptions",
        context: {
          failure: request.failure()?.errorText ?? null,
          method: request.method(),
          url: request.url(),
        },
        name: "browser.request_failed",
      });
    });
    page.on("pageerror", (error) => {
      record({
        category: "errors_exceptions",
        context: getErrorContext(error),
        name: "browser.page_error",
      });
    });
    page.on("console", (message) => {
      if (message.type() !== "error") {
        return;
      }

      record({
        category: "errors_exceptions",
        context: {
          message: message.text(),
          type: message.type(),
        },
        name: "browser.console_error",
      });
    });
    page.on("websocket", (socket) => {
      const socketUrl = socket.url();

      record({
        category: "application_lifecycle",
        context: {
          phase: "connected",
          url: socketUrl,
        },
        name: "websocket.open",
      });

      function recordFrame(
        direction: RuntimeWebSocketFrameDirection,
        payload: RuntimeWebSocketFramePayload,
      ): void {
        record({
          category: "data_flow",
          context: {
            direction,
            payloadBytes: getByteLength(payload),
            url: socketUrl,
          },
          name: `websocket.frame_${direction}`,
        });
      }

      socket.on("framereceived", (frame) => {
        recordFrame("received", frame.payload);
      });
      socket.on("framesent", (frame) => {
        recordFrame("sent", frame.payload);
      });
      socket.on("socketerror", (error) => {
        record({
          category: "errors_exceptions",
          context: {
            message: error,
            url: socketUrl,
          },
          name: "websocket.error",
        });
      });
      socket.on("close", () => {
        record({
          category: "application_lifecycle",
          context: {
            phase: "closed",
            url: socketUrl,
          },
          name: "websocket.close",
        });
      });
    });
  }

  async function sampleResources(page: Page, phase: string): Promise<void> {
    try {
      const memorySample = await page.evaluate<PerformanceMemorySample>(() => {
        const performanceWithMemory = performance as unknown as Performance & {
          readonly memory?: {
            readonly jsHeapSizeLimit?: number;
            readonly totalJSHeapSize?: number;
            readonly usedJSHeapSize?: number;
          };
        };

        return {
          jsHeapSizeLimit: performanceWithMemory.memory?.jsHeapSizeLimit ?? null,
          totalJSHeapSize: performanceWithMemory.memory?.totalJSHeapSize ?? null,
          usedJSHeapSize: performanceWithMemory.memory?.usedJSHeapSize ?? null,
        };
      });

      record({
        category: "resource_utilization",
        context: {
          jsHeapSizeLimit: memorySample.jsHeapSizeLimit,
          phase,
          totalJSHeapSize: memorySample.totalJSHeapSize,
          usedJSHeapSize: memorySample.usedJSHeapSize,
        },
        name: "browser.heap.sample",
      });
    } catch (error) {
      record({
        category: "resource_utilization",
        context: {
          ...getErrorContext(error),
          phase,
        },
        name: "browser.heap.sample_failed",
      });
    }
  }

  function checkpoint(name: string, context: Record<string, RuntimeSignalValue> = {}): void {
    record({
      category: "feature_path_execution",
      context,
      name,
    });
  }

  function summarize(): RuntimeSignalCoverageSummary {
    return summarizeRuntimeSignalCoverage(signals);
  }

  function assertCoverage(coverageOptions?: RuntimeSignalCoverageOptions): void {
    assertRuntimeSignalCoverage(signals, coverageOptions);
  }

  async function attachArtifact(
    testInfo: TestInfo,
    name = "runtime-progress-coverage",
  ): Promise<void> {
    await testInfo.attach(name, {
      body: JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          signals,
          summary: summarize(),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  }

  return {
    assertCoverage,
    attachArtifact,
    attachToPage,
    checkpoint,
    getSignals: () => signals,
    record,
    sampleResources,
    summarize,
  };
}
