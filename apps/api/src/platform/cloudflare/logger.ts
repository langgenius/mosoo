import {
  createConsoleLogger,
  createErrorLogContext as createSharedErrorLogContext,
  createRequestLogMetadata,
  createTraceLogContext,
  createScopedWideEvent,
  createTraceparentFromContext,
  emitWideEvent,
  formatLogValue as formatSharedLogValue,
  normalizeLogMetadata,
  runWithLogContext,
  runWithLogContextAsync,
} from "@mosoo/observability";
import type { Logger, WideEventBuilder, WideEventEndOptions } from "@mosoo/observability";

const apiLogger = createConsoleLogger({
  level: "trace",
  namespace: "api",
  service: "api",
});

type LogContext = Record<string, unknown>;

const INGRESS_METADATA_HEADER_MAX_LENGTH = 128;
const INGRESS_METADATA_HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface IngressRequestMetadataProjection {
  correlationId?: string;
  requestId?: string;
}

function readIngressMetadataHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > INGRESS_METADATA_HEADER_MAX_LENGTH ||
    !INGRESS_METADATA_HEADER_PATTERN.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

function createIngressRequestMetadataProjection(
  request: Request,
): IngressRequestMetadataProjection {
  const requestId = readIngressMetadataHeader(request.headers, "x-request-id");
  const correlationId = readIngressMetadataHeader(request.headers, "x-correlation-id") ?? requestId;

  return {
    ...(correlationId === null ? {} : { correlationId }),
    ...(requestId === null ? {} : { requestId }),
  };
}

export function createApiChildLogger(namespace: string): Logger {
  return apiLogger.child(namespace);
}

export function createErrorLogContext(error: unknown): LogContext {
  return createSharedErrorLogContext(error);
}

export function createRequestLogContext(request: Request): LogContext {
  return {
    ...createRequestLogMetadata(request),
    ...createIngressRequestMetadataProjection(request),
  };
}

export function formatLogValue(value: unknown): string {
  return formatSharedLogValue(value);
}

export function createApiWideEvent(
  type: string,
  input: {
    context?: Record<string, unknown>;
    fields?: Record<string, Record<string, unknown>>;
  } = {},
): WideEventBuilder {
  return createScopedWideEvent({
    type,
    ...(input.context ? { context: input.context } : {}),
    ...(input.fields ? { fields: input.fields } : {}),
  });
}

export function emitApiWideEvent(builder: WideEventBuilder, options?: WideEventEndOptions): void {
  emitWideEvent(apiLogger, builder, options);
}

export function createCurrentTraceparent(): string {
  return createTraceparentFromContext();
}

export function runWithApiLogContext<T>(context: LogContext, fn: () => T): T {
  return runWithLogContext(context, fn);
}

export async function runWithRequestLogContext<T>(
  request: Request,
  fn: () => Promise<T>,
  context: LogContext = {},
): Promise<T> {
  const requestUrl = new URL(request.url);
  const traceparent =
    request.headers.get("traceparent") ?? requestUrl.searchParams.get("traceparent");
  const requestMetadata = createIngressRequestMetadataProjection(request);

  return runWithLogContextAsync(
    createTraceLogContext({
      context: {
        ...context,
        ...requestMetadata,
      },
      ...(requestMetadata.requestId === undefined ? {} : { requestId: requestMetadata.requestId }),
      service: "api",
      ...(traceparent === null || traceparent.length === 0 ? {} : { traceparent }),
    }),
    fn,
  );
}

export function logError(message: string, context: LogContext = {}): void {
  apiLogger.error(message, normalizeLogMetadata(context));
}

export function logInfo(message: string, context: LogContext = {}): void {
  apiLogger.info(message, normalizeLogMetadata(context));
}

export function logWarn(message: string, context: LogContext = {}): void {
  apiLogger.warn(message, normalizeLogMetadata(context));
}
