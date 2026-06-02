import type { McpExecuteCommand, RuntimeCommandInput } from "@mosoo/contracts";
import type {
  DriverBootPayload,
  DriverOrganizationAccessSnapshotOutput,
  DriverRuntime,
} from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";

import { DriverTurnCancelledError } from "../../core/driver-runtime-state";
import {
  createDriverRuntimeTimingEvent,
  createDriverRuntimeTimingPhase,
  toDriverDurationMs,
} from "../../core/driver-runtime-timing";
import {
  summarizeOrganizationAccessSnapshot,
  summarizePath,
  summarizeRuntimeCommandInput,
} from "../../infrastructure/logging/driver-debug";
import type { AgentDriverBackend, AgentDriverContext } from "../agent-driver-backend";
import { DriverEventPublisher } from "../driver-event-publisher";
import { executeRemoteHttpMcpCommand } from "../mcp/remote-http-mcp-executor";
import {
  buildNativeRuntimeSystemPrompt,
  computeRuntimeBootstrapDigest,
  writeSkillBootstrapArtifacts,
} from "../skill-bootstrap";
import { materializeResolvedSkills } from "../skill-materialization";
import type { MaterializedSkill } from "../skill-materialization";
import { OpenAiAppServerClient } from "./app-server-client";
import { MOSOO_OPENAI_RUNTIME_SANDBOX_MODE } from "./app-server-env";
import { OpenAiAppServerEventBridge } from "./app-server-event-bridge";
import type {
  ThreadResumeParams,
  ThreadStartParams,
  TurnStatus,
  TurnStartResponse,
} from "./generated/app-server-protocol";

function readOpenAiNativeResumeThreadId(payload: DriverBootPayload): string | null {
  const { nativeResumeRef } = payload.execution.session;

  if (nativeResumeRef === null) {
    return null;
  }

  if (
    nativeResumeRef.runtimeId !== "openai-runtime" ||
    nativeResumeRef.kind !== "openai_thread_id"
  ) {
    throw new Error("OpenAI runtime received an incompatible native resume ref.");
  }

  if (nativeResumeRef.value.length === 0) {
    throw new Error("OpenAI runtime received an empty native resume thread id.");
  }

  return nativeResumeRef.value;
}

function isTerminalOpenAiTurnStatus(status: TurnStatus | undefined): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}

async function interruptOpenAiTurn(input: {
  client: OpenAiAppServerClient;
  context: AgentDriverContext;
  reason: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  try {
    await input.client.request("turn/interrupt", {
      threadId: input.threadId,
      turnId: input.turnId,
    });
  } catch (error) {
    input.context.logger.debug("driver.openai.turn.interrupt.failed", {
      message: error instanceof Error ? error.message : "interrupt failed",
      reason: input.reason,
      turnId: input.turnId,
    });
  }
}

export class OpenAiAppServerDriverBackend implements AgentDriverBackend {
  readonly runtime: DriverRuntime = "openai-runtime";
  readonly #payload: DriverBootPayload;
  readonly #runtimeBootstrapDigest: string | null;
  readonly #eventPublisher = new DriverEventPublisher(this.runtime, () => this.#threadId);
  #client: OpenAiAppServerClient | null = null;
  #materializedSkills: MaterializedSkill[] = [];
  #pendingTurnStartCancellationReason: string | null = null;
  #threadId: string | null = null;
  #turnStartInFlight = false;
  readonly #events = new OpenAiAppServerEventBridge({
    push: async (context, reason, events) => this.#eventPublisher.push(context, reason, events),
    requireThreadId: () => this.#requireThreadId(),
  });

  constructor(payload: DriverBootPayload) {
    this.#payload = payload;
    this.#runtimeBootstrapDigest = computeRuntimeBootstrapDigest(payload.execution);
  }

  async start(context: AgentDriverContext): Promise<void> {
    const startupStartedAtMs = Date.now();
    const startupPhases: ReturnType<typeof createDriverRuntimeTimingPhase>[] = [];
    const measureStartupPhase = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
      const startedAtMs = Date.now();

      try {
        return await task();
      } finally {
        startupPhases.push(createDriverRuntimeTimingPhase(name, toDriverDurationMs(startedAtMs)));
      }
    };

    const client = new OpenAiAppServerClient(this.#payload, {
      ...context,
      handleNotification: async (method, params) =>
        this.#events.handleNotification(context, method, params),
      handleProtocolError: async (error) => {
        this.#events.rejectActiveTurns(error);
      },
    });
    this.#client = client;
    const clientStartPromise = (async () => {
      const startedAtMs = Date.now();
      const result = await client.start();
      startupPhases.push(
        createDriverRuntimeTimingPhase("app_server.start", toDriverDurationMs(startedAtMs)),
        ...result.phases.map((phase) =>
          createDriverRuntimeTimingPhase(phase.name, phase.durationMs),
        ),
      );
    })();
    const skillBootstrapPromise = (async () => {
      this.#materializedSkills = await measureStartupPhase("skills.materialize", () =>
        materializeResolvedSkills(this.#payload.execution, context.logger),
      );
      return measureStartupPhase("skills.bootstrap", () =>
        writeSkillBootstrapArtifacts(this.#payload.execution),
      );
    })();
    let bootstrapArtifacts: Awaited<typeof skillBootstrapPromise>;

    try {
      [, bootstrapArtifacts] = await Promise.all([clientStartPromise, skillBootstrapPromise]);
    } catch (error) {
      client.stop();
      throw error;
    }

    const developerInstructions = buildNativeRuntimeSystemPrompt(this.#payload.execution);
    const nativeResumeThreadId = readOpenAiNativeResumeThreadId(this.#payload);
    const baseThreadParams = {
      approvalPolicy: "on-request",
      cwd: this.#payload.execution.session.cwd,
      model: this.#payload.execution.model,
      modelProvider: this.#payload.execution.provider,
      sandbox: MOSOO_OPENAI_RUNTIME_SANDBOX_MODE,
    } satisfies ThreadStartParams;

    const threadResult = await measureStartupPhase(
      nativeResumeThreadId === null ? "thread.start" : "thread.resume",
      () =>
        nativeResumeThreadId === null
          ? client.request("thread/start", {
              ...baseThreadParams,
              ...(developerInstructions === null ? {} : { developerInstructions }),
              sessionStartSource: "startup",
            })
          : client.request("thread/resume", {
              ...baseThreadParams,
              ...(developerInstructions === null ? {} : { developerInstructions }),
              threadId: nativeResumeThreadId,
            } satisfies ThreadResumeParams),
    );
    this.#threadId = threadResult.thread.id;
    await measureStartupPhase("native_resume.publish", () =>
      this.#events.publishNativeResumeRef(context),
    );
    void this.#emitStartupTimingEvent(context, startupStartedAtMs, startupPhases);

    context.logger.info("driver.openai.runtime.started", {
      bootstrapArtifacts,
      bootstrapDigest: this.#runtimeBootstrapDigest,
      execution: {
        cwd: summarizePath(this.#payload.execution.session.cwd),
        homePath: summarizePath(this.#payload.execution.session.context.homePath),
        sessionOrganizationPath: summarizePath(
          this.#payload.execution.session.context.sessionOrganizationPath,
        ),
        spaceAliasCount: this.#payload.execution.session.context.spaceAliases.length,
      },
      nativeResumeRefPresent: Boolean(nativeResumeThreadId),
      skillCount: this.#materializedSkills.length,
      threadIdPresent: Boolean(this.#threadId),
    });
  }

  async #emitStartupTimingEvent(
    context: AgentDriverContext,
    startedAtMs: number,
    phases: readonly ReturnType<typeof createDriverRuntimeTimingPhase>[],
  ): Promise<void> {
    try {
      await context.socket.pushEvents({
        events: [
          createDriverRuntimeTimingEvent({
            path: this.#payload.execution.configRevision.runId === null ? "prewarm" : "cold",
            phases,
            runId: this.#payload.execution.configRevision.runId,
            sessionId: this.#payload.execution.configRevision.sessionId,
            stage: "driver_backend",
            startedAtMs,
          }),
        ],
      });
    } catch (error) {
      context.logger.error("driver.openai.startup_timing.failed", error, {
        driverInstanceId: this.#payload.driverInstanceId,
      });
    }
  }

  async handleInput(
    context: AgentDriverContext,
    input: RuntimeCommandInput,
    runId: SessionRunId,
  ): Promise<void> {
    const client = this.#requireClient();
    const threadId = this.#requireThreadId();
    this.#events.resetRuntimeError();
    await this.#events.publishNativeResumeRef(context);

    context.logger.info("driver.openai.prompt.sending", {
      textLength: input.text.length,
      threadIdPresent: true,
    });
    context.logger.debug("driver.openai.prompt.requested", {
      input: summarizeRuntimeCommandInput(input),
      threadIdPresent: true,
    });

    this.#turnStartInFlight = true;
    this.#pendingTurnStartCancellationReason = null;

    let turnResult: TurnStartResponse;
    const turnStartRequestedAtMs = Date.now();

    try {
      turnResult = await client.request("turn/start", {
        cwd: this.#payload.execution.session.cwd,
        input: [
          {
            text: input.text,
            type: "text",
            text_elements: [],
          },
        ],
        threadId,
      });
    } catch (error) {
      const pendingCancellationReason = this.#pendingTurnStartCancellationReason;
      this.#pendingTurnStartCancellationReason = null;

      if (pendingCancellationReason !== null) {
        throw new DriverTurnCancelledError(pendingCancellationReason);
      }

      throw error;
    } finally {
      this.#turnStartInFlight = false;
    }

    const turnId = turnResult.turn.id;
    const turnStartedAtMs = Date.now();

    await this.#eventPublisher.push(context, "driver.openai.provider.turn_start", [
      createDriverRuntimeTimingEvent({
        completedAtMs: turnStartedAtMs,
        path: "unknown",
        phases: [
          createDriverRuntimeTimingPhase(
            "provider.turn_start",
            toDriverDurationMs(turnStartRequestedAtMs, turnStartedAtMs),
          ),
        ],
        runId,
        sessionId: context.payload.execution.configRevision.sessionId,
        sourceEventId: `openai.provider.turn_start:${turnId}`,
        stage: "driver_turn",
        startedAtMs: turnStartRequestedAtMs,
        native: {
          eventName: "provider.turn_start",
          provider: "openai",
          turnId,
        },
      }),
    ]);
    const pendingCancellationReason = this.#pendingTurnStartCancellationReason;
    this.#pendingTurnStartCancellationReason = null;

    if (pendingCancellationReason !== null) {
      this.#events.markTurnCancelled(turnId, pendingCancellationReason);
      void interruptOpenAiTurn({
        client,
        context,
        reason: pendingCancellationReason,
        threadId,
        turnId,
      });
      throw new DriverTurnCancelledError(pendingCancellationReason);
    }

    const completion = this.#events.trackTurn(turnId, runId);

    if (isTerminalOpenAiTurnStatus(turnResult.turn.status)) {
      await this.#events.handleNotification(context, "turn/completed", {
        threadId,
        turn: turnResult.turn,
      });
    }

    await this.#events.publishRunStarted(context, { runId, turnId });
    await completion;
  }

  async cancelActiveTurn(context: AgentDriverContext, reason: string): Promise<void> {
    const client = this.#client;
    const threadId = this.#threadId;

    if (client === null || threadId === null) {
      return;
    }

    if (this.#turnStartInFlight) {
      this.#pendingTurnStartCancellationReason = reason;
    }

    for (const turnId of this.#events.activeTurnIds()) {
      this.#events.markTurnCancelled(turnId, reason);
      this.#events.rejectTurn(turnId, new DriverTurnCancelledError(reason));
      void interruptOpenAiTurn({ client, context, reason, threadId, turnId });
    }
  }

  async handleMcpExecute(
    context: AgentDriverContext,
    command: McpExecuteCommand,
  ): Promise<{ outputText: string; requestId: string; serverId: string; toolName: string }> {
    context.logger.info("driver.openai.mcp.execute.started", {
      serverId: command.serverId,
      toolName: command.toolName,
    });

    const result = await executeRemoteHttpMcpCommand(this.#payload, command);

    context.logger.info("driver.openai.mcp.execute.completed", {
      outputLength: result.outputText.length,
      serverId: command.serverId,
      toolName: command.toolName,
    });

    return result;
  }

  async refreshOrganizationAccess(
    context: AgentDriverContext,
    snapshot: DriverOrganizationAccessSnapshotOutput,
  ): Promise<void> {
    context.logger.debug("driver.openai.organization-access.refreshed", {
      organizationAccessSnapshot: summarizeOrganizationAccessSnapshot(snapshot),
      threadIdPresent: Boolean(this.#threadId),
    });
  }

  async stop(context: AgentDriverContext, reason: string): Promise<void> {
    const client = this.#client;

    await this.cancelActiveTurn(context, reason);
    this.#events.clearActiveTurns();
    client?.stop();
    this.#client = null;
  }

  #requireClient(): OpenAiAppServerClient {
    if (this.#client === null) {
      throw new Error("OpenAI runtime app-server is not initialized.");
    }

    return this.#client;
  }

  #requireThreadId(): string {
    if (this.#threadId === null) {
      throw new Error("OpenAI runtime app-server thread is not initialized.");
    }

    return this.#threadId;
  }
}
