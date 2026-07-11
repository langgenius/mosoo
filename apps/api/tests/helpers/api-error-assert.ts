import { expect } from "bun:test";

import { isApiError } from "../../src/platform/errors";

export async function expectApiErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!isApiError(error)) {
      throw error;
    }

    expect(error.code).toBe(code);
    return;
  }

  throw new Error(`Expected ApiError ${code} but the call succeeded.`);
}
