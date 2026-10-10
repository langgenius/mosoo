import { describe, expect, test } from "bun:test";

import { EventType, MOSOO_CUSTOM_EVENT } from "@mosoo/ag-ui-session";
import {
  DRIVER_CONTROL_PORT_MAX,
  DRIVER_CONTROL_PORT_MIN,
  DRIVER_PROTOCOL_VERSION,
  parseNativeCheckpoint,
  parseDriverBootPayloadJson,
} from "@mosoo/agent-driver/boot";
import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
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
import { projectRuntimeDriverEvents } from "../src/modules/runtime/infrastructure/driver-instance/events";
import { readNativeResumeRef } from "../src/modules/runtime/infrastructure/driver-instance/native-resume-ref-event";
import { parseDriverEventBatchInput } from "../src/modules/runtime/infrastructure/driver-instance/rpc-wire";
import {
  createDriverBootPayload,
  verifyRuntimeActionToken,
} from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { buildExecutionSpec } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder";
import type { RuntimeExecutionSpecBindings } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder";
import { createInitialSessionLiveState } from "../src/modules/sessions/application/session-live-state.service";
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
import { createPublicHttpContractDatabase } from "./helpers/public-api-http-test-fixture";
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
  test.each(["cattle", "pet"] as const)(
    "requires a committed native checkpoint even when the boot input retains a historical %s label",
    async (kind) => {
      const profile = createDriverProfile();
      const historicalProfile = {
        ...profile,
        kind,
        sandbox: { ...profile.sandbox, kind },
      };
      const execution = await buildExecutionSpec(bindings, {
        builtInTools: [],
        driverGeneration: 0,
        driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
        nativeResumeRef: {
          kind: "openai_thread_id",
          runtimeId: "openai-runtime",
          value: "committed-thread",
        },
        nativeCheckpoint: parseNativeCheckpoint({
          formatVersion: 1,
          runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
          nativeRef: {
            kind: "openai_thread_id",
            runtimeId: "openai-runtime",
            value: "committed-thread",
          },
        }),
        profile: historicalProfile,
        requestUrl: "https://api.example.com/api/driver/connect",
        resolvedMcpServers: [],
        resolvedSkillCatalog: [],
        resolvedSkills: [],
      });
      const payload = createDriverBootPayload({
        bootToken: "native-recovery-test",
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
      const parsed = parseDriverBootPayloadJson(JSON.stringify(payload));
      expect(payload.execution.session.context).not.toHaveProperty("sandboxKind");
      expect(parsed.execution.session.context).not.toHaveProperty("sandboxKind");
      expect(parsed.execution.session.nativeCheckpoint?.nativeRef).toEqual(
        parsed.execution.session.nativeResumeRef,
      );
      expect(parsed.execution.session).not.toHaveProperty("nativeResumeRequired");
      expect(() =>
        parseDriverBootPayloadJson(
          JSON.stringify({
            ...payload,
            execution: {
              ...payload.execution,
              session: { ...payload.execution.session, nativeCheckpoint: null },
            },
          }),
        ),
      ).toThrow("Native checkpoint and native resume ref");
      expect(parsed.execution.session.recoveryMessages).toEqual([]);
    },
  );

  test("assigns driver control ports inside the sandbox image contract", () => {
    const port = getDriverControlPort("driver-01KRZRFGXAA788FW1GDBT7F0EZ");

    expect(port).toBeGreaterThanOrEqual(DRIVER_CONTROL_PORT_MIN);
    expect(port).toBeLessThanOrEqual(DRIVER_CONTROL_PORT_MAX);
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
        envVars: { EXISTING_ENV: "kept" },
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
    expect(execution.profilePrompt).toContain("`outputs/`");
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
      modelId: "gpt-5.5",
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
          occurredAt: "1970-01-01T00:00:01.000Z",
        },
      ],
    });

    const projection = await projectRuntimeDriverEvents(
      { DB: new SqliteD1Database() } as ApiBindings,
      {
        assertCurrentConnection: () => undefined,
        currentLiveState: createInitialSessionLiveState({
          sessionId: API_DRIVER_BOUNDARY_IDS.session,
          title: null,
          viewerId: API_DRIVER_BOUNDARY_IDS.account,
        }),
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

  test("adds failed tool result delivery before terminal run update", async () => {
    const database = await createPublicHttpContractDatabase();
    const link = createRuntimeSessionLink();
    const baseLiveState = createInitialSessionLiveState({
      sessionId: API_DRIVER_BOUNDARY_IDS.session,
      title: null,
      viewerId: API_DRIVER_BOUNDARY_IDS.account,
    });
    const runFailed = createDriverEvent({
      kind: "run.failed",
      payload: {
        error: {
          code: "runtime.failed",
          message: "Runtime driver control socket is not connected.",
          retryable: false,
        },
        recoverable: false,
      },
      runId: API_DRIVER_BOUNDARY_IDS.sessionRun,
    });
    const batch = parseDriverEventBatchInput({
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: [
        {
          event: runFailed,
          eventId: "source-run-failed",
          occurredAt: "1970-01-01T00:00:01.000Z",
        },
      ],
    });

    const projection = await projectRuntimeDriverEvents({ DB: database } as ApiBindings, {
      assertCurrentConnection: () => undefined,
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
            segments: [
              {
                argsText: '{"cmd":"pwd"}',
                kind: "tool_use",
                path: null,
                tool: "Shell",
                toolCallId: "tool-1",
              },
            ],
          },
        ],
        run: {
          ...baseLiveState.run,
          id: API_DRIVER_BOUNDARY_IDS.sessionRun,
          status: "running",
        },
      },
      driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
      events: batch.events,
      link,
    });
    const canonicalFailureSourceId = `session-run-terminal:${API_DRIVER_BOUNDARY_IDS.sessionRun}:run.failed`;

    expect(projection.runtimeEvents).toMatchObject([{ sourceEventId: canonicalFailureSourceId }]);
    expect(projection.sessionDeliveryEvents.map((record) => record.sourceEventId)).toEqual([
      canonicalFailureSourceId,
      canonicalFailureSourceId,
      canonicalFailureSourceId,
    ]);
    expect(projection.sessionDeliveryEvents.map((record) => record.event.type)).toEqual([
      EventType.TOOL_CALL_RESULT,
      EventType.TOOL_CALL_END,
      EventType.CUSTOM,
    ]);
    expect(projection.sessionDeliveryEvents[0]?.event).toMatchObject({
      content:
        "Tool failed before returning a result: Runtime driver control socket is not connected.",
      toolCallId: "tool-1",
      type: EventType.TOOL_CALL_RESULT,
    });
    expect(projection.nextLiveState?.messages[0]?.segments.at(-1)).toEqual({
      kind: "tool_result",
      output:
        "Tool failed before returning a result: Runtime driver control socket is not connected.",
      tool: "Shell",
      toolCallId: "tool-1",
    });
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
