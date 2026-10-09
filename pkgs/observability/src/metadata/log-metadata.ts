import type { LogMetadata } from "vestig";

export function formatLogValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function createErrorLogContext(error: unknown): LogMetadata {
  if (error instanceof Error) {
    return {
      error,
    };
  }

  return {
    error: {
      message: typeof error === "string" ? error : "Unknown error.",
      name: "UnknownError",
    },
  };
}

export function createRequestLogMetadata(request: Request): LogMetadata {
  const url = new URL(request.url);

  return {
    cfRay: request.headers.get("cf-ray"),
    method: request.method,
    path: url.pathname,
  };
}
