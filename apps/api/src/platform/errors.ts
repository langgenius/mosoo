export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: ApiErrorStatus;

  constructor(status: ApiErrorStatus, code: ApiErrorCode, message: string) {
    if (!isApiErrorStatus(status)) {
      throw new Error(`Unsupported API error status: ${String(status)}.`);
    }

    if (!isApiErrorCode(code)) {
      throw new Error(`Unsupported API error code: ${String(code)}.`);
    }

    super(message);
    this.code = code;
    this.name = "ApiError";
    this.status = status;
  }
}

export const API_ERROR_STATUS = {
  badGateway: 502,
  badRequest: 400,
  conflict: 409,
  forbidden: 403,
  internalServerError: 500,
  notFound: 404,
  unauthorized: 401,
  upgradeRequired: 426,
} as const;

export type ApiErrorStatus = (typeof API_ERROR_STATUS)[keyof typeof API_ERROR_STATUS];

export const API_ERROR_CODE = {
  activeRuntimeLeaseRequired: "ACTIVE_RUNTIME_LEASE_REQUIRED",
  agentChannelBindingAlreadyExists: "AGENT_CHANNEL_BINDING_ALREADY_EXISTS",
  agentLiveVersionConflict: "AGENT_LIVE_VERSION_CONFLICT",
  agentLiveVersionRequired: "AGENT_LIVE_VERSION_REQUIRED",
  agentNotPublished: "AGENT_NOT_PUBLISHED",
  agentPublishNotReady: "AGENT_PUBLISH_NOT_READY",
  agentPublishPersonalMcp: "AGENT_PUBLISH_PERSONAL_MCP",
  agentSessionNotReady: "AGENT_SESSION_NOT_READY",
  channelAppBound: "CHANNEL_APP_BOUND",
  discordAuthTestFailed: "DISCORD_AUTH_TEST_FAILED",
  discordAuthTestNotBot: "DISCORD_AUTH_TEST_NOT_BOT",
  forbidden: "FORBIDDEN",
  internalError: "INTERNAL_ERROR",
  larkAppRegistrationPollFailed: "LARK_APP_REGISTRATION_POLL_FAILED",
  larkAppRegistrationStartFailed: "LARK_APP_REGISTRATION_START_FAILED",
  larkAuthTestFailed: "LARK_AUTH_TEST_FAILED",
  larkConnectionModeInvalid: "LARK_CONNECTION_MODE_INVALID",
  larkDomainInvalid: "LARK_DOMAIN_INVALID",
  larkWebsocketDisabled: "LARK_WEBSOCKET_DISABLED",
  notFound: "NOT_FOUND",
  organizationCreationSlotOccupied: "ORGANIZATION_CREATION_SLOT_OCCUPIED",
  personalOrganizationSlotOccupied: "PERSONAL_ORGANIZATION_SLOT_OCCUPIED",
  ownerDebugTerminalUnavailable: "OWNER_DEBUG_TERMINAL_UNAVAILABLE",
  runtimeBackupConfigMissing: "RUNTIME_BACKUP_CONFIG_MISSING",
  runtimeEventCursorInvalid: "RUNTIME_EVENT_CURSOR_INVALID",
  runtimeEventLimitInvalid: "RUNTIME_EVENT_LIMIT_INVALID",
  runtimeReadyWaitUnsupported: "RUNTIME_READY_WAIT_UNSUPPORTED",
  slackAppBound: "SLACK_APP_BOUND",
  slackAuthTestFailed: "SLACK_AUTH_TEST_FAILED",
  slackAuthTestMissingBot: "SLACK_AUTH_TEST_MISSING_BOT",
  slackAuthTestMissingTeam: "SLACK_AUTH_TEST_MISSING_TEAM",
  telegramAuthTestFailed: "TELEGRAM_AUTH_TEST_FAILED",
  unauthorized: "UNAUTHORIZED",
  validationFailed: "VALIDATION_FAILED",
  websocketRequired: "WEBSOCKET_REQUIRED",
  wechatAccountBound: "WECHAT_ACCOUNT_BOUND",
  wechatBindingInconsistent: "WECHAT_BINDING_INCONSISTENT",
  wechatQrPairingNotFound: "WECHAT_QR_PAIRING_NOT_FOUND",
  wechatQrStartFailed: "WECHAT_QR_START_FAILED",
  wechatQrStatusFailed: "WECHAT_QR_STATUS_FAILED",
  wechatQrTokenRequired: "WECHAT_QR_TOKEN_REQUIRED",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

const API_ERROR_STATUS_BY_CODE = {
  [API_ERROR_CODE.activeRuntimeLeaseRequired]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.agentChannelBindingAlreadyExists]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.agentLiveVersionConflict]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.agentLiveVersionRequired]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.agentNotPublished]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.agentPublishNotReady]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.agentPublishPersonalMcp]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.agentSessionNotReady]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.channelAppBound]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.discordAuthTestFailed]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.discordAuthTestNotBot]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.forbidden]: API_ERROR_STATUS.forbidden,
  [API_ERROR_CODE.internalError]: API_ERROR_STATUS.internalServerError,
  [API_ERROR_CODE.larkAppRegistrationPollFailed]: API_ERROR_STATUS.badGateway,
  [API_ERROR_CODE.larkAppRegistrationStartFailed]: API_ERROR_STATUS.badGateway,
  [API_ERROR_CODE.larkAuthTestFailed]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.larkConnectionModeInvalid]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.larkDomainInvalid]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.larkWebsocketDisabled]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.notFound]: API_ERROR_STATUS.notFound,
  [API_ERROR_CODE.organizationCreationSlotOccupied]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.personalOrganizationSlotOccupied]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.ownerDebugTerminalUnavailable]: API_ERROR_STATUS.conflict,
  [API_ERROR_CODE.runtimeBackupConfigMissing]: API_ERROR_STATUS.internalServerError,
  [API_ERROR_CODE.runtimeEventCursorInvalid]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.runtimeEventLimitInvalid]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.runtimeReadyWaitUnsupported]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.slackAppBound]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.slackAuthTestFailed]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.slackAuthTestMissingBot]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.slackAuthTestMissingTeam]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.telegramAuthTestFailed]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.unauthorized]: API_ERROR_STATUS.unauthorized,
  [API_ERROR_CODE.validationFailed]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.websocketRequired]: API_ERROR_STATUS.upgradeRequired,
  [API_ERROR_CODE.wechatAccountBound]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.wechatBindingInconsistent]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.wechatQrPairingNotFound]: API_ERROR_STATUS.badRequest,
  [API_ERROR_CODE.wechatQrStartFailed]: API_ERROR_STATUS.badGateway,
  [API_ERROR_CODE.wechatQrStatusFailed]: API_ERROR_STATUS.badGateway,
  [API_ERROR_CODE.wechatQrTokenRequired]: API_ERROR_STATUS.badRequest,
} as const satisfies Record<ApiErrorCode, ApiErrorStatus>;

const API_ERROR_CODES = Object.values(API_ERROR_CODE);
const API_ERROR_STATUSES = Object.values(API_ERROR_STATUS);

const API_ERROR_CODE_SET: ReadonlySet<string> = new Set(API_ERROR_CODES);
const API_ERROR_STATUS_SET: ReadonlySet<number> = new Set(API_ERROR_STATUSES);

export interface ApiErrorResponseDetails {
  code: ApiErrorCode;
  message: string;
  status: ApiErrorStatus;
}

export function isApiErrorCode(value: string): value is ApiErrorCode {
  return API_ERROR_CODE_SET.has(value);
}

export function isApiErrorStatus(value: number): value is ApiErrorStatus {
  return API_ERROR_STATUS_SET.has(value);
}

export function getApiErrorStatusForCode(code: ApiErrorCode): ApiErrorStatus {
  return API_ERROR_STATUS_BY_CODE[code];
}

export function createApiError(code: ApiErrorCode, message: string): ApiError {
  return new ApiError(getApiErrorStatusForCode(code), code, message);
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
    status: getApiErrorStatusForCode(code),
  };
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorMessageChainIncludes(error: unknown, fragments: readonly string[]): boolean {
  const seen = new Set<unknown>();
  let current = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const message = current.message;

    if (fragments.some((fragment) => message.includes(fragment))) {
      return true;
    }

    current = current.cause;
  }

  return false;
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
