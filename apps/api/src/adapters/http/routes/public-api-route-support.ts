import type { PlatformId } from "@mosoo/id";
import type { Context } from "hono";

import {
  authenticatePersonalAccessToken,
  readBearerToken,
} from "../../../modules/auth/application/personal-access-token.service";
import type { PersonalAccessTokenCaller } from "../../../modules/auth/application/personal-access-token.service";
import type { AuthenticatedViewer } from "../../../modules/auth/application/viewer-auth.service";
import { FileControlError } from "../../../modules/files/application/file-store";
import {
  publicInternalError,
  publicIdempotencyConflict,
  publicInvalidJson,
  publicInvalidRequest,
  publicUnauthenticated,
  toPublicApiError,
} from "../../../modules/public-api/public-api-errors";
import type { PublicApiError } from "../../../modules/public-api/public-api-errors";
import {
  beginPublicApiIdempotency,
  clearPublicApiIdempotencyReservation,
  completePublicApiIdempotency,
  readPublicApiIdempotencyKey,
} from "../../../modules/public-api/public-api-idempotency.service";
import { enforcePublicApiRateLimit } from "../../../modules/public-api/public-api-rate-limit.service";
import { createErrorLogContext, logInfo, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { mapFileControlErrorToPublicApiError } from "./public-api-file-error-mapping";

type PublicApiRouteContext = Context<ApiGatewayEnvironment>;

interface PublicApiJsonErrorResponse {
  body: {
    error: {
      code: string;
      message: string;
    };
  };
  headers: HeadersInit;
  status: number;
}

export async function requirePublicApiCaller(
  c: PublicApiRouteContext,
): Promise<PersonalAccessTokenCaller> {
  const token = readBearerToken(c.req.raw);

  if (!isTruthy(token)) {
    throw publicUnauthenticated();
  }

  const caller = await authenticatePersonalAccessToken(c.env.DB, token);

  if (!caller) {
    throw publicUnauthenticated(
      "API key is invalid or revoked. Create a Project key in Project settings, or run mosoo login again.",
    );
  }

  logInfo("public-api.authenticated", {
    accountId: caller.viewer.id,
    projectId: caller.viewer.projectId ?? null,
    apiKeyId: caller.tokenId,
  });
  return caller;
}

export async function requireRateLimitedPublicApiViewer(
  c: PublicApiRouteContext,
): Promise<AuthenticatedViewer> {
  const caller = await requirePublicApiCaller(c);
  await enforcePublicApiRateLimit(c.env.DB, caller.viewer.projectId ?? caller.tokenId);
  return caller.viewer;
}

function errorHeaders(error: PublicApiError): HeadersInit {
  if (error.retryAfterSeconds === null) {
    return {};
  }

  return {
    "Retry-After": String(error.retryAfterSeconds),
  };
}

function isInvalidRequestError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message === "No active session run to cancel." ||
      error.message.startsWith("Attachment "))
  );
}

function toErrorResponseDetails(error: unknown): PublicApiJsonErrorResponse {
  const publicError = toPublicApiError(error);

  if (publicError) {
    return {
      body: {
        error: {
          code: publicError.code,
          message: publicError.message,
        },
      },
      headers: errorHeaders(publicError),
      status: publicError.status,
    };
  }

  if (error instanceof FileControlError) {
    return toErrorResponseDetails(mapFileControlErrorToPublicApiError(error));
  }

  if (isInvalidRequestError(error)) {
    return toErrorResponseDetails(publicInvalidRequest(error.message));
  }

  if (error instanceof SyntaxError) {
    return toErrorResponseDetails(publicInvalidJson());
  }

  return toErrorResponseDetails(publicInternalError());
}

export function toErrorResponse(error: unknown): Response {
  const response = toErrorResponseDetails(error);
  return Response.json(response.body, {
    headers: response.headers,
    status: response.status,
  });
}

function jsonReplayResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    headers: {
      "Idempotency-Replayed": "true",
    },
    status,
  });
}

/**
 * Runs a retry-safe mutation. Replays are answered before the rate limit, so
 * they never count against it. Mutations with `recover` persist 4xx responses
 * for replay and keep 5xx reservations recoverable.
 */
export async function withPublicApiIdempotency<T>(
  c: PublicApiRouteContext,
  input: {
    bodyHash: string | null;
    operation: (idempotencyKey: string | null) => Promise<T>;
    recover?: ((idempotencyKey: string, createdAt: number) => Promise<T | null>) | undefined;
    status: number;
    subject: PlatformId;
  },
): Promise<Response> {
  const idempotencyKey = readPublicApiIdempotencyKey(c.req.raw);

  if (!isTruthy(idempotencyKey)) {
    await enforcePublicApiRateLimit(c.env.DB, input.subject);
    return Response.json(await input.operation(null), { status: input.status });
  }

  const route = new URL(c.req.url).pathname;
  const begin = () =>
    beginPublicApiIdempotency(c.env.DB, {
      bodyHash: input.bodyHash,
      idempotencyKey,
      method: c.req.raw.method,
      route,
      tokenId: input.subject,
    });
  const complete = (reservationId: PlatformId, body: unknown, status: number) =>
    completePublicApiIdempotency(c.env.DB, reservationId, { body, status }).catch(
      (error: unknown) => {
        logError("public-api.idempotency_completion_failed", {
          ...createErrorLogContext(error),
          reservationId,
          route,
          tokenId: input.subject,
        });
      },
    );
  let reservation = await begin();

  if (reservation.status === "processing" && reservation.stale) {
    if (!input.recover) {
      throw publicIdempotencyConflict(
        "A previous request with this Idempotency-Key cannot be safely replayed. Its reservation will remain retained to prevent duplicate execution.",
        reservation.retryAfterSeconds,
      );
    }

    const recovered = await input.recover(idempotencyKey, reservation.createdAt);

    if (recovered !== null) {
      await complete(reservation.reservationId, recovered, input.status);
      return jsonReplayResponse(recovered, input.status);
    }

    await clearPublicApiIdempotencyReservation(c.env.DB, reservation.reservationId);
    reservation = await begin();
  }

  if (reservation.status === "replay") {
    return jsonReplayResponse(reservation.body, reservation.responseStatus);
  }

  if (reservation.status === "processing") {
    throw publicIdempotencyConflict(
      "A request with this Idempotency-Key is still processing.",
      reservation.retryAfterSeconds,
    );
  }

  const { reservationId } = reservation;

  try {
    await enforcePublicApiRateLimit(c.env.DB, input.subject);
  } catch (error) {
    await clearPublicApiIdempotencyReservation(c.env.DB, reservationId);
    throw error;
  }

  let body: T;

  try {
    body = await input.operation(idempotencyKey);
  } catch (error) {
    if (!input.recover) {
      await clearPublicApiIdempotencyReservation(c.env.DB, reservationId);
    } else {
      const response = toErrorResponseDetails(error);

      // Creation may already have committed. Keep a 5xx reservation recoverable
      // instead of making an ambiguous infrastructure error the stored result.
      if (response.status < 500) {
        await complete(reservationId, response.body, response.status);
      }
    }

    throw error;
  }

  await complete(reservationId, body, input.status);
  return Response.json(body, { status: input.status });
}
