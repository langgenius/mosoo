import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import { describe, expect, test } from "bun:test";

import {
  isTerminalRunStatus,
  parseBoundAgentCallBody,
  selectBoundAgentReply,
  verifyBoundAgentCapability,
  waitForTerminalRun,
} from "../src/modules/public-api/app-agent-bound-call";
import {
  BoundAgentCallError,
  DEPLOYMENT_AGENT_CALL_TIMEOUT_ERROR_CODE,
  DEPLOYMENT_AGENT_NEEDS_INPUT_ERROR_CODE,
  DEPLOYMENT_AGENT_RUN_FAILED_ERROR_CODE,
} from "../src/modules/public-api/app-agent-bound-errors";
import { mintAppAgentCapabilityToken } from "../src/modules/public-api/app-agent-capability";
import type { AppAgentCapabilityClaims } from "../src/modules/public-api/app-agent-capability";
import { PublicApiError } from "../src/modules/public-api/public-api-errors";

const SECRET = "bound-test-secret";
const NOW = 5_000_000;

function claims(overrides: Partial<AppAgentCapabilityClaims> = {}): AppAgentCapabilityClaims {
  return {
    agentId: "agt_bound",
    appId: "app_bound",
    exp: NOW + 60_000,
    expose: "public_thread",
    ...overrides,
  };
}

describe("verifyBoundAgentCapability (capability verify-on-route)", () => {
  test("rejects a malformed token", async () => {
    const rejection = await verifyBoundAgentCapability(SECRET, "not-a-token", NOW).catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(PublicApiError);
    expect((rejection as PublicApiError).status).toBe(401);
  });

  test("rejects a token signed with a different secret", async () => {
    const token = await mintAppAgentCapabilityToken("other-secret", claims());
    await expect(verifyBoundAgentCapability(SECRET, token, NOW)).rejects.toBeInstanceOf(
      PublicApiError,
    );
  });

  test("rejects an expired token", async () => {
    const token = await mintAppAgentCapabilityToken(SECRET, claims({ exp: NOW }));
    await expect(verifyBoundAgentCapability(SECRET, token, NOW)).rejects.toBeInstanceOf(
      PublicApiError,
    );
  });

  test("returns claims for a valid token", async () => {
    const token = await mintAppAgentCapabilityToken(SECRET, claims());
    expect(await verifyBoundAgentCapability(SECRET, token, NOW)).toEqual(claims());
  });
});

describe("parseBoundAgentCallBody", () => {
  test("accepts a `message` field", () => {
    expect(parseBoundAgentCallBody({ message: "hello" })).toEqual({ message: "hello" });
  });

  test("accepts an `input` alias", () => {
    expect(parseBoundAgentCallBody({ input: "yo" })).toEqual({ message: "yo" });
  });

  test("trims surrounding whitespace", () => {
    expect(parseBoundAgentCallBody({ message: "  spaced  " })).toEqual({ message: "spaced" });
  });

  test("falls back to input when message is an empty string", () => {
    expect(parseBoundAgentCallBody({ input: "hi", message: "" })).toEqual({ message: "hi" });
  });

  test("rejects a missing message", () => {
    expect(() => parseBoundAgentCallBody({})).toThrow(PublicApiError);
  });

  test("rejects a blank message", () => {
    expect(() => parseBoundAgentCallBody({ message: "   " })).toThrow(PublicApiError);
  });

  test("rejects a non-object body", () => {
    expect(() => parseBoundAgentCallBody("nope")).toThrow(PublicApiError);
    expect(() => parseBoundAgentCallBody(null)).toThrow(PublicApiError);
    expect(() => parseBoundAgentCallBody(["a"])).toThrow(PublicApiError);
  });
});

describe("isTerminalRunStatus", () => {
  test("classifies terminal vs active statuses", () => {
    const terminal: SessionRunStatus[] = ["completed", "failed", "cancelled", "expired"];
    const active: SessionRunStatus[] = ["queued", "booting", "running", "waiting_input"];
    for (const status of terminal) {
      expect(isTerminalRunStatus(status)).toBe(true);
    }
    for (const status of active) {
      expect(isTerminalRunStatus(status)).toBe(false);
    }
  });
});

describe("waitForTerminalRun", () => {
  test("returns the terminal run without delaying when already terminal", async () => {
    let delays = 0;
    const run = await waitForTerminalRun(
      {
        delay: async () => {
          delays += 1;
        },
        now: () => 0,
        readRun: async () => ({ status: "completed" as SessionRunStatus }),
      },
      { pollIntervalMs: 1_000, timeoutMs: 25_000 },
    );
    expect(run.status).toBe("completed");
    expect(delays).toBe(0);
  });

  test("rejects with needs-input when the run parks on waiting_input", async () => {
    const error = await waitForTerminalRun(
      {
        delay: async () => undefined,
        now: () => 0,
        readRun: async () => ({ status: "waiting_input" as SessionRunStatus }),
      },
      { pollIntervalMs: 1_000, timeoutMs: 25_000 },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BoundAgentCallError);
    expect((error as BoundAgentCallError).code).toBe(DEPLOYMENT_AGENT_NEEDS_INPUT_ERROR_CODE);
  });

  test("polls until the run reaches a terminal state", async () => {
    const statuses: SessionRunStatus[] = ["running", "running", "completed"];
    let index = 0;
    let clock = 0;
    let delays = 0;
    const run = await waitForTerminalRun(
      {
        delay: async (ms) => {
          clock += ms;
          delays += 1;
        },
        now: () => clock,
        readRun: async () => {
          const status = statuses[index] ?? "completed";
          index += 1;
          return { status };
        },
      },
      { pollIntervalMs: 1_000, timeoutMs: 25_000 },
    );
    expect(run.status).toBe("completed");
    expect(delays).toBe(2);
  });

  test("throws a timeout error once the budget elapses", async () => {
    let clock = 0;
    const rejection = await waitForTerminalRun(
      {
        delay: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        readRun: async () => ({ status: "running" as SessionRunStatus }),
      },
      { pollIntervalMs: 1_000, timeoutMs: 5_000 },
    ).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(BoundAgentCallError);
    expect((rejection as BoundAgentCallError).code).toBe(DEPLOYMENT_AGENT_CALL_TIMEOUT_ERROR_CODE);
    expect((rejection as BoundAgentCallError).status).toBe(504);
  });

  test("treats a missing run row as non-terminal until the timeout", async () => {
    let clock = 0;
    const rejection = await waitForTerminalRun(
      {
        delay: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        readRun: async () => null,
      },
      { pollIntervalMs: 1_000, timeoutMs: 2_000 },
    ).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(BoundAgentCallError);
  });
});

describe("selectBoundAgentReply (final-output extraction)", () => {
  test("returns the joined final output text on a completed run", () => {
    expect(
      selectBoundAgentReply({
        finalOutput: { text: "the answer" },
        run: { error: null, status: "completed" },
      }),
    ).toEqual({ reply: "the answer" });
  });

  test("returns an empty reply when a completed run has no output", () => {
    expect(
      selectBoundAgentReply({
        finalOutput: null,
        run: { error: null, status: "completed" },
      }),
    ).toEqual({ reply: "" });
  });

  test("surfaces the run error on a failed run", () => {
    const rejection = (() => {
      try {
        selectBoundAgentReply({
          finalOutput: null,
          run: {
            error: { code: "boom", details: {}, message: "it broke", retryable: false },
            status: "failed",
          },
        });
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();
    expect(rejection).toBeInstanceOf(BoundAgentCallError);
    expect((rejection as BoundAgentCallError).code).toBe(DEPLOYMENT_AGENT_RUN_FAILED_ERROR_CODE);
    expect((rejection as BoundAgentCallError).message).toBe("it broke");
  });

  test("fails a cancelled run even without an error payload", () => {
    expect(() =>
      selectBoundAgentReply({
        finalOutput: null,
        run: { error: null, status: "cancelled" },
      }),
    ).toThrow(BoundAgentCallError);
  });
});
