import { describe, expect, test } from "bun:test";

import {
  EventType,
  MOSOO_CUSTOM_EVENT,
  applyAgUiEventToSessionLiveState,
} from "@mosoo/ag-ui-session";
import {
  DRIVER_CONTROL_PORT_MAX,
  DRIVER_CONTROL_PORT_MIN,
  DRIVER_PROTOCOL_VERSION,
  parseDriverBootPayloadJson,
} from "@mosoo/agent-driver/boot";
import {
  RUNTIME_EVENT_KINDS as DRIVER_RUNTIME_EVENT_KINDS,
  RUNTIME_EVENT_SCHEMA_VERSION as DRIVER_RUNTIME_EVENT_SCHEMA_VERSION,
  toRuntimeEventInput as toDriverRuntimeEventInput,
} from "@mosoo/agent-driver/events";
import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import {
  RUNTIME_EVENT_KINDS,
  RUNTIME_EVENT_SCHEMA_VERSION,
  createRuntimeEvent,
} from "@mosoo/runtime-events";

import { getDriverControlPort } from "../src/modules/runtime/domain/sandbox-layout";
import { canonicalizeDriverEventEnvelope } from "../src/modules/runtime/infrastructure/driver-instance/driver-event-canonicalization";
import { assertRuntimeEventMatchesDriverLink } from "../src/modules/runtime/infrastructure/driver-instance/event-link-assertion";
import {
  createBaseLiveState,
  readPermissionRequestViews,
  removePermissionRequest,
} from "../src/modules/runtime/infrastructure/driver-instance/event-projection";
import { projectRuntimeDriverEvents } from "../src/modules/runtime/infrastructure/driver-instance/events";
import { readNativeResumeRef } from "../src/modules/runtime/infrastructure/driver-instance/native-resume-ref-event";
import {
  parseDriverEventBatchInput,
  parseDriverEventBatchOutput,
} from "../src/modules/runtime/infrastructure/driver-instance/rpc-wire";
import {
  createDriverBootPayload,
  verifyRuntimeActionToken,
} from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { AGENT_DRIVER_PROCESS_COMMAND } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-artifact";
import { buildExecutionSpec } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder";
import type { RuntimeExecutionSpecBindings } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder";
import { runSetupScript } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-files.service";
import type { ExecutionSessionHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
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

const artifactPaths = {
  executable: ["/workspace/.mosoo/environment-artifacts/artifact/python/local/bin"],
  node: ["/workspace/.mosoo/environment-artifacts/artifact/npm/node_modules"],
  python: ["/workspace/.mosoo/environment-artifacts/artifact/python/site-packages"],
};

describe("API to driver boundary", () => {
  test("assigns driver control ports inside the sandbox image contract", () => {
    const port = getDriverControlPort("driver-01KRZRFGXAA788FW1GDBT7F0EZ");

    expect(port).toBeGreaterThanOrEqual(DRIVER_CONTROL_PORT_MIN);
    expect(port).toBeLessThanOrEqual(DRIVER_CONTROL_PORT_MAX);
  });

  test("starts the named agent-driver artifact in the sandbox image", () => {
    expect(AGENT_DRIVER_PROCESS_COMMAND).toBe("agent-driver");
  });

  test("builds a driver execution spec with scoped grants and profile env", async () => {
    const execution = await buildExecutionSpec(bindings, {
      builtInTools: [
        { enabled: true, name: "bash" },
        { enabled: true, name: "read" },
        { enabled: true, name: "write" },
        { enabled: true, name: "edit" },
        { enabled: true, name: "glob" },
        { enabled: true, name: "grep" },
        { enabled: true, name: "web_fetch" },
        { enabled: true, name: "web_search" },
      ],
      driverGeneration: 7,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      nativeResumeRef: {
        kind: "openai_thread_id",
        runtimeId: "openai-runtime",
        value: "thread-1",
      },
      profile: {
        ...createDriverProfile(),
        envVarNames: [
          "EXISTING_ENV",
          "OPENAI_API_KEY",
          "OPENAI_BASE_URL",
          "OPENCODE_CONFIG_CONTENT",
        ],
        envVars: {
          EXISTING_ENV: "kept",
          OPENAI_API_KEY: "raw-environment-key",
          OPENAI_BASE_URL: "https://attacker.example.com/v1",
          OPENCODE_CONFIG_CONTENT: '{"provider":{"openai":{"options":{"apiKey":"raw"}}}}',
        },
        environmentArtifact: {
          backupDir: "/workspace/.mosoo/environment-artifacts/artifact",
          backupId: "11111111-1111-4111-8111-111111111111",
          paths: artifactPaths,
        },
      },
      requestUrl: "http://localhost:8787/api/driver/connect",
      resolvedMcpServers: createResolvedMcpServers(),
      resolvedSkillCatalog: createResolvedSkillCatalog(),
      resolvedSkills: createResolvedSkills(),
      sessionRunId: API_DRIVER_BOUNDARY_IDS.sessionRun,
    });

    expect(execution.configRevision.runId).toBe(API_DRIVER_BOUNDARY_IDS.sessionRun);
    expect(execution.profilePrompt).toContain("You are a helpful runtime.");
    expect(execution.profilePrompt).toContain("Runtime artifact delivery:");
    expect(execution.profilePrompt).toContain("only user-downloadable session output directory");
    expect(execution.profilePrompt).toContain("even if the user does not explicitly ask");
    expect(execution.profilePrompt).toContain("Files written anywhere else are scratch");
    const llmProxyGrant = execution.environment.variables["OPENAI_API_KEY"];
    if (llmProxyGrant === undefined) {
      throw new Error("Expected an LLM proxy grant env var.");
    }

    expect(execution.environment.variables).toEqual({
      EXISTING_ENV: "kept",
      OPENAI_API_KEY: llmProxyGrant,
      OPENAI_BASE_URL: `http://localhost:8787/api/driver/llm/proxy/${PLATFORM_ID_FIXTURES.vendorCredential}`,
    });
    await expect(verifyRuntimeActionToken(bindings, llmProxyGrant)).resolves.toMatchObject({
      action: "llm_proxy",
      projectId: API_DRIVER_BOUNDARY_IDS.project,
      driverGeneration: 7,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      modelId: "gpt-5.1",
      modelProtocol: "openai-responses",
      resourceId: PLATFORM_ID_FIXTURES.vendorCredential,
    });
    expect(execution.environment.paths).toEqual(artifactPaths);

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

  test("removes runtime-managed provider values from the setup process", async () => {
    let setupEnv: Record<string, string | undefined> | undefined;
    const session: ExecutionSessionHandle = {
      exec: async () => ({ exitCode: 0, stderr: "", stdout: "missing", success: true }),
      mkdir: async () => undefined,
      readFile: async () => ({ content: "", encoding: "utf8" }),
      startProcess: async (_command, options) => {
        setupEnv = options.env;
        return {
          getLogs: async () => "",
          getStatus: async () => "completed",
          id: "setup",
          kill: async () => undefined,
          pid: 1,
          waitForExit: async () => ({ exitCode: 0 }),
          waitForPort: async () => undefined,
        };
      },
      watch: async () => new ReadableStream<Uint8Array>(),
      writeFile: async () => undefined,
    };

    await runSetupScript(session, {
      ...createDriverProfile(),
      envVarNames: ["EXISTING_ENV", "OPENAI_API_KEY", "OPENAI_BASE_URL"],
      envVars: {
        EXISTING_ENV: "kept",
        OPENAI_API_KEY: "raw-environment-key",
        OPENAI_BASE_URL: "https://attacker.example.com/v1",
      },
      setupScript: "echo setup",
    });

    expect(setupEnv).toEqual({ EXISTING_ENV: "kept" });
  });

  test("emits a boot payload that the driver protocol parser accepts", async () => {
    const execution = await buildExecutionSpec(bindings, {
      builtInTools: createDefaultAgentBuiltInTools(),
      driverGeneration: 0,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      profile: createDriverProfile(),
      requestUrl: "https://api.example.com/api/driver/connect",
      resolvedMcpServers: [],
      resolvedSkillCatalog: [],
      resolvedSkills: [],
      sessionRunId: null,
    });
    const bootPayload = createDriverBootPayload({
      bootToken: "boot-token-1",
      controlUrl: "https://api.example.com/api/driver/socket",
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
      runtimeId: "openai-runtime",
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      sessionId: API_DRIVER_BOUNDARY_IDS.session,
      traceId: "trace-1",
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
      occurredAt: "1970-01-01T00:00:00.010Z",
    };
    const batch = parseDriverEventBatchInput({
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: [platformEnvelope],
    });
    const [envelope] = batch.events;

    expect(batch.driverInstanceId).toBe(API_DRIVER_BOUNDARY_IDS.driverInstance);
    expect(envelope.eventId).toBe("source-1");
    expect(envelope.event.kind).toBe("message.delta");
    expect(envelope.occurredAt).toBe("1970-01-01T00:00:00.010Z");
  });

  test("requires source identity on every accepted driver event receipt", () => {
    const receipt = {
      eventId: "source-1",
      seq: 1,
      type: "message.delta",
    };

    expect(parseDriverEventBatchOutput({ accepted: [receipt] })).toEqual({
      accepted: [receipt],
    });
    expect(() =>
      parseDriverEventBatchOutput({
        accepted: [{ seq: 1, type: "message.delta" }],
      }),
    ).toThrow();
    expect(() =>
      parseDriverEventBatchOutput({
        accepted: [{ ...receipt, eventId: "" }],
      }),
    ).toThrow();
  });

  test("keeps the Driver and API canonical event vocabularies exactly aligned", () => {
    expect(RUNTIME_EVENT_SCHEMA_VERSION).toBe(DRIVER_RUNTIME_EVENT_SCHEMA_VERSION);
    expect(RUNTIME_EVENT_KINDS).toEqual(DRIVER_RUNTIME_EVENT_KINDS);
  });

  test("admits an envelope built by the production Driver event builder", () => {
    const occurredAt = "2026-08-29T00:00:00.000Z";
    const [driverEvent] = toDriverRuntimeEventInput(
      {
        createId: () => API_DRIVER_BOUNDARY_IDS.runtimeEvent,
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        occurredAt,
        runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        sessionId: API_DRIVER_BOUNDARY_IDS.session,
        sourceEventId: "driver-builder-message-delta",
      } as Parameters<typeof toDriverRuntimeEventInput>[0],
      {
        kind: "message.delta",
        payload: {
          contentDelta: "Driver-built payload",
          messageId: "driver-builder-message",
          role: "agent",
        },
      },
    );

    expect(driverEvent).toBeDefined();
    expect(
      parseDriverEventBatchInput({
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        events: [
          {
            event: driverEvent,
            eventId: "driver-builder-message-delta",
            occurredAt,
          },
        ],
      }).events,
    ).toEqual([
      {
        event: driverEvent,
        eventId: "driver-builder-message-delta",
        occurredAt,
      },
    ]);
  });

  test("admits Driver terminal wire fixtures through the independent API boundary", async () => {
    const link = createRuntimeSessionLink();
    const occurredAt = "1970-01-01T00:00:01.000Z";
    const fixtures = [
      {
        id: "01J0000000000000000000001C",
        kind: "message.cancelled",
        payload: { messageId: "message-cancelled", role: "agent" },
      },
      {
        id: "01J0000000000000000000001D",
        kind: "message.failed",
        payload: {
          error: {
            code: "runtime.failed",
            details: {},
            message: "Runtime failed.",
            retryable: false,
          },
          messageId: "message-failed",
          role: "agent",
        },
      },
      {
        id: "01J0000000000000000000001E",
        kind: "thought.cancelled",
        payload: { thoughtId: "thought-cancelled" },
      },
      {
        id: "01J0000000000000000000001F",
        kind: "tool.call.updated",
        payload: { status: "cancelled", toolCallId: "tool-cancelled" },
      },
    ] as const;
    const batch = parseDriverEventBatchInput({
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: fixtures.map(({ id, kind, payload }, index) => ({
        event: {
          actor: "driver",
          delivery: "lossless",
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          id,
          kind,
          occurredAt,
          origin: "driver",
          payload,
          runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
          runtimeId: "openai-runtime",
          schemaVersion: DRIVER_RUNTIME_EVENT_SCHEMA_VERSION,
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          traceId: "trace-1",
          visibility: "participant",
        },
        eventId: `source-terminal-${index}`,
        occurredAt,
      })),
    });
    const projection = await projectRuntimeDriverEvents(
      { DB: new SqliteD1Database() } as ApiBindings,
      {
        currentLiveState: createBaseLiveState({
          callerId: link.callerId,
          creatorId: link.creatorId,
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          sessionId: link.sessionId,
        }),
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        events: batch.events,
        link,
      },
    );

    expect(
      projection.runtimeEvents.map(({ event }) => ({
        id: event.id,
        kind: event.kind,
        payload: event.payload,
        schemaVersion: event.schemaVersion,
      })),
    ).toEqual(
      fixtures.map(({ id, kind, payload }) => ({
        id,
        kind,
        payload,
        schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      })),
    );
    expect(projection.sessionDeliveryEvents.map(({ event }) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_END,
      EventType.TEXT_MESSAGE_END,
      EventType.REASONING_MESSAGE_END,
      EventType.CUSTOM,
    ]);
  });

  test("replays tool snapshots and deltas through the same live-state reducer", async () => {
    const link = createRuntimeSessionLink();
    const currentLiveState = createBaseLiveState({
      callerId: link.callerId,
      creatorId: link.creatorId,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      sessionId: link.sessionId,
    });
    const updates = [
      {
        parentMessageId: "assistant-1",
        rawInputDelta: '{"cmd":',
        rawOutputDelta: "partial",
        status: "running",
        title: "Shell",
        toolCallId: "tool-1",
      },
      {
        rawInput: '{"cmd":"ls"',
        rawOutput: "snapshot",
        status: "running",
        toolCallId: "tool-1",
      },
      {
        rawInputDelta: ',"tail":true}',
        rawOutputDelta: " tail",
        status: "completed",
        toolCallId: "tool-1",
      },
    ] as const;
    const batch = parseDriverEventBatchInput({
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: updates.map((payload, index) => ({
        event: createDriverEvent({
          kind: "tool.call.updated",
          payload,
          runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        }),
        eventId: `source-tool-${index}`,
        occurredAt: `1970-01-01T00:00:0${index + 1}.000Z`,
      })),
    });
    const projection = await projectRuntimeDriverEvents(
      { DB: new SqliteD1Database() } as ApiBindings,
      {
        currentLiveState,
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        events: batch.events,
        link,
      },
    );
    const replayed = projection.sessionDeliveryEvents.reduce(
      (state, record) => applyAgUiEventToSessionLiveState(state, record.event),
      currentLiveState,
    );

    expect({ ...projection.nextLiveState, updatedAt: null }).toEqual({
      ...replayed,
      updatedAt: null,
    });
    expect(replayed.messages).toEqual([
      expect.objectContaining({
        id: "assistant-1",
        segments: [
          {
            argsText: '{"cmd":"ls","tail":true}',
            kind: "tool_use",
            path: null,
            runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
            tool: "Shell",
            toolCallId: "tool-1",
          },
          {
            kind: "tool_result",
            output: "snapshot tail",
            runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
            tool: "Shell",
            toolCallId: "tool-1",
          },
        ],
      }),
    ]);
    expect(
      projection.sessionDeliveryEvents.map(({ event }) =>
        event.type === EventType.CUSTOM ? event.name : event.type,
      ),
    ).toEqual(Array(3).fill(MOSOO_CUSTOM_EVENT.sessionToolUpdated.name));
  });

  test("projects admitted driver wire events into API runtime and viewer events", async () => {
    const link = createRuntimeSessionLink();
    const permissionRequest = {
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      rawInput: "pwd",
      requestId: "permission-1",
      runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
      title: "Allow shell command?",
      toolCallId: "tool-1",
      toolKind: "shell",
    };
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
          occurredAt: "1970-01-01T00:00:01.000Z",
        },
      ],
    });
    const baseLiveState = createBaseLiveState({
      callerId: link.callerId,
      creatorId: link.creatorId,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      sessionId: link.sessionId,
    });

    const projection = await projectRuntimeDriverEvents(
      { DB: new SqliteD1Database() } as ApiBindings,
      {
        currentLiveState: {
          ...baseLiveState,
          lifecycle: "RUNNING",
          run: {
            ...baseLiveState.run,
            id: API_DRIVER_BOUNDARY_IDS.sessionRun,
            status: "running",
          },
        },
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        events: batch.events,
        link,
      },
    );

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
      type: EventType.CUSTOM,
      value: {
        permissionRequest,
        permissionRequests: [],
      },
    });
    expect(projection.nextLiveState).toMatchObject({
      permissionRequests: [permissionRequest],
      run: {
        id: API_DRIVER_BOUNDARY_IDS.sessionRun,
        status: "waiting_input",
      },
    });
  });

  test("accepts a production Driver terminal envelope without inventing failed tool output", async () => {
    const link = createRuntimeSessionLink();
    const baseLiveState = createBaseLiveState({
      callerId: link.callerId,
      creatorId: link.creatorId,
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      sessionId: link.sessionId,
    });
    const pendingToolUse = {
      argsText: '{"cmd":"pwd"}',
      kind: "tool_use",
      path: null,
      tool: "Shell",
      toolCallId: "tool-1",
    } as const;
    const runError = {
      code: "runtime.failed",
      details: {},
      message: "Runtime driver control socket is not connected.",
      retryable: false,
    };
    const transportSourceId = "driver-builder-run-failed";
    const [driverRunFailed] = toDriverRuntimeEventInput(
      {
        createId: () => API_DRIVER_BOUNDARY_IDS.runtimeEvent,
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        occurredAt: "1970-01-01T00:00:01.000Z",
        runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        runtimeId: "openai-runtime",
        sessionId: API_DRIVER_BOUNDARY_IDS.session,
        sourceEventId: transportSourceId,
      } as Parameters<typeof toDriverRuntimeEventInput>[0],
      {
        kind: "run.failed",
        payload: {
          error: runError,
          recoverable: false,
        },
      },
    );
    const batch = parseDriverEventBatchInput({
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: [
        {
          event: driverRunFailed,
          eventId: transportSourceId,
          occurredAt: "1970-01-01T00:00:01.000Z",
        },
      ],
    });
    const canonicalEnvelope = canonicalizeDriverEventEnvelope(batch.events[0], {
      traceId: link.traceId,
    });

    const projection = await projectRuntimeDriverEvents(
      { DB: new SqliteD1Database() } as ApiBindings,
      {
        currentLiveState: {
          ...baseLiveState,
          lifecycle: "RUNNING",
          messages: [
            {
              content: "",
              createdAt: "2026-05-26T00:00:00.000Z",
              id: "assistant-1",
              plan: [],
              role: "assistant",
              segments: [pendingToolUse],
            },
          ],
          run: {
            ...baseLiveState.run,
            id: API_DRIVER_BOUNDARY_IDS.sessionRun,
            status: "running",
          },
        },
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        events: [canonicalEnvelope],
        link,
      },
    );
    const canonicalFailureSourceId = `session-run-terminal:${API_DRIVER_BOUNDARY_IDS.sessionRun}:run.failed`;

    expect(canonicalEnvelope).toMatchObject({
      event: { sourceEventId: canonicalFailureSourceId, traceId: link.traceId },
      eventId: transportSourceId,
    });
    expect(projection.runtimeEvents).toMatchObject([{ sourceEventId: canonicalFailureSourceId }]);
    expect(projection.sessionDeliveryEvents.map((record) => record.sourceEventId)).toEqual([
      canonicalFailureSourceId,
    ]);
    expect(projection.sessionDeliveryEvents[0]?.event).toMatchObject({
      name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
      type: EventType.CUSTOM,
      value: {
        lifecycle: "IDLE",
        run: {
          error: runError,
          id: API_DRIVER_BOUNDARY_IDS.sessionRun,
          status: "failed",
        },
      },
    });
    expect(projection.nextLiveState).toMatchObject({
      infra: {
        driverInstanceId: null,
        lastFailureMessage: runError.message,
        lastFailureReason: runError.code,
      },
      lifecycle: "IDLE",
      run: {
        error: runError,
        id: API_DRIVER_BOUNDARY_IDS.sessionRun,
        status: "failed",
      },
    });
    expect(projection.nextLiveState?.messages[0]?.segments).toEqual([pendingToolUse]);
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
          runtimeId: "openai-runtime",
          sessionId: "01J0000000000000000000000M",
          traceId: "trace-1",
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
          runtimeId: "openai-runtime",
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          traceId: "trace-1",
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
          runtimeId: "openai-runtime",
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          traceId: "trace-1",
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
          runtimeId: "openai-runtime",
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          traceId: "trace-1",
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
          runtimeId: "openai-runtime",
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          traceId: "trace-1",
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
          runtimeId: "openai-runtime",
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          traceId: "trace-1",
        }),
        {
          driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
          link: createRuntimeSessionLink(),
        },
      ),
    ).not.toThrow();
  });

  test("rejects non-empty task snapshots after run terminal but permits an explicit clear", () => {
    const event = (tasks: { taskId: string }[]) =>
      createRuntimeEvent({
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
        kind: "agent.tasks.replaced",
        occurredAt: "1970-01-01T00:00:00.010Z",
        payload: { tasks },
        runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
        runtimeId: "openai-runtime",
        sessionId: API_DRIVER_BOUNDARY_IDS.session,
        traceId: "trace-1",
      });
    const terminalLink = {
      ...createRuntimeSessionLink(),
      sessionRunStatus: "completed" as const,
    };

    expect(() =>
      assertRuntimeEventMatchesDriverLink(event([{ taskId: "stale" }]), {
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        link: terminalLink,
      }),
    ).toThrow("requires an active session run");
    expect(() =>
      assertRuntimeEventMatchesDriverLink(event([]), {
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        link: terminalLink,
      }),
    ).not.toThrow();
  });

  test("rejects Driver transport source ids that disagree with their envelopes", () => {
    expect(() =>
      canonicalizeDriverEventEnvelope(
        {
          event: createRuntimeEvent({
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
          eventId: "source-outer",
        },
        { traceId: null },
      ),
    ).toThrow("Runtime driver event source id does not match the driver envelope.");

    expect(() =>
      canonicalizeDriverEventEnvelope(
        {
          event: createRuntimeEvent({
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
          eventId: "source-1",
        },
        { traceId: null },
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
