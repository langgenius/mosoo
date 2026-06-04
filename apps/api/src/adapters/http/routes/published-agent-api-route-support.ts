import type { AgentId, PlatformId, PublicThreadId } from "@mosoo/id";
import type { Context } from "hono";

import {
  authenticatePersonalAccessToken,
  readBearerToken,
} from "../../../modules/auth/application/personal-access-token.service";
import type { PersonalAccessTokenCaller } from "../../../modules/auth/application/personal-access-token.service";
import {
  authenticatePublicApiCaller,
  readPublicApiBearerToken,
} from "../../../modules/auth/application/public-api-caller.service";
import type { PublicApiCaller } from "../../../modules/auth/application/public-api-caller.service";
import { FileControlError } from "../../../modules/files/application/file-control-errors";
import {
  publicInternalError,
  publicInvalidJson,
  publicInvalidRequest,
  publicReadinessBlocked,
  publicUnauthenticated,
  toPublishedAgentApiError,
} from "../../../modules/public-api/published-agent-api-errors";
import type { PublishedAgentApiError } from "../../../modules/public-api/published-agent-api-errors";
import {
  beginPublicApiIdempotency,
  clearPublicApiIdempotencyReservation,
  completePublicApiIdempotency,
  readPublicApiIdempotencyKey,
} from "../../../modules/public-api/published-agent-idempotency.service";
import { enforcePublishedApiRateLimit } from "../../../modules/public-api/published-agent-rate-limit.service";
import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, isApiError } from "../../../platform/errors";
import type { ApiError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { mapFileControlErrorToPublicApiError } from "./published-agent-file-error-mapping";

type PublishedApiRouteContext = Context<ApiGatewayEnvironment>;

interface PublishedApiAuthenticatedOperation {
  caller: PersonalAccessTokenCaller;
}

interface PublishedApiThreadOperation {
  caller: PublicApiCaller;
}

type RouteValue<T> = T | (() => T);

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

function resolveRequiredRouteValue<T>(value: RouteValue<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

async function requirePatCaller(c: PublishedApiRouteContext): Promise<PersonalAccessTokenCaller> {
  const token = readBearerToken(c.req.raw);

  if (!isTruthy(token)) {
    throw publicUnauthenticated();
  }

  const caller = await authenticatePersonalAccessToken(c.env.DB, token);

  if (!caller) {
    throw publicUnauthenticated("Personal Access Token is invalid or revoked.");
  }

  return caller;
}

async function requireRateLimitedPatCaller(
  c: PublishedApiRouteContext,
): Promise<PersonalAccessTokenCaller> {
  const caller = await requirePatCaller(c);
  await enforcePublishedApiRateLimit(c.env.DB, caller.tokenId);
  return caller;
}

async function requirePublicApiCaller(c: PublishedApiRouteContext): Promise<PublicApiCaller> {
  const token = readPublicApiBearerToken(c.req.raw);

  if (!isTruthy(token)) {
    throw publicUnauthenticated("A valid Personal Access Token is required.");
  }

  const caller = await authenticatePublicApiCaller(c.env.DB, token);

  if (!caller) {
    throw publicUnauthenticated("Personal Access Token is invalid or revoked.");
  }

  return caller;
}

async function requireRateLimitedPublicApiCaller(
  c: PublishedApiRouteContext,
): Promise<PublicApiCaller> {
  const caller = await requirePublicApiCaller(c);
  await enforcePublishedApiRateLimit(c.env.DB, caller.tokenId);
  return caller;
}

function errorHeaders(error: PublishedAgentApiError): HeadersInit {
  if (error.retryAfterSeconds === null) {
    return {};
  }

  return {
    "Retry-After": String(error.retryAfterSeconds),
  };
}

function toErrorResponseDetails(error: unknown): PublicApiJsonErrorResponse {
  const publicError = toPublishedAgentApiError(error);

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

  if (isPublishedApiRequestValidationError(error)) {
    return toErrorResponseDetails(publicInvalidRequest(error.message));
  }

  if (isInvalidRequestError(error)) {
    return {
      body: {
        error: {
          code: "invalid_request",
          message: toPublicInvalidRequestMessage(error.message),
        },
      },
      headers: {},
      status: 400,
    };
  }

  if (error instanceof Error && error.message.startsWith("Agent is not ready to run:")) {
    return toErrorResponseDetails(publicReadinessBlocked(error.message));
  }

  if (error instanceof SyntaxError) {
    return toErrorResponseDetails(publicInvalidJson());
  }

  logError("published-agent-api.failed", createErrorLogContext(error));
  return toErrorResponseDetails(publicInternalError());
}

function toPublicInvalidRequestMessage(message: string): string {
  return message === "At least one session event is required."
    ? "At least one thread event is required."
    : message;
}

function toErrorResponse(error: unknown): Response {
  const response = toErrorResponseDetails(error);
  return Response.json(response.body, {
    headers: response.headers,
    status: response.status,
  });
}

function isPublishedApiRequestValidationError(error: unknown): error is ApiError {
  if (!isApiError(error) || error.status !== 400) {
    return false;
  }

  return (
    error.code === API_ERROR_CODE.runtimeEventCursorInvalid ||
    error.code === API_ERROR_CODE.runtimeEventLimitInvalid
  );
}

function isInvalidRequestError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    [
      "At least one session event is required.",
      "No active session run to cancel.",
      "Permission decision is required.",
      "Permission request id is required.",
      "User message text is required.",
    ].includes(error.message) || error.message.startsWith("Attachment ")
  );
}

function jsonReplayResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    headers: {
      "Idempotency-Replayed": "true",
    },
    status,
  });
}

async function runPublicApiIdempotentJson<T>(
  c: PublishedApiRouteContext,
  input: {
    bodyHash: string | null;
    idempotencySubjectId: PlatformId;
    beforeOperation?: (() => Promise<void>) | undefined;
    operation: () => Promise<T>;
    persistOperationErrors?: boolean | undefined;
    status: number;
  },
): Promise<Response> {
  const idempotencyKey = readPublicApiIdempotencyKey(c.req.raw);

  if (!isTruthy(idempotencyKey)) {
    await input.beforeOperation?.();
    return Response.json(await input.operation(), { status: input.status });
  }

  const reservation = await beginPublicApiIdempotency(c.env.DB, {
    bodyHash: input.bodyHash,
    idempotencyKey,
    method: c.req.raw.method,
    route: new URL(c.req.url).pathname,
    tokenId: input.idempotencySubjectId,
  });

  if (reservation.status === "replay") {
    return jsonReplayResponse(reservation.body, reservation.responseStatus);
  }

  let body: T;

  try {
    await input.beforeOperation?.();
  } catch (error) {
    await clearPublicApiIdempotencyReservation(c.env.DB, reservation.reservationId);
    throw error;
  }

  try {
    body = await input.operation();
  } catch (error) {
    if (input.persistOperationErrors === true) {
      const errorResponse = toErrorResponseDetails(error);
      await completePublicApiIdempotency(c.env.DB, reservation.reservationId, {
        body: errorResponse.body,
        status: errorResponse.status,
      }).catch((completionError: unknown) => {
        logError("published-agent-api.idempotency_error_completion_failed", {
          ...createErrorLogContext(completionError),
          reservationId: reservation.reservationId,
          route: new URL(c.req.url).pathname,
          tokenId: input.idempotencySubjectId,
        });
      });

      return Response.json(errorResponse.body, {
        headers: errorResponse.headers,
        status: errorResponse.status,
      });
    }

    await clearPublicApiIdempotencyReservation(c.env.DB, reservation.reservationId);
    throw error;
  }

  try {
    await completePublicApiIdempotency(c.env.DB, reservation.reservationId, {
      body,
      status: input.status,
    });
  } catch (error) {
    logError("published-agent-api.idempotency_completion_failed", {
      ...createErrorLogContext(error),
      reservationId: reservation.reservationId,
      route: new URL(c.req.url).pathname,
      tokenId: input.idempotencySubjectId,
    });
  }

  return Response.json(body, { status: input.status });
}

export async function runPublishedApiAuthenticatedJson<T>(
  c: PublishedApiRouteContext,
  operation: (caller: PersonalAccessTokenCaller) => Promise<T>,
  status = 200,
): Promise<Response> {
  try {
    const caller = await requireRateLimitedPatCaller(c);
    return Response.json(await operation(caller), { status });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function runPublishedApiSessionMutation<T, Prepared = undefined>(
  c: PublishedApiRouteContext,
  input: {
    bodyHash?: (prepared: Prepared) => string | null;
    operation: (
      input: PublishedApiAuthenticatedOperation & {
        prepared: Prepared;
        threadId: PublicThreadId;
      },
    ) => Promise<T>;
    prepare?: (input: PublishedApiAuthenticatedOperation) => Promise<Prepared>;
    status?: number | undefined;
    threadId: RouteValue<PublicThreadId>;
  },
): Promise<Response> {
  try {
    const caller = await requirePatCaller(c);
    const threadId = resolveRequiredRouteValue(input.threadId);
    const operationInput: PublishedApiAuthenticatedOperation = { caller };
    const prepared = input.prepare ? await input.prepare(operationInput) : (undefined as Prepared);
    const status = input.status ?? 200;
    const operation = async () => input.operation({ ...operationInput, prepared, threadId });
    const beforeOperation = () => enforcePublishedApiRateLimit(c.env.DB, caller.tokenId);

    if (input.bodyHash) {
      return await runPublicApiIdempotentJson(c, {
        bodyHash: input.bodyHash(prepared),
        beforeOperation,
        idempotencySubjectId: caller.tokenId,
        operation,
        status,
      });
    }

    await beforeOperation();
    return Response.json(await operation(), { status });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function runPublishedApiThreadReadJson<T>(
  c: PublishedApiRouteContext,
  input: {
    operation: (input: PublishedApiThreadOperation & { threadId: PublicThreadId }) => Promise<T>;
    status?: number | undefined;
    threadId: RouteValue<PublicThreadId>;
  },
): Promise<Response> {
  try {
    const caller = await requireRateLimitedPublicApiCaller(c);
    const threadId = resolveRequiredRouteValue(input.threadId);
    const status = input.status ?? 200;

    return Response.json(await input.operation({ caller, threadId }), { status });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function runPublishedApiThreadMutation<T, Prepared = undefined>(
  c: PublishedApiRouteContext,
  input: {
    agentId: RouteValue<AgentId>;
    bodyHash?: (prepared: Prepared) => string | null;
    operation: (
      input: PublishedApiThreadOperation & { agentId: AgentId; prepared: Prepared },
    ) => Promise<T>;
    prepare?: (input: PublishedApiThreadOperation) => Promise<Prepared>;
    status?: number | undefined;
  },
): Promise<Response> {
  try {
    const caller = await requirePublicApiCaller(c);
    const agentId = resolveRequiredRouteValue(input.agentId);
    const operationInput: PublishedApiThreadOperation = { caller };
    const prepared = input.prepare ? await input.prepare(operationInput) : (undefined as Prepared);
    const status = input.status ?? 200;
    const operation = async () => input.operation({ ...operationInput, agentId, prepared });
    const beforeOperation = () => enforcePublishedApiRateLimit(c.env.DB, caller.tokenId);

    if (input.bodyHash) {
      return await runPublicApiIdempotentJson(c, {
        bodyHash: input.bodyHash(prepared),
        beforeOperation,
        idempotencySubjectId: caller.tokenId,
        operation,
        persistOperationErrors: true,
        status,
      });
    }

    await beforeOperation();
    return Response.json(await operation(), { status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
