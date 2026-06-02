import { describe, expect, test } from "bun:test";

import { createRuntimeEvent } from "@mosoo/runtime-events";
import type { RuntimeEventKind } from "@mosoo/runtime-events";

import {
  readPermissionRequestViews,
  readRuntimeDriverRunTransition,
} from "../src/modules/runtime/infrastructure/driver-instance/event-projection";
import { createSessionRuntimeEventProjection } from "../src/modules/sessions/domain/session-runtime-event-projection";

const PROJECTION_CASES = [
  {
    family: "provisioning",
    kind: "runtime.provisioning.updated",
    value: {
      agentId: "01J00000000000000000000009",
      environmentRevisionId: "env-rev-1",
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
  {
    family: "provisioning",
    kind: "runtime.provisioning.updated",
    value: {
      agentId: "01J00000000000000000000009",
      environmentRevisionId: "env-rev-1",
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
  {
    family: "sandbox",
    kind: "runtime.sandbox.updated",
    value: {
      agentId: "01J00000000000000000000009",
      coldStartMs: 842,
      sandboxId: "01J0000000000000000000000D",
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
  {
    family: "driver",
    kind: "runtime.driver.updated",
    value: {
      agentId: "01J00000000000000000000009",
      driverInstanceId: "driver-1",
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
  {
    family: "driver",
    kind: "runtime.driver.updated",
    value: {
      agentId: "01J00000000000000000000009",
      driverInstanceId: "driver-1",
      port: 33809,
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
  {
    family: "transport",
    kind: "runtime.transport.updated",
    value: {
      agentId: "01J00000000000000000000009",
      driverInstanceId: "driver-1",
      port: 33809,
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
  {
    family: "transport",
    kind: "runtime.transport.updated",
    value: {
      agentId: "01J00000000000000000000009",
      driverInstanceId: "driver-1",
      errorCode: "RPC_TRANSPORT_ERROR",
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
  {
    family: "diagnostics",
    kind: "runtime.config.updated",
    value: {
      agentId: "01J00000000000000000000009",
      deploymentVersionId: "deployment-version-1",
      deploymentVersionNumber: 5,
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
  {
    family: "diagnostics",
    kind: "runtime.config.updated",
    value: {
      agentId: "01J00000000000000000000009",
      provider: "anthropic",
      reason: "active_key_revoked",
      sessionId: "session-1",
    },
    visibility: "owner_debug",
  },
] as const;

describe("agent runtime event projection", () => {
  test("derives v2 runtime families from the runtime event contract", () => {
    for (const event of PROJECTION_CASES) {
      const projection = createSessionRuntimeEventProjection(
        createRuntimeEvent({
          actor: "system",
          id: `${event.kind}-${event.family}`,
          kind: event.kind as RuntimeEventKind,
          occurredAt: "2026-05-26T00:00:00.000Z",
          origin: "system",
          payload: event.value,
          sessionId: "session-1",
          visibility: event.visibility,
        }),
      );

      expect(projection).toMatchObject({
        contentText: event.kind,
        eventType: event.kind,
        family: event.family,
        processStatus: "available",
        processType: "session.status",
        source: "system",
        visibility: event.visibility,
      });
    }
  });

  test("projects completed and failed tool output as process-ready content", () => {
    const completed = createSessionRuntimeEventProjection(
      createRuntimeEvent({
        actor: "driver",
        id: "tool-1",
        kind: "tool.call.updated",
        occurredAt: "2026-05-26T00:00:00.000Z",
        origin: "driver",
        payload: {
          rawOutput: "hello\nworld",
          status: "completed",
          title: "Shell",
          toolCallId: "tool-1",
        },
        sessionId: "session-1",
      }),
    );
    const failed = createSessionRuntimeEventProjection(
      createRuntimeEvent({
        actor: "driver",
        id: "tool-2",
        kind: "tool.call.updated",
        occurredAt: "2026-05-26T00:00:01.000Z",
        origin: "driver",
        payload: {
          content: "permission denied",
          status: "failed",
          title: "Shell",
          toolCallId: "tool-2",
        },
        sessionId: "session-1",
      }),
    );

    expect(completed).toMatchObject({
      contentText: "Shell result: hello world",
      processStatus: "available",
      processType: "tool.use.completed",
    });
    expect(failed).toMatchObject({
      contentText: "Shell result: permission denied",
      processStatus: "error",
      processType: "tool.use.completed",
    });
  });

  test("rejects malformed completed tool output before process projection", () => {
    const event = createRuntimeEvent({
      actor: "driver",
      id: "tool-malformed",
      kind: "tool.call.updated",
      occurredAt: "2026-05-26T00:00:00.000Z",
      origin: "driver",
      payload: {
        rawOutput: "success",
        status: "completed",
      },
      sessionId: "session-1",
    });

    expect(() => createSessionRuntimeEventProjection(event)).toThrow(
      "tool.call.updated payload toolCallId must be a non-empty string",
    );
  });

  test("treats run.cancelled as a terminal run transition", () => {
    const event = createRuntimeEvent({
      id: "run-cancelled",
      kind: "run.cancelled",
      occurredAt: "2026-05-26T00:00:00.000Z",
      payload: {},
      runId: "run-1",
      sessionId: "session-1",
    });

    expect(readRuntimeDriverRunTransition(event)).toEqual({ status: "cancelled" });
  });

  test("uses canonical run failure payloads for driver transitions", () => {
    const event = createRuntimeEvent({
      id: "run-failed",
      kind: "run.failed",
      occurredAt: "2026-05-26T00:00:02.000Z",
      payload: {
        error: {
          code: "runtime.failed",
          details: {
            exitCode: 1,
          },
          message: "Runtime failed.",
          recoverable: true,
        },
      },
      runId: "run-1",
      sessionId: "session-1",
    });

    expect(readRuntimeDriverRunTransition(event)).toEqual({
      error: {
        code: "runtime.failed",
        details: {
          exitCode: 1,
        },
        message: "Runtime failed.",
        retryable: true,
      },
      status: "failed",
    });
  });

  test("rejects malformed failed run payloads before driver transition defaults", () => {
    const event = createRuntimeEvent({
      id: "run-failed",
      kind: "run.failed",
      occurredAt: "2026-05-26T00:00:02.000Z",
      payload: {
        error: {
          code: "runtime.failed",
        },
      },
      runId: "run-1",
      sessionId: "session-1",
    });

    expect(() => readRuntimeDriverRunTransition(event)).toThrow(
      "Runtime event run.failed payload message must be a non-empty string.",
    );
  });

  test("skips malformed permission request snapshot entries", () => {
    expect(
      readPermissionRequestViews([
        {
          driverInstanceId: "01J00000000000000000000009",
          requestId: "request-0",
          runId: "run-1",
          title: "Allow shell command?",
        },
        {
          requestId: "request-1",
        },
      ]),
    ).toEqual([
      {
        driverInstanceId: "01J00000000000000000000009",
        rawInput: null,
        requestId: "request-0",
        runId: "run-1",
        title: "Allow shell command?",
        toolCallId: null,
        toolKind: null,
      },
    ]);
    expect(readPermissionRequestViews([])).toEqual([]);
  });

  test("rejects malformed permission request payloads before process projection", () => {
    const event = createRuntimeEvent({
      actor: "driver",
      driverInstanceId: "driver-1",
      id: "permission-malformed",
      kind: "permission.requested",
      occurredAt: "2026-05-26T00:00:00.000Z",
      origin: "driver",
      payload: {
        requestId: "permission-1",
      },
      runId: "run-1",
      sessionId: "session-1",
    });

    expect(() => createSessionRuntimeEventProjection(event)).toThrow(
      "Runtime event permission.requested payload title must be a non-empty string.",
    );
  });
});
