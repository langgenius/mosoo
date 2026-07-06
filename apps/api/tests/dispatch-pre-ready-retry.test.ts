import { describe, expect, test } from "bun:test";

import {
  isDriverClosedBeforeReadyError,
  withPreReadyRetry,
} from "../src/modules/runtime/application/session-runs/pre-ready-retry";

function closedBeforeReadyError(): Error {
  return new Error("Driver instance driver-x closed before ready.");
}

describe("isDriverClosedBeforeReadyError", () => {
  test("matches the closed-before-ready signature", () => {
    expect(isDriverClosedBeforeReadyError(closedBeforeReadyError())).toBe(true);
    expect(isDriverClosedBeforeReadyError(new Error("Driver process exited before ready."))).toBe(
      false,
    );
    expect(
      isDriverClosedBeforeReadyError(
        new Error("Runtime subject is busy with lifecycle maintenance."),
      ),
    ).toBe(false);
    expect(isDriverClosedBeforeReadyError("closed before ready")).toBe(false);
  });
});

describe("withPreReadyRetry", () => {
  test("returns the first successful attempt without retrying", async () => {
    const retries: number[] = [];

    const result = await withPreReadyRetry({
      attempt: async () => "ok",
      onRetry: async (_error, remaining) => {
        retries.push(remaining);
      },
      retryLimit: 1,
    });

    expect(result).toBe("ok");
    expect(retries).toEqual([]);
  });

  test("retries a closed-before-ready failure and succeeds", async () => {
    const failures = [closedBeforeReadyError()];
    const attempts: number[] = [];
    const retried: { message: string; remaining: number }[] = [];

    const result = await withPreReadyRetry({
      attempt: async () => {
        attempts.push(attempts.length + 1);
        const failure = failures.shift();
        if (failure) {
          throw failure;
        }
        return "recovered";
      },
      onRetry: async (error, remaining) => {
        retried.push({ message: error.message, remaining });
      },
      retryLimit: 1,
    });

    expect(result).toBe("recovered");
    expect(attempts).toEqual([1, 2]);
    expect(retried).toEqual([
      { message: "Driver instance driver-x closed before ready.", remaining: 0 },
    ]);
  });

  test("gives up once the retry budget is exhausted", async () => {
    let attempts = 0;

    await expect(
      withPreReadyRetry({
        attempt: async () => {
          attempts += 1;
          throw closedBeforeReadyError();
        },
        onRetry: async () => undefined,
        retryLimit: 1,
      }),
    ).rejects.toThrow("closed before ready");

    expect(attempts).toBe(2);
  });

  test("does not retry other errors", async () => {
    let attempts = 0;
    const retries: number[] = [];

    await expect(
      withPreReadyRetry({
        attempt: async () => {
          attempts += 1;
          throw new Error("Runtime subject is busy with lifecycle maintenance.");
        },
        onRetry: async (_error, remaining) => {
          retries.push(remaining);
        },
        retryLimit: 1,
      }),
    ).rejects.toThrow("busy with lifecycle maintenance");

    expect(attempts).toBe(1);
    expect(retries).toEqual([]);
  });

  test("propagates onRetry failures such as run-no-longer-active", async () => {
    await expect(
      withPreReadyRetry({
        attempt: async () => {
          throw closedBeforeReadyError();
        },
        onRetry: async () => {
          throw new Error("Session run is already cancelled.");
        },
        retryLimit: 1,
      }),
    ).rejects.toThrow("already cancelled");
  });
});
