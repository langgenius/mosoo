export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: ApiErrorStatus;

  constructor(status: ApiErrorStatus, code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ApiError";
    this.status = status;
  }
}

const API_ERROR_STATUS = {
  badRequest: 400,
  conflict: 409,
  forbidden: 403,
  internalServerError: 500,
  notFound: 404,
  unauthorized: 401,
} as const;

export type ApiErrorStatus = (typeof API_ERROR_STATUS)[keyof typeof API_ERROR_STATUS];

export const API_ERROR_CODE = {
  agentLiveVersionRequired: "AGENT_LIVE_VERSION_REQUIRED",
  agentPublishNotReady: "AGENT_PUBLISH_NOT_READY",
  agentSessionNotReady: "AGENT_SESSION_NOT_READY",
  environmentArtifactFailed: "ENVIRONMENT_ARTIFACT_FAILED",
  environmentArtifactPreparing: "ENVIRONMENT_ARTIFACT_PREPARING",
  forbidden: "FORBIDDEN",
  internalError: "INTERNAL_ERROR",
  notFound: "NOT_FOUND",
  sessionRunCheckpointPending: "SESSION_RUN_CHECKPOINT_PENDING",
  sessionRuntimeOperationUnavailable: "SESSION_RUNTIME_OPERATION_UNAVAILABLE",
  sessionPreviewExpired: "SESSION_PREVIEW_EXPIRED",
  sessionRunActive: "SESSION_RUN_ACTIVE",
  sessionRunClientRequestDuplicate: "SESSION_RUN_CLIENT_REQUEST_DUPLICATE",
  unauthorized: "UNAUTHORIZED",
  validationFailed: "VALIDATION_FAILED",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

const API_ERROR_STATUS_BY_CODE = {
  [API_ERROR_CODE.agentLiveVersionRequired]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.agentPublishNotReady]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.agentSessionNotReady]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.environmentArtifactFailed]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.environmentArtifactPreparing]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.forbidden]: API_ERROR_STATUS.forbidden,
  [API_ERROR_CODE.internalError]: API_ERROR_STATUS.internalServerError,
  [API_ERROR_CODE.notFound]: API_ERROR_STATUS.notFound,
  [API_ERROR_CODE.sessionRunCheckpointPending]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.sessionRuntimeOperationUnavailable]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.sessionPreviewExpired]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.sessionRunActive]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.sessionRunClientRequestDuplicate]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.unauthorized]: API_ERROR_STATUS.unauthorized,
  [API_ERROR_CODE.validationFailed]: API_ERROR_STATUS.badRequest,
} as const satisfies Record<ApiErrorCode, ApiErrorStatus>;

export interface ApiErrorResponseDetails {
  code: ApiErrorCode;
  message: string;
  status: ApiErrorStatus;
}

export function createApiError(code: ApiErrorCode, message: string): ApiError {
  return new ApiError(API_ERROR_STATUS_BY_CODE[code], code, message);
}

export function toApiErrorResponseDetails(
  error: unknown,
  fallback: {
    code?: ApiErrorCode | undefined;
    message?: string | undefined;
  } = {},
): ApiErrorResponseDetails {
  if (isApiError(error)) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  const code = fallback.code ?? API_ERROR_CODE.internalError;

  return {
    code,
    message: fallback.message ?? "Internal server error.",
    status: API_ERROR_STATUS_BY_CODE[code],
  };
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function unauthorizedError(message = "Unauthorized."): ApiError {
  return createApiError(API_ERROR_CODE.unauthorized, message);
}

export function forbiddenError(
  message = "You do not have permission to perform this action.",
): ApiError {
  return createApiError(API_ERROR_CODE.forbidden, message);
}

export function notFoundError(message = "Not found."): ApiError {
  return createApiError(API_ERROR_CODE.notFound, message);
}

export function validationError(
  message: string,
  code: ApiErrorCode = API_ERROR_CODE.validationFailed,
): ApiError {
  return createApiError(code, message);
}
