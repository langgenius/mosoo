import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { MOSOO_CUSTOM_EVENT } from "@mosoo/ag-ui-session";
import { RUNTIME_EVENT_SCHEMA_VERSION, createRuntimeEvent } from "@mosoo/runtime-events";
import {
  DRIVER_CONTROL_PORT_MAX,
  DRIVER_CONTROL_PORT_MIN,
  DRIVER_PROTOCOL_VERSION,
  parseDriverBootPayloadJson,
} from "agent-driver/boot";

import { getDriverControlPort } from "../src/modules/runtime/domain/sandbox-layout";
import {
  assertRuntimeEventMatchesDriverEnvelope,
  assertRuntimeEventMatchesDriverLink,
} from "../src/modules/runtime/infrastructure/driver-instance/event-link-assertion";
import {
  createBaseLiveState,
  readPermissionRequestViews,
  removePermissionRequest,
} from "../src/modules/runtime/infrastructure/driver-instance/event-projection";
import { projectRuntimeDriverEvents } from "../src/modules/runtime/infrastructure/driver-instance/events";
import { readNativeResumeRef } from "../src/modules/runtime/infrastructure/driver-instance/native-resume-ref-event";
import { parseDriverEventBatchInput } from "../src/modules/runtime/infrastructure/driver-instance/rpc-wire";
import {
  createDriverBootPayload,
  verifyRuntimeActionToken,
} from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { AGENT_DRIVER_PROCESS_COMMAND } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-artifact";
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
import { SqliteD1Database } from "./helpers/sqlite-d1";

const bindings = {
  RUNTIME_ACTION_TOKEN_SECRET: "test-runtime-action-secret",
} satisfies RuntimeExecutionSpecBindings;

function readText(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("API to driver boundary", () => {
  test("assigns driver control ports inside the sandbox image contract", () => {
    const port = getDriverControlPort("driver-01KRZRFGXAA788FW1GDBT7F0EZ");

    expect(port).toBeGreaterThanOrEqual(DRIVER_CONTROL_PORT_MIN);
    expect(port).toBeLessThanOrEqual(DRIVER_CONTROL_PORT_MAX);
  });

  test("starts the named agent-driver artifact in the sandbox image", () => {
    expect(AGENT_DRIVER_PROCESS_COMMAND).toBe("agent-driver");
  });

  test("uses the agent-driver runtime contract for runtime selection", () => {
    const runtimeConfig = readText("../src/modules/runtime/domain/runtime-config.ts");
    const agentConfig = readText(
      "../src/modules/agents/application/agent-versioned-config.service.ts",
    );
    const nativeResumeRef = readText(
      "../src/modules/runtime/infrastructure/native-resume-ref.repository.ts",
    );
    const nativeResumeRefEvent = readText(
      "../src/modules/runtime/infrastructure/driver-instance/native-resume-ref-event.ts",
    );

    expect(runtimeConfig).toContain('from "agent-driver/runtime"');
    expect(runtimeConfig).not.toContain('from "@mosoo/driver-protocol"');
    expect(agentConfig).toContain('from "agent-driver/runtime"');
    expect(agentConfig).not.toContain('from "@mosoo/driver-protocol"');
    expect(nativeResumeRef).toContain('from "agent-driver/runtime"');
    expect(nativeResumeRef).not.toContain('from "@mosoo/driver-protocol"');
    expect(nativeResumeRefEvent).toContain('from "agent-driver/runtime"');
    expect(nativeResumeRefEvent).not.toContain('from "@mosoo/driver-protocol"');
  });

  test("uses agent-driver boot constants for process startup", () => {
    const bootToken = readText("../src/modules/runtime/infrastructure/runtime-boot-token.ts");
    const provisioning = readText(
      "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-provisioning.service.ts",
    );
    const driverRecord = readText(
      "../src/modules/runtime/infrastructure/driver-instance/driver-instance-record.repository.ts",
    );
    const sandboxLayout = readText("../src/modules/runtime/domain/sandbox-layout.ts");

    expect(bootToken).toContain('from "agent-driver/boot"');
    expect(bootToken).toContain("DRIVER_PROTOCOL_VERSION");
    expect(bootToken).not.toContain('from "@mosoo/driver-protocol"');
    expect(provisioning).toContain('from "agent-driver/boot"');
    expect(provisioning).toContain("DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME");
    expect(provisioning).toContain("const bootPayload = createDriverBootPayload");
    expect(provisioning).toContain("JSON.stringify(bootPayload)");
    expect(driverRecord).toContain('from "agent-driver/boot"');
    expect(driverRecord).toContain("DRIVER_PROTOCOL_VERSION");
    expect(sandboxLayout).toContain('from "agent-driver/boot"');
    expect(sandboxLayout).toContain("DRIVER_CONTROL_PORT_COUNT");
    expect(sandboxLayout).toContain("DRIVER_CONTROL_PORT_MIN");
  });

  test("uses agent-driver sandbox path contracts", () => {
    const fileBrowserPath = readText(
      "../src/modules/runtime/application/agent-file-browser-path.ts",
    );
    const runtimeProfile = readText("../src/modules/runtime/application/agent-runtime-profile.ts");
    const sandboxLayout = readText("../src/modules/runtime/domain/sandbox-layout.ts");
    const subjectPlatform = readText(
      "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-platform.ts",
    );

    expect(fileBrowserPath).toContain('from "agent-driver/paths"');
    expect(fileBrowserPath).not.toContain('from "@mosoo/driver-protocol"');
    expect(runtimeProfile).toContain('from "agent-driver/paths"');
    expect(sandboxLayout).toContain('from "agent-driver/paths"');
    expect(subjectPlatform).toContain('from "agent-driver/paths"');
  });

  test("publishes agent-driver event envelope contracts", () => {
    const driverPublicEvents = readText("../../driver/src/events.ts");
    const rpc = readText("../src/modules/runtime/infrastructure/driver-instance/rpc.ts");
    const rpcWire = readText("../src/modules/runtime/infrastructure/driver-instance/rpc-wire.ts");
    const ingestion = readText(
      "../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller.ts",
    );
    const projection = readText("../src/modules/runtime/infrastructure/driver-instance/events.ts");
    const receipts = readText(
      "../src/modules/runtime/infrastructure/driver-instance/driver-event-receipts.ts",
    );
    const replayFilter = readText(
      "../src/modules/runtime/infrastructure/driver-instance/runtime-event-replay-filter.ts",
    );
    const fixtures = readText("./api-driver-boundary-fixtures.ts");

    expect(driverPublicEvents).toContain("./protocol/events");
    expect(rpcWire).toContain('from "agent-driver/events"');
    expect(rpcWire).toContain("parseDriverEventEnvelope");
    expect(rpcWire).not.toContain('from "@mosoo/driver-protocol"');
    expect(rpc).not.toContain("toAgentDriverEventEnvelopes");
    expect(ingestion).toContain("state.readProcessedDriverEventReceipts(input.events)");
    expect(ingestion).toContain("state.filterUnprocessedDriverEvents(input.events)");
    expect(projection).toContain('from "agent-driver/events"');
    expect(projection).not.toContain('from "@mosoo/driver-protocol"');
    expect(receipts).toContain('from "agent-driver/events"');
    expect(replayFilter).toContain('from "agent-driver/events"');
    expect(fixtures).toContain('from "agent-driver/events"');
  });

  test("uses agent-driver ORPC contracts behind the API wire parser", () => {
    const rpc = readText("../src/modules/runtime/infrastructure/driver-instance/rpc.ts");
    const controller = readText(
      "../src/modules/runtime/infrastructure/driver-instance/rpc-controller.ts",
    );
    const command = readText(
      "../src/modules/runtime/infrastructure/driver-instance/rpc-command-controller.ts",
    );
    const eventIngestion = readText(
      "../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller.ts",
    );
    const handshake = readText(
      "../src/modules/runtime/infrastructure/driver-instance/rpc-handshake-controller.ts",
    );
    const state = readText("../src/modules/runtime/infrastructure/driver-instance/state.ts");
    const runtimeState = readText(
      "../src/modules/runtime/infrastructure/driver-instance/runtime-state.ts",
    );
    const runtimeStateStore = readText(
      "../src/modules/runtime/infrastructure/driver-instance/runtime-state-store.ts",
    );
    const lifecycle = readText(
      "../src/modules/runtime/infrastructure/driver-instance/lifecycle.ts",
    );
    const handler = readText(
      "../src/modules/runtime/infrastructure/driver-instance/rpc-handler.ts",
    );
    const rpcWire = readText("../src/modules/runtime/infrastructure/driver-instance/rpc-wire.ts");

    expect(rpc).toContain('from "agent-driver/orpc"');
    expect(rpc).toContain('from "./rpc-wire"');
    expect(controller).toContain('from "agent-driver/orpc"');
    expect(command).toContain('from "agent-driver/orpc"');
    expect(eventIngestion).toContain('from "agent-driver/orpc"');
    expect(handshake).toContain('from "agent-driver/orpc"');
    expect(state).toContain('from "agent-driver/orpc"');
    expect(runtimeState).toContain('from "agent-driver/orpc"');
    expect(runtimeStateStore).toContain('from "agent-driver/orpc"');
    expect(runtimeStateStore).toContain("parseDriverHelloInput");
    expect(runtimeStateStore).not.toContain('from "@mosoo/driver-protocol"');
    expect(lifecycle).toContain('from "agent-driver/orpc"');
    expect(controller).not.toContain('from "@mosoo/driver-protocol"');
    expect(eventIngestion).not.toContain('from "@mosoo/driver-protocol"');
    expect(rpc).not.toContain('from "@mosoo/driver-protocol"');
    expect(rpcWire).toContain("runtimeOrpcRouter");
    expect(rpcWire).toContain('from "agent-driver/orpc"');
    expect(rpcWire).toContain('from "agent-driver/events"');
    expect(rpcWire).not.toContain('from "@mosoo/driver-protocol"');
    expect(handler).not.toContain('from "@mosoo/driver-protocol"');
    expect(handler).toContain("runtimeOrpcRouter");
  });

  test("builds session config traces from the agent-driver boot payload", () => {
    const dispatchRun = readText(
      "../src/modules/runtime/application/session-runs/dispatch-run.service.ts",
    );
    const callbackContract = readText(
      "../src/modules/runtime/application/execution-plane/driver-boot-payload-prepared.ts",
    );
    const configTrace = readText(
      "../src/modules/runtime/application/session-definition/session-config-trace-event.ts",
    );

    expect(callbackContract).toContain('from "agent-driver/boot"');
    expect(dispatchRun).toContain("onBootPayloadPrepared: async ({ bootPayload })");
    expect(dispatchRun).not.toContain("toAgentDriverBootPayload(bootPayload)");
    expect(dispatchRun).toContain("buildSessionConfigTraceValue(bootPayload)");
    expect(dispatchRun).toContain("bootPayload.execution.session.mcpServers.length");
    expect(dispatchRun).toContain("bootPayload.execution.provider");
    expect(configTrace).toContain('from "agent-driver/boot"');
    expect(configTrace).not.toContain('from "@mosoo/driver-protocol"');
  });

  test("owns platform driver snapshots inside the API runtime domain", () => {
    const driverSnapshot = readText("../src/modules/runtime/domain/driver-snapshot.ts");
    const runtimeProfile = readText("../src/modules/runtime/application/agent-runtime-profile.ts");
    const executionTypes = readText(
      "../src/modules/runtime/application/session-definition/session-execution.types.ts",
    );
    const executionSpec = readText(
      "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder.ts",
    );
    const sandboxSessionTypes = readText(
      "../src/modules/runtime/infrastructure/sandbox-session/sandbox-session.types.ts",
    );
    const sandboxConversationCodec = readText(
      "../src/modules/runtime/infrastructure/sandbox-session/sandbox-conversation-session-codec.ts",
    );
    const mcpRuntime = readText("../src/modules/mcp/application/mcp-runtime.service.ts");
    const fixtures = readText("./api-driver-boundary-fixtures.ts");

    expect(driverSnapshot).toContain('from "agent-driver/runtime"');
    expect(driverSnapshot).not.toContain('from "@mosoo/driver-protocol"');
    expect(runtimeProfile).toContain('from "../domain/driver-snapshot"');
    expect(executionTypes).toContain('from "../../domain/driver-snapshot"');
    expect(executionSpec).toContain('from "../../domain/driver-snapshot"');
    expect(sandboxSessionTypes).toContain('from "../../domain/driver-snapshot"');
    expect(sandboxConversationCodec).toContain('from "../../domain/driver-snapshot"');
    expect(sandboxConversationCodec).toContain("readSandboxConversationOriginRecord");
    expect(mcpRuntime).toContain('from "../../runtime/domain/driver-snapshot"');
    expect(fixtures).toContain('from "../src/modules/runtime/domain/driver-snapshot"');
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

    expect(bootPayload).toMatchObject({
      driverControlPort: DRIVER_CONTROL_PORT_MIN,
      protocolVersion: DRIVER_PROTOCOL_VERSION,
      runtime: "openai-runtime",
      runtimeTransport: "openai-app-server",
    });
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

  test("admits driver wire event envelopes through the agent-driver event parser", () => {
    const platformEnvelope = {
      event: createDriverEvent({
        kind: "message.delta",
        payload: {
          contentDelta: "hello",
          messageId: "message-1",
          role: "agent",
        },
      }),
      eventId: "source-1",
      occurredAt: 10,
    };
    const batch = parseDriverEventBatchInput({
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: [platformEnvelope],
    });
    const [envelope] = batch.events;

    expect(batch.driverInstanceId).toBe(API_DRIVER_BOUNDARY_IDS.driverInstance);
    expect(envelope.eventId).toBe("source-1");
    expect(envelope.event.kind).toBe("message.delta");
    expect(envelope.occurredAt).toBe(10);
  });

  test("projects admitted driver wire events into API runtime and viewer events", async () => {
    const link = createRuntimeSessionLink();
    const permissionRequested = createDriverEvent({
      kind: "permission.requested",
      payload: {
        details: "pwd",
        requestId: "permission-1",
        targetItemId: "tool-1",
        title: "Allow shell command?",
        toolCall: {
          kind: "shell",
          rawInput: "pwd",
          toolCallId: "tool-1",
        },
      },
      runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
    });
    const batch = parseDriverEventBatchInput({
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: [
        {
          event: permissionRequested,
          eventId: "source-permission-1",
          occurredAt: 1_000,
        },
      ],
    });

    const projection = await projectRuntimeDriverEvents(new SqliteD1Database(), {
      currentLiveState: createBaseLiveState({
        callerId: link.callerId,
        creatorId: link.creatorId,
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        sessionId: link.sessionId,
      }),
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: batch.events,
      link,
    });

    expect(projection.runtimeEvents).toHaveLength(1);
    expect(projection.runtimeEvents[0]).toMatchObject({
      occurredAt: 1_000,
      sourceEventId: "source-permission-1",
    });
    expect(projection.runtimeEvents[0]?.event.kind).toBe("permission.requested");
    expect(projection.sessionDeliveryEvents).toHaveLength(1);
    expect(projection.sessionDeliveryEvents[0]).toMatchObject({
      occurredAt: 1_000,
      sourceEventId: "source-permission-1",
    });
    expect(projection.liveStateChanged).toBe(true);
    expect(projection.sessionDeliveryEvents[0]?.event).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name,
      value: {
        permissionRequests: [
          {
            driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
            rawInput: "pwd",
            requestId: "permission-1",
            runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
            title: "Allow shell command?",
            toolCallId: "tool-1",
            toolKind: "shell",
          },
        ],
      },
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
