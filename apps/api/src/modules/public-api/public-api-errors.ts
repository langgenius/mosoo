import type { PublicApiErrorCode } from "@mosoo/contracts/public-api";

import { API_ERROR_CODE, isApiError } from "../../platform/errors";

export interface PublicApiErrorInput {
  code: PublicApiErrorCode;
  message: string;
  retryAfterSeconds?: number;
  status: number;
}

export class PublicApiError extends Error {
  readonly code: PublicApiErrorCode;
  readonly retryAfterSeconds: number | null;
  readonly status: number;

  constructor({ code, message, retryAfterSeconds, status }: PublicApiErrorInput) {
    super(message);
    this.name = "PublicApiError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds ?? null;
    this.status = status;
  }
}

export function toPublicApiError(error: unknown): PublicApiError | null {
  if (error instanceof PublicApiError) {
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
): PublicApiError {
  return new PublicApiError({ code: "unauthenticated", message, status: 401 });
}

export function publicForbidden(message: string): PublicApiError {
  return new PublicApiError({ code: "forbidden", message, status: 403 });
}

export function publicInvalidRequest(message: string): PublicApiError {
  return new PublicApiError({ code: "invalid_request", message, status: 400 });
}

export function publicNotFound(message: string): PublicApiError {
  return new PublicApiError({ code: "not_found", message, status: 404 });
}

export function publicAgentNotExposed(message: string): PublicApiError {
  return new PublicApiError({ code: "agent_not_published", message, status: 409 });
}

export function publicServiceInactive(message: string): PublicApiError {
  return new PublicApiError({ code: "service_inactive", message, status: 409 });
}

export function publicReadinessBlocked(message: string): PublicApiError {
  return new PublicApiError({ code: "readiness_blocked", message, status: 409 });
}

export function publicInvalidJson(): PublicApiError {
  return new PublicApiError({
    code: "invalid_json",
    message: "Request body must be valid JSON.",
    status: 400,
  });
}

export function publicInternalError(): PublicApiError {
  return new PublicApiError({
    code: "internal_error",
    message: "Public API request failed.",
    status: 500,
  });
}

export function publicIdempotencyConflict(message: string, retryAfterSeconds = 2): PublicApiError {
  return new PublicApiError({
    code: "idempotency_conflict",
    message,
    retryAfterSeconds,
    status: 409,
  });
}

export function publicRateLimited(retryAfterSeconds: number): PublicApiError {
  return new PublicApiError({
    code: "rate_limited",
    message: "Public API rate limit exceeded. Retry after the indicated number of seconds.",
    retryAfterSeconds,
    status: 429,
  });
}
