import { describe, expect, test } from "bun:test";

import {
  API_ERROR_CODE,
  API_ERROR_STATUS,
  ApiError,
  createApiError,
  getApiErrorStatusForCode,
  isApiErrorCode,
  isApiErrorStatus,
  toApiErrorResponseDetails,
  validationError,
} from "../src/platform/errors";
import type { ApiErrorCode, ApiErrorStatus } from "../src/platform/errors";

describe("platform error taxonomy", () => {
  test("maps public error codes to finite HTTP statuses", () => {
    expect(getApiErrorStatusForCode(API_ERROR_CODE.notFound)).toBe(API_ERROR_STATUS.notFound);
    expect(getApiErrorStatusForCode(API_ERROR_CODE.wechatQrStartFailed)).toBe(
      API_ERROR_STATUS.badGateway,
    );
    expect(
      createApiError(API_ERROR_CODE.websocketRequired, "Expected WebSocket upgrade."),
    ).toMatchObject({
      code: "WEBSOCKET_REQUIRED",
      message: "Expected WebSocket upgrade.",
      status: 426,
    });
  });

  test("admits only known public codes and statuses", () => {
    expect(isApiErrorCode("VALIDATION_FAILED")).toBe(true);
    expect(isApiErrorCode("LOCAL_STRING")).toBe(false);
    expect(isApiErrorStatus(400)).toBe(true);
    expect(isApiErrorStatus(418)).toBe(false);
  });

  test("normalizes unknown errors through the public fallback", () => {
    expect(toApiErrorResponseDetails(validationError("Label is required."))).toEqual({
      code: "VALIDATION_FAILED",
      message: "Label is required.",
      status: 400,
    });

    expect(
      toApiErrorResponseDetails(new Error("database exploded"), {
        message: "Access token request failed.",
      }),
    ).toEqual({
      code: "INTERNAL_ERROR",
      message: "Access token request failed.",
      status: 500,
    });
  });

  test("rejects unsupported constructor values at runtime", () => {
    expect(
      () => new ApiError(418 as ApiErrorStatus, API_ERROR_CODE.validationFailed, "Nope."),
    ).toThrow("Unsupported API error status");
    expect(
      () => new ApiError(API_ERROR_STATUS.badRequest, "LOCAL_STRING" as ApiErrorCode, "Nope."),
    ).toThrow("Unsupported API error code");
  });
});
