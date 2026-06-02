export {
  createTraceLogContext,
  createRequestTraceLogContext,
  createTraceparentFromContext,
  getActiveLogContext,
  runWithLogContext,
  runWithLogContextAsync,
  type TraceLogContext,
} from "./tracing/log-context";
export { createConsoleLogger, createBufferedSinkLogger } from "./logging/logger";
export {
  createErrorLogContext,
  createRequestLogMetadata,
  formatLogValue,
  normalizeLogContext,
  normalizeLogMetadata,
  toPrimitiveLogRecord,
} from "./metadata/log-metadata";
export { createScopedWideEvent, emitWideEvent } from "./tracing/wide-events";
export {
  createTraceparent,
  generateSpanId,
  generateTraceId,
  getActiveSpan,
  parseTraceparent,
  type LogContext,
  type LogEntry,
  type LogLevel,
  type Logger,
  type WideEventBuilder,
  type WideEventEndOptions,
} from "vestig";
