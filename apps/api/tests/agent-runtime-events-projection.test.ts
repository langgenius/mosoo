import { describe, expect, test } from "bun:test";

import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import { createRuntimeEvent, parseRuntimeEventEnvelope } from "@mosoo/runtime-events";

import {
  readPermissionRequestViews,
  readRuntimeDriverRunTransition,
} from "../src/modules/runtime/infrastructure/driver-instance/event-projection";
import { createSessionRuntimeEventProjection } from "../src/modules/sessions/domain/session-runtime-event-projection";

describe("agent runtime event projection", () => {
  test("records a cancelled tool without reporting success", () => {
    const event = parseRuntimeEventEnvelope(
      createRuntimeEvent({
        id: PLATFORM_ID_FIXTURES.runtimeEvent,
        kind: "tool.call.updated",
        occurredAt: "2026-10-10T00:00:00.000Z",
        payload: { status: "cancelled", title: "Shell", toolCallId: "tool-1" },
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        sessionId: PLATFORM_ID_FIXTURES.session,
      }),
    );
    expect(createSessionRuntimeEventProjection(event)).toMatchObject({
      contentText: "Shell cancelled.",
      processType: "tool.use.completed",
    });
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
          rawInput: '{"timeout":30,"command":"echo hello"}',
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
      toolCallId: "tool-1",
      toolInputJson: '{"command":"echo hello","timeout":30}',
      toolName: null,
    });
    expect(failed).toMatchObject({
      contentText: "Shell result: permission denied",
      processStatus: "error",
      processType: "tool.use.completed",
      toolCallId: "tool-2",
      toolInputJson: null,
      toolName: null,
    });
  });

  test.each(["{}", '{"command":', '{"cwd":"/workspace"}'])(
    "keeps running streamed tool input %s out of the canonical projection",
    (rawInput) => {
      const projection = createSessionRuntimeEventProjection(
        createRuntimeEvent({
          actor: "driver",
          id: "tool-stream",
          kind: "tool.call.updated",
          occurredAt: "2026-05-26T00:00:00.000Z",
          origin: "driver",
          payload: {
            rawInput,
            status: "running",
            toolCallId: "tool-stream",
          },
          sessionId: "session-1",
        }),
      );

      expect(projection.toolInputJson).toBeNull();
    },
  );

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

  test("uses admitted run failure payloads for driver transitions", () => {
    const event = parseRuntimeEventEnvelope(
      createRuntimeEvent({
        id: PLATFORM_ID_FIXTURES.runtimeEvent,
        kind: "run.failed",
        occurredAt: "2026-05-26T00:00:02.000Z",
        payload: {
          error: {
            code: "runtime.failed",
            details: {
              exitCode: 1,
            },
            message: "Runtime failed.",
            retryable: true,
          },
          recoverable: true,
        },
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        sessionId: PLATFORM_ID_FIXTURES.session,
      }),
    );

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

  test("projects permission requests with the logical tool identity", () => {
    const projection = createSessionRuntimeEventProjection(
      createRuntimeEvent({
        actor: "driver",
        driverInstanceId: "driver-1",
        id: "permission-1",
        kind: "permission.requested",
        occurredAt: "2026-05-26T00:00:00.000Z",
        origin: "driver",
        payload: {
          details: '{"command":"echo hello"}',
          requestId: "permission-1",
          targetItemId: "tool-1",
          title: "Allow shell command?",
          toolCall: { kind: "Bash" },
        },
        runId: "run-1",
        sessionId: "session-1",
      }),
    );

    expect(projection).toMatchObject({
      toolCallId: "tool-1",
      toolInputJson: null,
      toolName: null,
    });
  });
});
