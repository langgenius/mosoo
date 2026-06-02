import {
  createTraceparent,
  generateRequestId,
  generateSpanId,
  generateTraceId,
  getContext,
  parseTraceparent,
  withContext,
  withContextAsync,
} from "vestig";
import type { LogContext } from "vestig";

import { normalizeLogContext } from "../metadata/log-metadata";

export interface TraceLogContext extends LogContext {
  parentSpanId?: string;
  requestId: string;
  service: string;
  spanId: string;
  traceId: string;
}

interface CreateTraceLogContextInput {
  context?: Record<string, unknown>;
  parentSpanId?: string | null;
  requestId?: string | null;
  service: string;
  spanId?: string | null;
  traceId?: string | null;
  traceparent?: string | null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.length > 0;
}

function readContextString(context: Partial<LogContext> | null | undefined, key: string): string {
  const value = context?.[key];
  return typeof value === "string" && value.length > 0 ? value : "";
}

export function createTraceLogContext(input: CreateTraceLogContextInput): TraceLogContext {
  const parsedTraceparent = isNonEmptyString(input.traceparent)
    ? parseTraceparent(input.traceparent)
    : null;
  const traceId = input.traceId ?? parsedTraceparent?.traceId ?? generateTraceId();
  const spanId = input.spanId ?? generateSpanId();
  const parentSpanId = input.parentSpanId ?? parsedTraceparent?.spanId ?? null;
  const context = normalizeLogContext(input.context);

  return {
    ...context,
    requestId: input.requestId ?? generateRequestId(),
    service: input.service,
    spanId,
    traceId,
    ...(isNonEmptyString(parentSpanId) ? { parentSpanId } : {}),
  };
}

export function createRequestTraceLogContext(
  request: Request,
  input: {
    context?: Record<string, unknown>;
    service: string;
  },
): TraceLogContext {
  const requestUrl = new URL(request.url);
  const requestId = request.headers.get("x-request-id");
  const traceparent =
    request.headers.get("traceparent") ?? requestUrl.searchParams.get("traceparent");

  return createTraceLogContext({
    service: input.service,
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(isNonEmptyString(requestId) ? { requestId } : {}),
    ...(isNonEmptyString(traceparent) ? { traceparent } : {}),
  });
}

export function createTraceparentFromContext(context?: Partial<LogContext> | null): string {
  const activeContext = context ?? getContext();

  const traceId = readContextString(activeContext, "traceId");
  const spanId = readContextString(activeContext, "spanId");

  return createTraceparent(
    traceId.length > 0 ? traceId : generateTraceId(),
    spanId.length > 0 ? spanId : generateSpanId(),
  );
}

export function getActiveLogContext(): LogContext | undefined {
  return getContext();
}

export function runWithLogContext<T>(context: Record<string, unknown>, fn: () => T): T {
  return withContext(normalizeLogContext(context), fn);
}

export async function runWithLogContextAsync<T>(
  context: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  return withContextAsync(normalizeLogContext(context), fn);
}
