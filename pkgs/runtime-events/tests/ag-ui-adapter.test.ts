import { describe, expect, test } from "bun:test";

import { EventType, MOSOO_CUSTOM_EVENT } from "@mosoo/ag-ui-session";
import { createPlatformId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import {
  createProcessDraftFromRuntimeEvent,
  createRuntimeEvent,
  parseRuntimeEventEnvelope,
  appRuntimeEventToAgUiSessionEvents,
  toRuntimeEventInput,
} from "@mosoo/runtime-events";
import type { RuntimeEventBuildContext } from "@mosoo/runtime-events";

const OCCURRED_AT = "2026-05-26T00:00:00.000Z";

function createContext(): RuntimeEventBuildContext {
  return {
    createId: createPlatformId,
    driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
    occurredAt: OCCURRED_AT,
    runId: PLATFORM_ID_FIXTURES.sessionRun,
    runtimeId: "openai-runtime",
    sessionId: PLATFORM_ID_FIXTURES.session,
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];

  if (value === undefined) {
    throw new Error("Expected at least one value.");
  }

  return value;
}

describe("runtime event AG-UI adapter", () => {
  test("normalizes canonical driver drafts into canonical runtime envelopes", () => {
    const event = first(
      toRuntimeEventInput(createContext(), {
        kind: "run.started",
        payload: {
          startedAt: OCCURRED_AT,
        },
        runId: PLATFORM_ID_FIXTURES.sessionRun,
      }),
    );

    expect(event.kind).toBe("run.started");
    expect(event.runId).toBe(PLATFORM_ID_FIXTURES.sessionRun);
    expect(event.sessionId).toBe(PLATFORM_ID_FIXTURES.session);
    expect(event.schemaVersion).toBe("2026-05-26");
  });

  test("uses the build context run id as the canonical runtime run id", () => {
    const event = first(
      toRuntimeEventInput(
        {
          ...createContext(),
          runId: PLATFORM_ID_FIXTURES.sessionRun,
        },
        {
          kind: "run.started",
          payload: {
            startedAt: OCCURRED_AT,
          },
          runId: "provider-turn-1",
        },
      ),
    );

    expect(event.runId).toBe(PLATFORM_ID_FIXTURES.sessionRun);
  });

  test("apps runtime run events through session run updates", () => {
    const started = first(
      appRuntimeEventToAgUiSessionEvents(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "run.started",
          occurredAt: OCCURRED_AT,
          payload: {
            startedAt: OCCURRED_AT,
          },
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          sessionId: PLATFORM_ID_FIXTURES.session,
          traceId: "trace-1",
        }),
      ),
    );
    const failedAt = "2026-05-26T00:00:02.000Z";
    const failed = first(
      appRuntimeEventToAgUiSessionEvents(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "run.failed",
          occurredAt: failedAt,
          payload: {
            error: {
              code: "runtime.failed",
              message: "Runtime failed.",
            },
          },
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          sessionId: PLATFORM_ID_FIXTURES.session,
          traceId: "trace-1",
        }),
      ),
    );

    expect(started).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
      type: EventType.CUSTOM,
      value: {
        lifecycle: "RUNNING",
        run: {
          id: PLATFORM_ID_FIXTURES.sessionRun,
          startedAt: OCCURRED_AT,
          status: "running",
          traceId: "trace-1",
        },
      },
    });
    expect(failed).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
      type: EventType.CUSTOM,
      value: {
        lifecycle: "IDLE",
        run: {
          completedAt: failedAt,
          error: {
            code: "runtime.failed",
            message: "Runtime failed.",
          },
          id: PLATFORM_ID_FIXTURES.sessionRun,
          status: "failed",
          traceId: "trace-1",
        },
      },
    });
  });

  test("apps nested run lifecycle payloads with envelope-owned identity", () => {
    const completedAt = "2026-05-26T00:00:03.000Z";
    const completed = first(
      appRuntimeEventToAgUiSessionEvents(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "run.completed",
          occurredAt: completedAt,
          payload: {
            lifecycle: "TERMINATED",
            run: {
              completedAt,
              error: null,
              id: "provider-run",
              startedAt: OCCURRED_AT,
              status: "completed",
              traceId: "provider-trace",
            },
          },
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          sessionId: PLATFORM_ID_FIXTURES.session,
          traceId: "trace-envelope",
        }),
      ),
    );

    expect(completed).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
      type: EventType.CUSTOM,
      value: {
        lifecycle: "TERMINATED",
        run: {
          completedAt,
          id: PLATFORM_ID_FIXTURES.sessionRun,
          startedAt: OCCURRED_AT,
          status: "completed",
          traceId: "trace-envelope",
        },
      },
    });
  });

  test("rejects malformed failed run payloads before projection defaults", () => {
    const failed = createRuntimeEvent({
      id: createPlatformId(),
      kind: "run.failed",
      occurredAt: "2026-05-26T00:00:02.000Z",
      payload: {
        error: {
          code: "runtime.failed",
        },
      },
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => appRuntimeEventToAgUiSessionEvents(failed)).toThrow();
    expect(() => createProcessDraftFromRuntimeEvent(failed)).toThrow();
  });

  test("rejects runtime event drafts with unsupported canonical fields", () => {
    expect(() =>
      toRuntimeEventInput(createContext(), {
        kind: "message.unknown",
        payload: {},
      }),
    ).toThrow();

    expect(() =>
      toRuntimeEventInput(createContext(), {
        actor: "viewer",
        kind: "message.delta",
        payload: {
          contentDelta: "hello",
        },
      }),
    ).toThrow();
  });

  test("validates runtime envelope context, native refs, and payload presence", () => {
    const event = createRuntimeEvent({
      context: {
        agentId: PLATFORM_ID_FIXTURES.agent,
        surface: {
          id: "surface-1",
          triggerId: "trigger-1",
          type: "web",
        },
      },
      id: createPlatformId(),
      kind: "diagnostic.reported",
      native: {
        provider: "openai",
        sequence: 1,
        threadId: "thread-1",
      },
      occurredAt: OCCURRED_AT,
      payload: {
        message: "ok",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(parseRuntimeEventEnvelope(event)).toMatchObject({
      context: {
        agentId: PLATFORM_ID_FIXTURES.agent,
        surface: {
          id: "surface-1",
          triggerId: "trigger-1",
          type: "web",
        },
      },
      kind: "diagnostic.reported",
      native: {
        provider: "openai",
        threadId: "thread-1",
      },
      payload: {
        message: "ok",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });
    expect(parseRuntimeEventEnvelope({ ...event, seq: 7 })).toMatchObject({
      kind: "diagnostic.reported",
      seq: 7,
    });

    expect(() =>
      parseRuntimeEventEnvelope({
        ...event,
        context: {
          surface: {
            type: "desktop",
          },
        },
      }),
    ).toThrow();

    const { payload: _payload, ...missingPayload } = event;

    expect(() => parseRuntimeEventEnvelope(missingPayload)).toThrow();
  });

  test("parses envelope and context IDs into canonical semantic IDs", () => {
    const event = {
      actor: "driver",
      context: {
        agentId: PLATFORM_ID_FIXTURES.agent.toLowerCase(),
        callerId: PLATFORM_ID_FIXTURES.account.toLowerCase(),
        deploymentVersionId: PLATFORM_ID_FIXTURES.agentDeploymentVersion.toLowerCase(),
        environmentRevisionId: PLATFORM_ID_FIXTURES.environmentRevision.toLowerCase(),
        executionActorId: PLATFORM_ID_FIXTURES.account.toLowerCase(),
      },
      delivery: "lossless",
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance.toLowerCase(),
      id: PLATFORM_ID_FIXTURES.runtimeEvent.toLowerCase(),
      kind: "diagnostic.reported",
      occurredAt: OCCURRED_AT,
      origin: "driver",
      payload: {
        message: "ok",
      },
      runId: PLATFORM_ID_FIXTURES.sessionRun.toLowerCase(),
      schemaVersion: "2026-05-26",
      sessionId: PLATFORM_ID_FIXTURES.session.toLowerCase(),
      visibility: "participant",
    };

    expect(parseRuntimeEventEnvelope(event)).toMatchObject({
      context: {
        agentId: PLATFORM_ID_FIXTURES.agent,
        callerId: PLATFORM_ID_FIXTURES.account,
        deploymentVersionId: PLATFORM_ID_FIXTURES.agentDeploymentVersion,
        environmentRevisionId: PLATFORM_ID_FIXTURES.environmentRevision,
        executionActorId: PLATFORM_ID_FIXTURES.account,
      },
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      id: PLATFORM_ID_FIXTURES.runtimeEvent,
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => parseRuntimeEventEnvelope({ ...event, runId: "run-1" })).toThrow();
    expect(() =>
      parseRuntimeEventEnvelope({
        ...event,
        context: {
          ...event.context,
          organizationId: PLATFORM_ID_FIXTURES.organization,
        },
      }),
    ).toThrow("Runtime event context organizationId is not supported.");
  });

  test("rejects malformed public runtime event payloads at ingress", () => {
    const baseEvent = createRuntimeEvent({
      id: createPlatformId(),
      kind: "message.delta",
      occurredAt: OCCURRED_AT,
      payload: {
        messageId: "message-1",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => parseRuntimeEventEnvelope(baseEvent)).toThrow();

    expect(() =>
      parseRuntimeEventEnvelope(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "file.change.updated",
          occurredAt: OCCURRED_AT,
          payload: {
            change: "move",
            path: "notes.txt",
          },
          sessionId: PLATFORM_ID_FIXTURES.session,
        }),
      ),
    ).toThrow();

    expect(() =>
      parseRuntimeEventEnvelope(
        createRuntimeEvent({
          id: createPlatformId(),
          kind: "runtime.timing.recorded",
          occurredAt: OCCURRED_AT,
          payload: {
            completedAtMs: 100,
            path: "warm",
            phases: [],
            runId: null,
            sessionId: PLATFORM_ID_FIXTURES.session,
            source: "driver",
            stage: "driver_turn",
            startedAtMs: 110,
            totalMs: -10,
            traceId: null,
          },
          sessionId: PLATFORM_ID_FIXTURES.session,
        }),
      ),
    ).toThrow();
  });

  test("runtime timing projection keeps envelope identity authoritative", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "runtime.timing.recorded",
      occurredAt: OCCURRED_AT,
      payload: {
        completedAtMs: 1_050,
        path: "warm",
        phases: [],
        runId: "payload-run",
        sessionId: "payload-session",
        source: "driver",
        stage: "driver_turn",
        startedAtMs: 1_000,
        totalMs: 50,
        traceId: "payload-trace",
      },
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
      traceId: "envelope-trace",
    });

    const deliveryEvents = appRuntimeEventToAgUiSessionEvents(event);

    expect(deliveryEvents[0]).toMatchObject({
      value: {
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        sessionId: PLATFORM_ID_FIXTURES.session,
        traceId: "envelope-trace",
      },
    });
  });

  test("round-trips permission requests through canonical events and session delivery events", () => {
    const event = first(
      toRuntimeEventInput(createContext(), {
        kind: "permission.requested",
        payload: {
          details: '{"command":"pwd"}',
          options: [],
          requestId: "permission-1",
          targetItemId: "tool-1",
          title: "Approve command",
          toolCall: {
            kind: "bash",
            toolCallId: "tool-1",
          },
        },
      }),
    );

    expect(event.kind).toBe("permission.requested");
    expect(event.payload).toMatchObject({
      details: '{"command":"pwd"}',
      requestId: "permission-1",
      targetItemId: "tool-1",
      title: "Approve command",
      toolCall: {
        kind: "bash",
        toolCallId: "tool-1",
      },
    });

    const deliveryEvent = first(appRuntimeEventToAgUiSessionEvents(event));

    if (deliveryEvent.type !== EventType.CUSTOM) {
      throw new Error("Expected a custom delivery event.");
    }

    expect(deliveryEvent.name).toBe(MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name);
    expect(deliveryEvent.value.permissionRequests).toHaveLength(1);
    expect(deliveryEvent.value.permissionRequests[0]).toMatchObject({
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      rawInput: '{"command":"pwd"}',
      requestId: "permission-1",
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      title: "Approve command",
      toolCallId: "tool-1",
      toolKind: "bash",
    });
  });

  test("apps permission resolution through the same session permission event", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "permission.resolved",
      occurredAt: OCCURRED_AT,
      payload: {
        outcome: "allow_once",
        requestId: "permission-1",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    const [deliveryEvent] = appRuntimeEventToAgUiSessionEvents(event);

    expect(deliveryEvent).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name,
      value: {
        permissionRequests: [],
      },
    });
  });

  test("rejects malformed tool call projection payloads", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "tool.call.updated",
      occurredAt: OCCURRED_AT,
      payload: {
        rawOutput: "success",
        status: "completed",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => appRuntimeEventToAgUiSessionEvents(event)).toThrow();
  });

  test("does not app owner diagnostics into participant delivery by default", () => {
    const defaultDiagnostic = createRuntimeEvent({
      id: createPlatformId(),
      kind: "diagnostic.reported",
      occurredAt: OCCURRED_AT,
      payload: {
        message: "transport connected",
        severity: "info",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });
    const ownerDebugDiagnostic = createRuntimeEvent({
      id: createPlatformId(),
      kind: "diagnostic.reported",
      occurredAt: OCCURRED_AT,
      payload: {
        message: "transport connected",
        severity: "info",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
      visibility: "owner_debug",
    });

    expect(appRuntimeEventToAgUiSessionEvents(defaultDiagnostic)).toEqual([]);
    expect(appRuntimeEventToAgUiSessionEvents(ownerDebugDiagnostic)).toEqual([]);
  });

  test("does not app system internal events into participant run success", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "driver.heartbeat",
      occurredAt: OCCURRED_AT,
      payload: {
        lifecycle: "IDLE",
        run: {
          completedAt: OCCURRED_AT,
          error: null,
          id: PLATFORM_ID_FIXTURES.sessionRun,
          startedAt: OCCURRED_AT,
          status: "completed",
          traceId: "trace-1",
        },
      },
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(appRuntimeEventToAgUiSessionEvents(event)).toEqual([]);
  });

  test("apps diagnostics only when the event explicitly opts into participant delivery", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "diagnostic.reported",
      occurredAt: OCCURRED_AT,
      payload: {
        message: "transport connected",
        severity: "info",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
      visibility: "participant",
    });

    expect(appRuntimeEventToAgUiSessionEvents(event)).toHaveLength(1);
  });

  test("apps runtime timing payloads without losing detailed timing fields", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "runtime.timing.recorded",
      occurredAt: "2026-05-26T00:00:01.050Z",
      payload: {
        completedAtMs: 1_050,
        path: "warm",
        phases: [
          {
            durationMs: 20,
            name: "spawn",
          },
        ],
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        sessionId: PLATFORM_ID_FIXTURES.session,
        source: "driver",
        stage: "driver_turn",
        startedAtMs: 1_000,
        totalMs: 50,
        traceId: "trace-1",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    const deliveryEvents = appRuntimeEventToAgUiSessionEvents(event);
    const [timelineEvent, timingEvent] = deliveryEvents;

    expect(timelineEvent).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRuntimeTimelineUpdated.name,
      type: EventType.CUSTOM,
      value: {
        durationMs: 50,
        path: "warm",
        stage: "driver_turn",
      },
    });
    expect(timingEvent).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRuntimeTiming.name,
      type: EventType.CUSTOM,
      value: {
        phases: [
          {
            durationMs: 20,
            name: "spawn",
          },
        ],
        totalMs: 50,
      },
    });
  });

  test("rejects malformed runtime timing projection payloads", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "runtime.timing.recorded",
      occurredAt: "2026-05-26T00:00:01.050Z",
      payload: {
        completedAtMs: 1_050,
        path: "warm",
        source: "driver",
        stage: "driver_turn",
        startedAtMs: 1_000,
        totalMs: 50,
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(() => appRuntimeEventToAgUiSessionEvents(event)).toThrow();
  });

  test("creates process drafts directly from canonical runtime timing payloads", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "runtime.timing.recorded",
      occurredAt: "2026-05-26T00:00:01.050Z",
      payload: {
        completedAtMs: 1_050,
        path: "warm",
        phases: [],
        source: "driver",
        stage: "driver_turn",
        startedAtMs: 1_000,
        totalMs: 50,
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    const draft = createProcessDraftFromRuntimeEvent(event);

    expect(draft.type).toBe("session.status");
    expect(draft.content.includes("driver_turn")).toBe(true);
    expect(draft.content.includes("50")).toBe(true);
  });

  test("creates process drafts directly from canonical file change payloads", () => {
    const event = createRuntimeEvent({
      id: createPlatformId(),
      kind: "file.change.updated",
      occurredAt: OCCURRED_AT,
      payload: {
        changes: [
          {
            change: "upsert",
            path: "src/app.ts",
          },
        ],
        status: "completed",
      },
      sessionId: PLATFORM_ID_FIXTURES.session,
    });

    expect(createProcessDraftFromRuntimeEvent(event)).toEqual({
      content: "src/app.ts",
      type: "file.changed",
    });
  });
});
