import type { DriverBootPayload, DriverLogEntry } from "@mosoo/driver-protocol";
import {
  createBufferedSinkLogger,
  createTraceLogContext,
  runWithLogContextAsync,
  toPrimitiveLogRecord,
} from "@mosoo/observability";
import type { LogEntry, Logger } from "@mosoo/observability";

import type { DriverInstanceSocket } from "../runtime/driver-instance-socket";

function createFallbackPayload(
  message: string,
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    level: "error",
    message,
    timestamp: new Date().toISOString(),
    ...metadata,
  };
}

function logFallback(message: string, metadata: Record<string, unknown> = {}): void {
  globalThis.reportError(new Error(JSON.stringify(createFallbackPayload(message, metadata))));
}

function toDriverLogContext(entry: LogEntry): DriverLogEntry["context"] | undefined {
  const { context } = entry;

  if (!context) {
    return undefined;
  }

  const nextContext: NonNullable<DriverLogEntry["context"]> = {};
  const { parentSpanId } = context;
  const { requestId } = context;
  const { sandboxId } = context;
  const { sessionId } = context;
  const { spanId } = context;
  const { traceId } = context;

  if (typeof parentSpanId === "string") {
    nextContext.parentSpanId = parentSpanId;
  }

  if (typeof requestId === "string") {
    nextContext.requestId = requestId;
  }

  if (typeof sandboxId === "string") {
    nextContext.sandboxId = sandboxId;
  }

  if (typeof sessionId === "string") {
    nextContext.sessionId = sessionId;
  }

  if (typeof spanId === "string") {
    nextContext.spanId = spanId;
  }

  if (typeof traceId === "string") {
    nextContext.traceId = traceId;
  }

  return Object.keys(nextContext).length > 0 ? nextContext : undefined;
}

function toDriverLogEntry(entry: LogEntry, seq: number): DriverLogEntry {
  const context = toDriverLogContext(entry);

  return {
    ...(context ? { context } : {}),
    ...(entry.error
      ? {
          error: {
            ...(typeof entry.error.code === "number" || typeof entry.error.code === "string"
              ? { code: entry.error.code }
              : {}),
            message: entry.error.message,
            name: entry.error.name,
            ...(entry.error.stack === undefined ? {} : { stack: entry.error.stack ?? null }),
          },
        }
      : {}),
    ...(entry.metadata ? { fields: toPrimitiveLogRecord(entry.metadata) } : {}),
    level: entry.level,
    message: entry.message || "driver.log",
    ...(entry.namespace === undefined ? {} : { namespace: entry.namespace }),
    seq,
    timestamp: entry.timestamp,
  };
}

export function createDriverLogger(
  payload: DriverBootPayload,
  socket: DriverInstanceSocket,
): Logger {
  let nextSeq = 0;

  return createBufferedSinkLogger({
    context: {
      sandboxId: payload.sandboxId,
    },
    flushIntervalMs: 200,
    level: "trace",
    maxBatchSize: 32,
    maxBufferSize: 512,
    name: "driver-orpc",
    namespace: "driver",
    onError: (error, entries) => {
      logFallback("driver.log.uplink.failed", {
        batchSize: entries.length,
        driverInstanceId: payload.driverInstanceId,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    },
    service: "driver",
    sink: async (entries) => {
      await socket.pushLogs({
        logs: entries.map((entry) => {
          const mapped = toDriverLogEntry(entry, nextSeq);
          nextSeq += 1;
          return mapped;
        }),
      });
    },
  });
}

export async function runWithDriverLogContext<T>(
  payload: DriverBootPayload,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithLogContextAsync(
    createTraceLogContext({
      context: {
        sandboxId: payload.sandboxId,
      },
      service: "driver",
      traceparent: payload.traceparent,
    }),
    fn,
  );
}

export function logDriverFatal(error: unknown, metadata: Record<string, unknown> = {}): void {
  logFallback("driver.fatal", {
    error: error instanceof Error ? error.message : "Unknown error.",
    ...metadata,
  });
}
