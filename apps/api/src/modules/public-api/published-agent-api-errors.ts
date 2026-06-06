import type { PublicApiErrorCode } from "@mosoo/contracts/public-api";

import { API_ERROR_CODE, isApiError } from "../../platform/errors";

export interface PublishedAgentApiErrorInput {
  code: PublicApiErrorCode;
  message: string;
  retryAfterSeconds?: number;
  status: number;
}

export class PublishedAgentApiError extends Error {
  readonly code: PublicApiErrorCode;
  readonly retryAfterSeconds: number | null;
  readonly status: number;

  constructor({ code, message, retryAfterSeconds, status }: PublishedAgentApiErrorInput) {
    super(message);
    this.name = "PublishedAgentApiError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds ?? null;
    this.status = status;
  }
}

export function toPublishedAgentApiError(error: unknown): PublishedAgentApiError | null {
  if (error instanceof PublishedAgentApiError) {
    return error;
  }

  if (!isApiError(error)) {
    return null;
  }

  switch (error.code) {
    case API_ERROR_CODE.agentSessionNotReady:
      return publicReadinessBlocked(error.message);
    case API_ERROR_CODE.forbidden:
      return publicForbidden(error.message);
    case API_ERROR_CODE.notFound:
      return publicNotFound(error.message);
    case API_ERROR_CODE.unauthorized:
      return publicUnauthenticated(error.message);
    default:
      return null;
  }
}

export function publicUnauthenticated(
  message = "A valid Access Token is required.",
): PublishedAgentApiError {
  return new PublishedAgentApiError({ code: "unauthenticated", message, status: 401 });
}

export function publicForbidden(message: string): PublishedAgentApiError {
  return new PublishedAgentApiError({ code: "forbidden", message, status: 403 });
}

export function publicInvalidRequest(message: string): PublishedAgentApiError {
  return new PublishedAgentApiError({ code: "invalid_request", message, status: 400 });
}

export function publicNotFound(message: string): PublishedAgentApiError {
  return new PublishedAgentApiError({ code: "not_found", message, status: 404 });
}

export function publicAgentNotPublished(message: string): PublishedAgentApiError {
  return new PublishedAgentApiError({ code: "agent_not_published", message, status: 409 });
}

export function publicServiceInactive(message: string): PublishedAgentApiError {
  return new PublishedAgentApiError({ code: "service_inactive", message, status: 409 });
}

export function publicReadinessBlocked(message: string): PublishedAgentApiError {
  return new PublishedAgentApiError({ code: "readiness_blocked", message, status: 409 });
}

export function publicInvalidJson(): PublishedAgentApiError {
  return new PublishedAgentApiError({
    code: "invalid_json",
    message: "Request body must be valid JSON.",
    status: 400,
  });
}

export function publicInternalError(): PublishedAgentApiError {
  return new PublishedAgentApiError({
    code: "internal_error",
    message: "Published Agent API request failed.",
    status: 500,
  });
}

export function publicIdempotencyConflict(
  message: string,
  retryAfterSeconds = 2,
): PublishedAgentApiError {
  return new PublishedAgentApiError({
    code: "idempotency_conflict",
    message,
    retryAfterSeconds,
    status: 409,
  });
}

export function publicRateLimited(retryAfterSeconds: number): PublishedAgentApiError {
  return new PublishedAgentApiError({
    code: "rate_limited",
    message: "Public API rate limit exceeded. Retry after the indicated number of seconds.",
    retryAfterSeconds,
    status: 429,
  });
}
