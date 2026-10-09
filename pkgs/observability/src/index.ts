export { createTraceLogContext, createTraceparentFromContext } from "./tracing/log-context";
export { createConsoleLogger } from "./logging/logger";
export {
  createErrorLogContext,
  createRequestLogMetadata,
  formatLogValue,
} from "./metadata/log-metadata";
export { createScopedWideEvent, emitWideEvent } from "./tracing/wide-events";
export {
  generateTraceId,
  parseTraceparent,
  withContext,
  withContextAsync,
  type Logger,
  type WideEventBuilder,
  type WideEventEndOptions,
} from "vestig";
