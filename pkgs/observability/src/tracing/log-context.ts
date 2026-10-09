import {
  createTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  getContext,
  parseTraceparent,
} from "vestig";
import type { LogContext } from "vestig";

export function createTraceLogContext(input: {
  context: LogContext;
  requestId?: string;
  service: string;
  traceparent?: string;
}): LogContext {
  const parsedTraceparent =
    input.traceparent === undefined ? null : parseTraceparent(input.traceparent);

  return {
    ...input.context,
    requestId: input.requestId ?? generateRequestId(),
    service: input.service,
    spanId: generateSpanId(),
    traceId: parsedTraceparent?.traceId ?? generateTraceId(),
    ...(parsedTraceparent === null ? {} : { parentSpanId: parsedTraceparent.spanId }),
  };
}

export function createTraceparentFromContext(): string {
  const context = getContext();

  return createTraceparent(
    context?.traceId || generateTraceId(),
    context?.spanId || generateSpanId(),
  );
}
