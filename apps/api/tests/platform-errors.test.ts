import { describe, expect, test } from "bun:test";

import {
  API_ERROR_CODE,
  createApiError,
  toApiErrorResponseDetails,
  validationError,
} from "../src/platform/errors";

describe("platform error taxonomy", () => {
  test("maps public error codes to finite HTTP statuses", () => {
    expect(createApiError(API_ERROR_CODE.notFound, "Missing.")).toMatchObject({
      code: "NOT_FOUND",
      message: "Missing.",
      status: 404,
    });
    expect(createApiError(API_ERROR_CODE.sessionRunActive, "Run in progress.")).toMatchObject({
      code: "SESSION_RUN_ACTIVE",
      status: 409,
    });
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
});
