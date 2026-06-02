import { Buffer } from "node:buffer";

import type {
  ConsoleMessage,
  Page,
  Request as PlaywrightRequest,
  Response as PlaywrightResponse,
  TestInfo,
  WebSocket as PlaywrightWebSocket,
} from "@playwright/test";

import {
  assertRuntimeSignalCoverage,
  summarizeRuntimeSignalCoverage,
} from "./runtime-signal-coverage";
import type {
  RuntimeHarnessSignal,
  RuntimeSignalCategory,
  RuntimeSignalCoverageOptions,
  RuntimeSignalCoverageSummary,
  RuntimeSignalValue,
} from "./runtime-signal-coverage";

export {
  assertRuntimeSignalCoverage,
  summarizeRuntimeSignalCoverage,
} from "./runtime-signal-coverage";
export type {
  RuntimeHarnessSignal,
  RuntimeSignalCategory,
  RuntimeSignalCoverageOptions,
  RuntimeSignalCoverageSummary,
  RuntimeSignalValue,
} from "./runtime-signal-coverage";

interface RuntimeHarnessSignalInput {
  readonly category: RuntimeSignalCategory;
  readonly context?: Record<string, RuntimeSignalValue | undefined>;
  readonly name: string;
  readonly observedAt?: string;
  readonly source?: string;
}

interface RuntimeSignalCollectorOptions {
  readonly source: string;
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

  function record(input: RuntimeHarnessSignalInput): void {
    const context = input.context ? compactContext(input.context) : undefined;

    signals.push({
      category: input.category,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
      name: input.name,
      observedAt: input.observedAt ?? new Date().toISOString(),
      source: input.source ?? options.source,
    });
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
        const performanceWithMemory = performance as Performance & {
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
    name = "runtime-signal-coverage",
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
