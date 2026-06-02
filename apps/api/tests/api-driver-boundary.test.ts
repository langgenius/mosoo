import { describe, expect, test } from "bun:test";

import {
  DRIVER_CONTROL_PORT_MAX,
  DRIVER_CONTROL_PORT_MIN,
  DRIVER_PROTOCOL_VERSION,
  parseDriverBootPayloadJson,
} from "@mosoo/driver-protocol";
import { RUNTIME_EVENT_SCHEMA_VERSION, createRuntimeEvent } from "@mosoo/runtime-events";

import { getDriverControlPort } from "../src/modules/runtime/domain/sandbox-layout";
import {
  assertRuntimeEventMatchesDriverEnvelope,
  assertRuntimeEventMatchesDriverLink,
} from "../src/modules/runtime/infrastructure/driver-instance/event-link-assertion";
import {
  readPermissionRequestViews,
  removePermissionRequest,
} from "../src/modules/runtime/infrastructure/driver-instance/event-projection";
import { readNativeResumeRef } from "../src/modules/runtime/infrastructure/driver-instance/native-resume-ref-event";
import {
  createDriverBootPayload,
  verifyRuntimeActionToken,
} from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { buildExecutionSpec } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder";
import type { RuntimeExecutionSpecBindings } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder";
import {
  API_DRIVER_BOUNDARY_IDS,
  createDriverEvent,
  createDriverProfile,
  createResolvedMcpServers,
  createResolvedSkillCatalog,
  createResolvedSkills,
  createRuntimeSessionLink,
} from "./api-driver-boundary-fixtures";

const bindings = {
  RUNTIME_ACTION_TOKEN_SECRET: "test-runtime-action-secret",
} satisfies RuntimeExecutionSpecBindings;

describe("API to driver boundary", () => {
  test("assigns driver control ports inside the sandbox image contract", () => {
    const port = getDriverControlPort("driver-01KRZRFGXAA788FW1GDBT7F0EZ");

    expect(port).toBeGreaterThanOrEqual(DRIVER_CONTROL_PORT_MIN);
    expect(port).toBeLessThanOrEqual(DRIVER_CONTROL_PORT_MAX);
  });

  test("builds a driver execution spec with scoped grants and profile env", async () => {
    const execution = await buildExecutionSpec(bindings, {
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      nativeResumeRef: {
        kind: "openai_thread_id",
        runtimeId: "openai-runtime",
        value: "thread-1",
      },
      organizationAccessSnapshot: {
        entries: [
          {
            mountPath: "/workspace/docs",
            role: "edit",
            spaceId: API_DRIVER_BOUNDARY_IDS.space,
            type: "space",
          },
        ],
      },
      profile: createDriverProfile(),
      requestUrl: "http://localhost:8787/api/driver/connect",
      resolvedMcpServers: createResolvedMcpServers(),
      resolvedSkillCatalog: createResolvedSkillCatalog(),
      resolvedSkills: createResolvedSkills(),
      sessionRunId: API_DRIVER_BOUNDARY_IDS.sessionRun,
    });

    expect(execution.configRevision.runId).toBe(API_DRIVER_BOUNDARY_IDS.sessionRun);
    expect(execution.environment.variables).toEqual({
      EXISTING_ENV: "kept",
    });
    expect(execution.session.context.organizationAccessSnapshot.entries).toEqual([
      {
        mountPath: "/workspace/docs",
        role: "edit",
        spaceId: API_DRIVER_BOUNDARY_IDS.space,
        type: "space",
      },
    ]);

    const activeMcpServer = execution.session.mcpServers.find(
      (server) => server.serverId === API_DRIVER_BOUNDARY_IDS.mcpServerLinear,
    );
    if (!activeMcpServer || !("proxyGrantId" in activeMcpServer)) {
      throw new Error("Expected active MCP server grant.");
    }

    expect(() => new URL(activeMcpServer.proxyUrl)).not.toThrow();
    await expect(
      verifyRuntimeActionToken(bindings, activeMcpServer.proxyGrantId),
    ).resolves.toMatchObject({
      action: "mcp_proxy",
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      resourceId: API_DRIVER_BOUNDARY_IDS.mcpServerLinear,
    });

    const skill = execution.skills.find((entry) => entry.skillId === API_DRIVER_BOUNDARY_IDS.skill);
    if (!skill) {
      throw new Error("Expected resolved skill.");
    }

    const skillUrl = new URL(skill.downloadUrl);
    const skillGrant = skillUrl.searchParams.get("grant");
    if (!skillGrant) {
      throw new Error("Expected skill grant.");
    }
    await expect(verifyRuntimeActionToken(bindings, skillGrant)).resolves.toMatchObject({
      action: "skill_snapshot",
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      resourceId: API_DRIVER_BOUNDARY_IDS.skillSnapshot,
    });

    expect(
      execution.skills.find((entry) => entry.skillId === API_DRIVER_BOUNDARY_IDS.tombstoneSkill)
        ?.downloadUrl,
    ).toBe("https://invalid.local/tombstone.skill");
  });

  test("emits a boot payload that the driver protocol parser accepts", async () => {
    const execution = await buildExecutionSpec(bindings, {
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      organizationAccessSnapshot: {
        entries: [],
      },
      profile: createDriverProfile(),
      requestUrl: "https://api.example.com/api/driver/connect",
      resolvedMcpServers: [],
      resolvedSkillCatalog: [],
      resolvedSkills: [],
      sessionRunId: null,
    });
    const bootPayload = createDriverBootPayload({
      bootToken: "boot-token-1",
      driverControlPort: DRIVER_CONTROL_PORT_MIN,
      driverGeneration: 0,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      execution,
      heartbeatIntervalMs: 1_000,
      runtime: "openai-runtime",
      runtimeTransport: "openai-app-server",
      sandboxId: API_DRIVER_BOUNDARY_IDS.sandbox,
      traceparent: "00-00000000000000000000000000000001-0000000000000001-01",
    });

    const parsed = parseDriverBootPayloadJson(JSON.stringify(bootPayload));

    expect(parsed).toMatchObject({
      driverControlPort: DRIVER_CONTROL_PORT_MIN,
      driverGeneration: 0,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      heartbeatIntervalMs: 1_000,
      protocolVersion: DRIVER_PROTOCOL_VERSION,
      runtime: "openai-runtime",
      runtimeTransport: "openai-app-server",
      sandboxId: API_DRIVER_BOUNDARY_IDS.sandbox,
      traceparent: "00-00000000000000000000000000000001-0000000000000001-01",
    });
    expect(parsed.execution.configRevision.runId).toBeNull();
  });

  test("normalizes driver events before they enter the API session stream", () => {
    const event = createDriverEvent({
      kind: "message.delta",
      payload: {
        contentDelta: "hello",
        messageId: "message-1",
        role: "agent",
      },
    });

    expect(event).toEqual({
      actor: "driver",
      delivery: "lossless",
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
      kind: "message.delta",
      occurredAt: "1970-01-01T00:00:00.010Z",
      origin: "driver",
      payload: {
        contentDelta: "hello",
        messageId: "message-1",
        role: "agent",
      },
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      sessionId: API_DRIVER_BOUNDARY_IDS.session,
      visibility: "participant",
    });
  });

  test("rejects legacy event shapes from the driver channel", () => {
    expect(() =>
      createDriverEvent({
        name: "mosoo.session.sync.request",
        type: "CUSTOM",
        value: {
          reason: "manual",
        },
      }),
    ).toThrow("canonical runtime event draft");
  });

  test("rejects canonical driver events that do not match the linked session", () => {
    expect(() =>
      assertRuntimeEventMatchesDriverLink(
        createRuntimeEvent({
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
          kind: "message.delta",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            contentDelta: "wrong session",
            messageId: "message-1",
          },
          sessionId: "01J0000000000000000000000M",
        }),
        {
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          link: createRuntimeSessionLink(),
        },
      ),
    ).toThrow("Runtime driver event session id does not match the driver session link.");

    expect(() =>
      assertRuntimeEventMatchesDriverLink(
        createRuntimeEvent({
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          id: "01J0000000000000000000000H",
          kind: "run.started",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            startedAt: "1970-01-01T00:00:00.010Z",
          },
          runId: "01J0000000000000000000000P",
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
        }),
        {
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          link: createRuntimeSessionLink(),
        },
      ),
    ).toThrow("Runtime driver event run id does not match the driver session link.");

    expect(() =>
      assertRuntimeEventMatchesDriverLink(
        createRuntimeEvent({
          driverInstanceId: "01J0000000000000000000000E",
          id: "01J0000000000000000000000J",
          kind: "message.delta",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            contentDelta: "wrong driver",
            messageId: "message-1",
          },
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
        }),
        {
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          link: createRuntimeSessionLink(),
        },
      ),
    ).toThrow("Runtime driver event driver instance id does not match the request.");

    expect(() =>
      assertRuntimeEventMatchesDriverLink(
        createRuntimeEvent({
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          id: "01J0000000000000000000000Q",
          kind: "message.delta",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            contentDelta: "missing run",
            messageId: "message-1",
          },
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
        }),
        {
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          link: createRuntimeSessionLink(),
        },
      ),
    ).toThrow("Runtime driver event run id does not match the driver session link.");

    expect(() =>
      assertRuntimeEventMatchesDriverLink(
        createRuntimeEvent({
          id: "01J0000000000000000000000S",
          kind: "message.delta",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            contentDelta: "missing driver",
            messageId: "message-1",
          },
          runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
        }),
        {
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          link: createRuntimeSessionLink(),
        },
      ),
    ).toThrow("Runtime driver event driver instance id does not match the request.");

    expect(() =>
      assertRuntimeEventMatchesDriverLink(
        createRuntimeEvent({
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          id: "01J0000000000000000000000R",
          kind: "message.delta",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            contentDelta: "ok",
            messageId: "message-1",
          },
          runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
        }),
        {
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          link: createRuntimeSessionLink(),
        },
      ),
    ).not.toThrow();
  });

  test("rejects canonical driver events whose source id disagrees with the envelope", () => {
    expect(() =>
      assertRuntimeEventMatchesDriverEnvelope(
        createRuntimeEvent({
          id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
          kind: "message.delta",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            contentDelta: "wrong source",
            messageId: "message-1",
          },
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          sourceEventId: "source-inner",
        }),
        {
          eventId: "source-outer",
        },
      ),
    ).toThrow("Runtime driver event source id does not match the driver envelope.");

    expect(() =>
      assertRuntimeEventMatchesDriverEnvelope(
        createRuntimeEvent({
          id: "01J0000000000000000000000H",
          kind: "message.delta",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            contentDelta: "ok",
            messageId: "message-1",
          },
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          sourceEventId: "source-1",
        }),
        {
          eventId: "source-1",
        },
      ),
    ).not.toThrow();
  });

  test("maps native resume refs from the explicit runtime id only", () => {
    const ref = readNativeResumeRef(
      createRuntimeEvent({
        id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
        kind: "runtime.resume.updated",
        occurredAt: "1970-01-01T00:00:00.010Z",
        payload: {
          resumePointer: "opaque-resume-ref",
        },
        runtimeId: "acp-fallback",
        sessionId: API_DRIVER_BOUNDARY_IDS.session,
      }),
    );

    expect(ref).toMatchObject({
      kind: "acp_session_id",
      runtimeId: "acp-fallback",
    });
    expect(ref?.value).toEqual(expect.any(String));

    expect(() =>
      readNativeResumeRef(
        createRuntimeEvent({
          id: "01J0000000000000000000000H",
          kind: "runtime.resume.updated",
          occurredAt: "1970-01-01T00:00:00.010Z",
          payload: {
            resumePointer: "opaque-ref-without-runtime",
          },
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
        }),
      ),
    ).toThrow("Unsupported runtime native resume ref runtime id");
  });

  test("normalizes permission request snapshots and removes resolved request ids", () => {
    const current = readPermissionRequestViews([
      {
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        rawInput: null,
        requestId: "permission-1",
        runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        title: "Allow shell command?",
        toolCallId: "tool-1",
        toolKind: "shell",
      },
      {
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        requestId: "permission-2",
        runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        title: "Allow file write?",
      },
      {
        requestId: "",
        title: "ignored",
      },
    ]);

    expect(current).toEqual([
      {
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        rawInput: null,
        requestId: "permission-1",
        runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        title: "Allow shell command?",
        toolCallId: "tool-1",
        toolKind: "shell",
      },
      {
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        rawInput: null,
        requestId: "permission-2",
        runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        title: "Allow file write?",
        toolCallId: null,
        toolKind: null,
      },
    ]);

    expect(removePermissionRequest(current ?? [], "permission-1")).toEqual([
      {
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        rawInput: null,
        requestId: "permission-2",
        runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        title: "Allow file write?",
        toolCallId: null,
        toolKind: null,
      },
    ]);
  });
});
