import { describe, expect, test } from "bun:test";

import { ExternalToolEffectClaim } from "@mosoo/contracts/external-tool-effect";
import {
  DURABLE_RUN_ERROR_MAX_UTF8_BYTES,
  measureDurableRunErrorJson,
} from "@mosoo/contracts/session-run";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import {
  parseDriverCommandUpdateInput,
  parseDriverCompletionInput,
  parseDriverEventBatchInput,
  parseDriverEventBatchOutput,
  parseDriverExternalToolEffectClaimInput,
  parseDriverExternalToolEffectObserveInput,
  parseDriverExternalToolEffectSettleInput,
  parseDriverFailureInput,
  parseDriverHeartbeatInput,
  parseDriverHeartbeatOutput,
  parseDriverHelloInput,
  parseDriverHelloOutput,
  parseDriverLogBatchInput,
  parseDriverLogBatchOutput,
  parseDriverNextCommandInput,
  parseDriverNextCommandOutput,
  parseDriverReadyInput,
} from "../src/modules/runtime/infrastructure/driver-instance/rpc-wire";

const EXTERNAL_TOOL_EFFECT_CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174000";

const invalidPositiveSafeIntegers = [
  0,
  -1,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
] as const;
const invalidNonNegativeSafeIntegers = invalidPositiveSafeIntegers.slice(1);

function helloInput(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: [],
    driverVersion: "test",
    pid: 1,
    protocolVersion: 3,
    runtime: "acp-fallback",
    startedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function helloOutput(runConfig: Record<string, unknown> = {}, runId: string | null = null) {
  return {
    acceptedCapabilities: [],
    connectionId: "connection-1",
    driverInstanceId: "driver-1",
    heartbeatIntervalMs: 250,
    runConfig: {
      commandLeaseMs: 0,
      envPolicy: "strict",
      eventBatchMaxSize: 1,
      organizationPath: "/workspace",
      ...runConfig,
    },
    runId,
  };
}

function heartbeatInput(pid: number, at = "2026-08-29T00:00:00.000Z") {
  return { at, pid, reason: "interval" };
}

function readyInput(pid: number) {
  return {
    at: "2026-08-29T00:00:00.000Z",
    driverInstanceId: "driver-1",
    pid,
  };
}

function logBatch(seq: number) {
  return {
    driverInstanceId: "driver-1",
    logs: [{ level: "info", message: "message", seq, timestamp: "now" }],
  };
}

function eventBatchOutput(seq: number, type = "message.delta") {
  return { accepted: [{ eventId: "source-1", seq, type }] };
}

describe("API Driver RPC wire v3", () => {
  test("rejects undeclared keys throughout fixed RPC shapes", () => {
    const event = createRuntimeEvent({
      id: PLATFORM_ID_FIXTURES.runtimeEvent,
      kind: "diagnostic.reported",
      occurredAt: "2026-08-29T00:00:00.000Z",
      payload: { message: "ok" },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });
    const cases: ReadonlyArray<readonly [string, () => unknown]> = [
      ["hello", () => parseDriverHelloInput(helloInput({ extra: true }))],
      ["hello output", () => parseDriverHelloOutput({ ...helloOutput(), extra: true })],
      ["run config", () => parseDriverHelloOutput(helloOutput({ extra: true }))],
      ["heartbeat", () => parseDriverHeartbeatInput({ ...heartbeatInput(1), extra: true })],
      [
        "heartbeat output",
        () => parseDriverHeartbeatOutput({ heartbeatCount: 0, extra: true, ok: true }),
      ],
      ["ready", () => parseDriverReadyInput({ ...readyInput(1), extra: true })],
      [
        "command update",
        () =>
          parseDriverCommandUpdateInput({
            commandId: "command-1",
            driverInstanceId: "driver-1",
            extra: true,
            status: "accepted",
          }),
      ],
      [
        "effect claim",
        () =>
          parseDriverExternalToolEffectClaimInput({
            claimToken: EXTERNAL_TOOL_EFFECT_CLAIM_TOKEN,
            commandId: "command-1",
            driverInstanceId: "driver-1",
            extra: true,
          }),
      ],
      [
        "effect observe",
        () =>
          parseDriverExternalToolEffectObserveInput({
            commandId: "command-1",
            driverInstanceId: "driver-1",
            extra: true,
          }),
      ],
      [
        "effect settle",
        () =>
          parseDriverExternalToolEffectSettleInput({
            claimToken: EXTERNAL_TOOL_EFFECT_CLAIM_TOKEN,
            commandId: "command-1",
            driverInstanceId: "driver-1",
            effectId: "effect-1",
            extra: true,
            settlement: { kind: "unknown" },
          }),
      ],
      [
        "next command",
        () => parseDriverNextCommandInput({ driverInstanceId: "driver-1", extra: true }),
      ],
      ["next command output", () => parseDriverNextCommandOutput({ command: null, extra: true })],
      [
        "completion",
        () =>
          parseDriverCompletionInput({ driverInstanceId: "driver-1", extra: true, runId: "run-1" }),
      ],
      [
        "failure",
        () =>
          parseDriverFailureInput({
            driverInstanceId: "driver-1",
            error: { code: "failed", details: {}, message: "failed", retryable: false },
            extra: true,
            runId: "run-1",
          }),
      ],
      [
        "event batch",
        () =>
          parseDriverEventBatchInput({
            driverInstanceId: "driver-1",
            events: [{ event, eventId: "event-1" }],
            extra: true,
          }),
      ],
      [
        "event envelope",
        () =>
          parseDriverEventBatchInput({
            driverInstanceId: "driver-1",
            events: [{ event, eventId: "event-1", extra: true }],
          }),
      ],
      [
        "event body",
        () =>
          parseDriverEventBatchInput({
            driverInstanceId: "driver-1",
            events: [{ event: { ...event, extra: true }, eventId: "event-1" }],
          }),
      ],
      [
        "event context",
        () =>
          parseDriverEventBatchInput({
            driverInstanceId: "driver-1",
            events: [{ event: { ...event, context: {} }, eventId: "event-1" }],
          }),
      ],
      [
        "event surface",
        () =>
          parseDriverEventBatchInput({
            driverInstanceId: "driver-1",
            events: [{ event: { ...event, surface: {} }, eventId: "event-1" }],
          }),
      ],
      ["event output", () => parseDriverEventBatchOutput({ ...eventBatchOutput(0), extra: true })],
      [
        "event receipt",
        () =>
          parseDriverEventBatchOutput({
            accepted: [{ eventId: "event-1", extra: true, seq: 0, type: "message.delta" }],
          }),
      ],
      ["log batch", () => parseDriverLogBatchInput({ ...logBatch(0), extra: true })],
      [
        "log entry",
        () =>
          parseDriverLogBatchInput({
            driverInstanceId: "driver-1",
            logs: [{ ...logBatch(0).logs[0], extra: true }],
          }),
      ],
      [
        "log context",
        () =>
          parseDriverLogBatchInput({
            driverInstanceId: "driver-1",
            logs: [{ ...logBatch(0).logs[0], context: { extra: true } }],
          }),
      ],
      [
        "log error",
        () =>
          parseDriverLogBatchInput({
            driverInstanceId: "driver-1",
            logs: [
              { ...logBatch(0).logs[0], error: { extra: true, message: "failed", name: "Error" } },
            ],
          }),
      ],
      ["log output", () => parseDriverLogBatchOutput({ extra: true, ok: true })],
    ];

    for (const [label, parse] of cases) {
      expect(parse, label).toThrow();
    }
  });

  test("keeps the intentional primitive log fields extension point", () => {
    expect(
      parseDriverLogBatchInput({
        driverInstanceId: "driver-1",
        logs: [{ ...logBatch(0).logs[0], fields: { futureField: true } }],
      }).logs[0]?.fields,
    ).toEqual({ futureField: true });
  });

  test("bounds event and log batches at 64 entries", () => {
    const event = createRuntimeEvent({
      id: PLATFORM_ID_FIXTURES.runtimeEvent,
      kind: "diagnostic.reported",
      occurredAt: "2026-08-29T00:00:00.000Z",
      payload: { message: "ok" },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });
    const parsers = [
      (length: number) =>
        parseDriverEventBatchInput({
          driverInstanceId: "driver-1",
          events: Array.from({ length }, () => ({ event, eventId: "event-1" })),
        }),
      (length: number) =>
        parseDriverLogBatchInput({
          driverInstanceId: "driver-1",
          logs: Array.from({ length }, () => logBatch(0).logs[0]),
        }),
    ] as const;

    for (const parse of parsers) {
      expect(() => parse(64)).not.toThrow();
      expect(() => parse(65)).toThrow();
    }
  });

  test.each(["accepted", "cancelled", "completed", "failed"] as const)(
    "accepts Driver-owned command status %s",
    (status) => {
      const terminal =
        status === "failed"
          ? {
              error: {
                code: "driver.command_failed",
                details: {},
                message: "failed",
                retryable: false,
              },
            }
          : status === "completed"
            ? { result: { requestId: "request-1" } }
            : {};

      expect(
        parseDriverCommandUpdateInput({
          commandId: "command-1",
          driverInstanceId: "driver-1",
          ...terminal,
          status,
        }).status,
      ).toBe(status);
    },
  );

  test.each([
    ["accepted with result", { result: { requestId: "request-1" }, status: "accepted" }],
    [
      "accepted with error",
      {
        error: { code: "failed", details: {}, message: "failed", retryable: false },
        status: "accepted",
      },
    ],
    ["cancelled with result", { result: { requestId: "request-1" }, status: "cancelled" }],
    [
      "cancelled with error",
      {
        error: { code: "failed", details: {}, message: "failed", retryable: false },
        status: "cancelled",
      },
    ],
    ["completed with null result", { result: null, status: "completed" }],
    [
      "completed with error",
      {
        error: { code: "failed", details: {}, message: "failed", retryable: false },
        status: "completed",
      },
    ],
    ["failed without error", { status: "failed" }],
    [
      "failed with result",
      {
        error: { code: "failed", details: {}, message: "failed", retryable: false },
        result: { requestId: "request-1" },
        status: "failed",
      },
    ],
  ] as const)("rejects command update payload mismatch: %s", (_label, update) => {
    expect(() =>
      parseDriverCommandUpdateInput({
        commandId: "command-1",
        driverInstanceId: "driver-1",
        ...update,
      }),
    ).toThrow();
  });

  test("rejects duplicate capability ids in hello input and output", () => {
    const capability = { id: "text_stream", status: "supported", version: 1 } as const;

    expect(() =>
      parseDriverHelloInput(helloInput({ capabilities: [capability, capability] })),
    ).toThrow();
    expect(() =>
      parseDriverHelloOutput({
        ...helloOutput(),
        acceptedCapabilities: [capability, capability],
      }),
    ).toThrow();
  });

  test.each(["queued", "delivered", "expired"] as const)(
    "rejects host-owned command status %s at the RPC boundary",
    (status) => {
      expect(() =>
        parseDriverCommandUpdateInput({
          commandId: "command-1",
          driverInstanceId: "driver-1",
          status,
        }),
      ).toThrow();
    },
  );

  test("accepts a canonical UUID external-effect claim token", () => {
    expect(
      parseDriverExternalToolEffectClaimInput({
        claimToken: EXTERNAL_TOOL_EFFECT_CLAIM_TOKEN,
        commandId: "command-1",
        driverInstanceId: "driver-1",
      }),
    ).toMatchObject({ claimToken: EXTERNAL_TOOL_EFFECT_CLAIM_TOKEN });
    expect(
      parseDriverExternalToolEffectSettleInput({
        claimToken: EXTERNAL_TOOL_EFFECT_CLAIM_TOKEN,
        commandId: "command-1",
        driverInstanceId: "driver-1",
        effectId: "effect-1",
        settlement: { kind: "unknown" },
      }),
    ).toMatchObject({ claimToken: EXTERNAL_TOOL_EFFECT_CLAIM_TOKEN });
  });

  test.each([
    ["empty", ""],
    ["uppercase UUID", EXTERNAL_TOOL_EFFECT_CLAIM_TOKEN.toUpperCase()],
    ["extra-hyphen UUID", "123e4567-e89b-42d3-a456-42661417-00"],
    ["non-v4 UUID", "123e4567-e89b-f2d3-a456-426614174000"],
    ["invalid-variant UUID", "123e4567-e89b-42d3-c456-426614174000"],
    ["non-UUID", "claim-token"],
    ["37-character", "x".repeat(37)],
    ["one-megabyte", "x".repeat(1_000_000)],
  ] as const)("rejects a %s external-effect claim token", (_label, claimToken) => {
    expect(() =>
      parseDriverExternalToolEffectClaimInput({
        claimToken,
        commandId: "command-1",
        driverInstanceId: "driver-1",
      }),
    ).toThrow();
    expect(() =>
      parseDriverExternalToolEffectSettleInput({
        claimToken,
        commandId: "command-1",
        driverInstanceId: "driver-1",
        effectId: "effect-1",
        settlement: { kind: "unknown" },
      }),
    ).toThrow();
  });

  test.each([2, 4] as const)("rejects protocol version %d", (protocolVersion) => {
    expect(() => parseDriverHelloInput(helloInput({ protocolVersion }))).toThrow();
  });

  test.each(invalidPositiveSafeIntegers)(
    "rejects %p at every positive safe-integer field",
    (value) => {
      expect(() => parseDriverHelloInput(helloInput({ pid: value }))).toThrow();
      expect(() => parseDriverHeartbeatInput(heartbeatInput(value))).toThrow();
      expect(() => parseDriverReadyInput(readyInput(value))).toThrow();
      expect(() => parseDriverHelloOutput(helloOutput({ eventBatchMaxSize: value }))).toThrow();
      expect(() =>
        parseSchemaValue(ExternalToolEffectClaim, {
          attempt: value,
          effectId: "effect-1",
          idempotencyKey: "idempotency-1",
          kind: "claimed",
        }),
      ).toThrow();
    },
  );

  test("bounds the negotiated event batch size to the wire limit", () => {
    expect(parseDriverHelloOutput(helloOutput({ eventBatchMaxSize: 64 })).runConfig).toMatchObject({
      eventBatchMaxSize: 64,
    });
    expect(() => parseDriverHelloOutput(helloOutput({ eventBatchMaxSize: 65 }))).toThrow();
  });

  test.each([
    0,
    249,
    250.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ] as const)("rejects invalid heartbeat interval %p", (heartbeatIntervalMs) => {
    expect(() => parseDriverHelloOutput({ ...helloOutput(), heartbeatIntervalMs })).toThrow();
  });

  test.each(invalidNonNegativeSafeIntegers)(
    "rejects %p at every non-negative safe-integer field",
    (value) => {
      expect(() => parseDriverHelloOutput(helloOutput({ commandLeaseMs: value }))).toThrow();
      expect(() => parseDriverHeartbeatOutput({ heartbeatCount: value, ok: true })).toThrow();
      expect(() => parseDriverLogBatchInput(logBatch(value))).toThrow();
      expect(() => parseDriverEventBatchOutput(eventBatchOutput(value))).toThrow();
    },
  );

  test("accepts zero at every non-negative safe-integer field", () => {
    expect(parseDriverHelloOutput(helloOutput()).runConfig.commandLeaseMs).toBe(0);
    expect(parseDriverHeartbeatOutput({ heartbeatCount: 0, ok: true }).heartbeatCount).toBe(0);
    expect(parseDriverLogBatchInput(logBatch(0)).logs[0]?.seq).toBe(0);
    expect(parseDriverEventBatchOutput(eventBatchOutput(0)).accepted[0]?.seq).toBe(0);
  });

  test.each([
    [
      "failure message",
      () =>
        parseDriverFailureInput({
          driverInstanceId: "driver-1",
          error: { code: "failed", details: {}, message: "", retryable: false },
          runId: "run-1",
        }),
    ],
    ["receipt type", () => parseDriverEventBatchOutput(eventBatchOutput(0, ""))],
  ] as const)("rejects an empty %s", (_label, parse) => {
    expect(parse).toThrow();
  });

  test("bounds Driver failure errors with the durable JSON budget", () => {
    const base = { code: "failed", details: {}, message: "", retryable: false };
    const exact = {
      ...base,
      message: "x".repeat(DURABLE_RUN_ERROR_MAX_UTF8_BYTES - measureDurableRunErrorJson(base)),
    };

    expect(measureDurableRunErrorJson(exact)).toBe(DURABLE_RUN_ERROR_MAX_UTF8_BYTES);
    expect(
      parseDriverFailureInput({ driverInstanceId: "driver-1", error: exact, runId: "run-1" }).error,
    ).toEqual(exact);
    expect(() =>
      parseDriverFailureInput({
        driverInstanceId: "driver-1",
        error: { ...exact, message: `${exact.message}x` },
        runId: "run-1",
      }),
    ).toThrow();
  });

  test("requires an exact run id on terminal RPCs", () => {
    expect(() => parseDriverCompletionInput({ driverInstanceId: "driver-1" })).toThrow("runId");
    expect(() =>
      parseDriverFailureInput({
        driverInstanceId: "driver-1",
        error: { code: "failed", details: {}, message: "failed", retryable: false },
      }),
    ).toThrow("runId");
  });

  test.each([
    ["missing", { accepted: [{ seq: 0, type: "message.delta" }] }],
    ["empty", { accepted: [{ eventId: "", seq: 0, type: "message.delta" }] }],
    ["non-string", { accepted: [{ eventId: 1, seq: 0, type: "message.delta" }] }],
  ] as const)("rejects %s receipt eventId", (_label, input) => {
    expect(() => parseDriverEventBatchOutput(input)).toThrow();
  });

  test("rejects empty handshake identity fields", () => {
    expect(() => parseDriverHelloInput(helloInput({ startedAt: "" }))).toThrow();
    expect(() => parseDriverHeartbeatInput(heartbeatInput(1, ""))).toThrow();
    expect(() => parseDriverHelloOutput(helloOutput({}, ""))).toThrow();
  });

  test("rejects an unknown event receipt kind", () => {
    expect(() => parseDriverEventBatchOutput(eventBatchOutput(0, "future.event"))).toThrow();
  });

  test("preserves empty log and tracing strings", () => {
    expect(
      parseDriverLogBatchInput({
        driverInstanceId: "driver-1",
        logs: [
          {
            context: { spanId: "", traceId: "" },
            error: { message: "", name: "" },
            level: "error",
            message: "",
            seq: 0,
            timestamp: "now",
          },
        ],
      }).logs[0],
    ).toMatchObject({
      context: { spanId: "", traceId: "" },
      error: { message: "", name: "" },
      message: "",
    });
  });
});
