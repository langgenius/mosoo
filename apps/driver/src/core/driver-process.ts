import type { DriverCapability } from "@mosoo/contracts";
import { DRIVER_PROTOCOL_VERSION } from "@mosoo/driver-protocol";
import type { DriverBootPayload } from "@mosoo/driver-protocol";
import { parsePlatformId } from "@mosoo/id";
import type { SessionRunId } from "@mosoo/id";
import type { Logger } from "@mosoo/observability";

import { summarizeDriverBootPayload } from "../infrastructure/logging/driver-debug";
import {
  createDriverLogger,
  runWithDriverLogContext,
} from "../infrastructure/logging/driver-logger";
import { DriverInstanceSocket } from "../infrastructure/runtime/driver-instance-socket";
import type {
  AgentDriverBackend,
  AgentDriverBackendFactory,
  AgentDriverContext,
} from "../runtimes/agent-driver-backend";
import { DriverCommandDispatcher } from "./driver-command-dispatcher";
import { DriverHeartbeatLoop } from "./driver-heartbeat-loop";
import { DriverPermissionBroker } from "./driver-permission-broker";
import { DriverRuntimeStateMachine } from "./driver-runtime-state";
import {
  createDriverRuntimeTimingEvent,
  createDriverRuntimeTimingPhase,
  toDriverDurationMs,
} from "./driver-runtime-timing";

const DRIVER_VERSION = "0.1.0";
const BASE_DRIVER_CAPABILITIES = [
  { id: "custom_tool_execute", status: "unsupported", version: 1 },
  { id: "input_start", status: "supported", version: 1 },
  { id: "mcp_execute", status: "supported", version: 1 },
  { id: "native_resume", status: "supported", version: 1 },
  { id: "session_stop", status: "supported", version: 1 },
  { id: "thinking_stream", status: "supported", version: 1 },
  { id: "text_stream", status: "supported", version: 1 },
  { id: "tool_stream", status: "supported", version: 1 },
  { id: "turn_cancel", status: "supported", version: 1 },
  { id: "usage", status: "supported", version: 1 },
  { id: "visible_activity", status: "supported", version: 1 },
] as const satisfies readonly DriverCapability[];

function createDriverCapabilities(
  permissionBroker: DriverPermissionBroker,
): readonly DriverCapability[] {
  return [
    ...BASE_DRIVER_CAPABILITIES,
    {
      id: "permission_request",
      status: permissionBroker.capabilityStatus(),
      version: 1,
    },
  ];
}

function parseNullableSessionRunId(value: string | null): SessionRunId | null {
  return value === null ? null : (parsePlatformId(value, "Session run ID") as SessionRunId);
}

export class DriverProcess {
  readonly #startedAt = new Date().toISOString();
  readonly #backendFactory: AgentDriverBackendFactory;
  readonly #heartbeatLoop: DriverHeartbeatLoop;
  #backend: AgentDriverBackend | null = null;
  #logger: Logger | null = null;
  private readonly payload: DriverBootPayload;
  readonly #permissionBroker: DriverPermissionBroker;
  readonly #runtimeState = new DriverRuntimeStateMachine();
  #shutdownReason: string | null = null;
  #shuttingDown = false;

  constructor(payload: DriverBootPayload, backendFactory: AgentDriverBackendFactory) {
    this.#backendFactory = backendFactory;
    this.payload = payload;
    this.#permissionBroker = new DriverPermissionBroker(() => this.#logger);
    this.#heartbeatLoop = new DriverHeartbeatLoop({
      driverInstanceId: payload.driverInstanceId,
      isShuttingDown: () => this.#shuttingDown,
    });
  }

  async run(): Promise<void> {
    let socket!: DriverInstanceSocket;

    socket = new DriverInstanceSocket(this.payload, {
      onClose: (_code, reason) => {
        void this.shutdown(socket, reason || "runtime.socket.closed");
      },
    });

    this.registerSignals(socket);
    await socket.connect();
    const logger = createDriverLogger(this.payload, socket);
    this.#logger = logger;

    try {
      await runWithDriverLogContext(this.payload, async () => {
        logger.debug("driver.runtime.boot.loaded", summarizeDriverBootPayload(this.payload));
        logger.debug("driver.runtime.socket.connected", {
          driverInstanceId: this.payload.driverInstanceId,
          runtime: this.payload.runtime,
        });

        logger.debug("driver.runtime.hello.sending", {
          capabilities: [...createDriverCapabilities(this.#permissionBroker)],
          driverVersion: DRIVER_VERSION,
          protocolVersion: DRIVER_PROTOCOL_VERSION,
          startedAt: this.#startedAt,
        });

        const helloStartedAtMs = Date.now();
        const hello = await logger.span("runtime.socket.hello", async () =>
          socket.hello({
            capabilities: [...createDriverCapabilities(this.#permissionBroker)],
            driverVersion: DRIVER_VERSION,
            protocolVersion: DRIVER_PROTOCOL_VERSION,
            startedAt: this.#startedAt,
          }),
        );
        const sessionRunId = parseNullableSessionRunId(hello.sessionRunId);
        const helloDurationMs = toDriverDurationMs(helloStartedAtMs);

        logger.info("driver.runtime.hello.completed", {
          connectionId: hello.connectionId,
          sessionRunId,
        });
        logger.debug("driver.runtime.hello.received", {
          acceptedCapabilities: hello.acceptedCapabilities,
          connectionId: hello.connectionId,
          driverInstanceId: hello.driverInstanceId,
          heartbeatIntervalMs: hello.heartbeatIntervalMs,
          runConfig: hello.runConfig,
          sessionRunId,
        });

        const runtimeContext = this.createAgentDriverContext(socket, logger);

        const backendLoadStartedAtMs = Date.now();
        const backend = await logger.span("driver.backend.load", async () =>
          this.#backendFactory(this.payload),
        );
        this.#backend = backend;
        const backendLoadDurationMs = toDriverDurationMs(backendLoadStartedAtMs);
        const backendStartedAtMs = Date.now();
        await logger.span("driver.backend.start", async () => backend.start(runtimeContext));
        const backendDurationMs = toDriverDurationMs(backendStartedAtMs);
        await logger.span("runtime.socket.ready", async () =>
          socket.ready({ at: new Date().toISOString() }),
        );
        void this.emitDriverBackendTimingEvent(socket, logger, {
          backendDurationMs,
          backendLoadDurationMs,
          completedAtMs: Date.now(),
          helloDurationMs,
          sessionRunId,
          startedAtMs: helloStartedAtMs,
        });

        logger.info("driver.runtime.ready", {
          driverInstanceId: this.payload.driverInstanceId,
          runtime: this.payload.runtime,
        });

        this.#heartbeatLoop.start(socket, logger, hello.heartbeatIntervalMs);
        const commandDispatcher = new DriverCommandDispatcher({
          backend,
          driverInstanceId: this.payload.driverInstanceId,
          isShuttingDown: () => this.#shuttingDown,
          permissionRequests: this.#permissionBroker,
          runtimeContextFactory: (runtimeSocket, runtimeLogger) =>
            this.createAgentDriverContext(runtimeSocket, runtimeLogger),
          runtimeState: this.#runtimeState,
          sandboxId: this.payload.sandboxId,
          shutdown: async (runtimeSocket, reason) => this.shutdown(runtimeSocket, reason),
        });
        await commandDispatcher.run(socket, logger);
      });
    } catch (error) {
      await this.reportRunFailure(socket, error);
      throw error;
    } finally {
      await this.finalize(socket);
    }
  }

  private registerSignals(socket: DriverInstanceSocket): void {
    process.once("SIGINT", () => {
      void this.shutdown(socket, "signal.sigint");
    });

    process.once("SIGTERM", () => {
      void this.shutdown(socket, "signal.sigterm");
    });
  }

  private async shutdown(socket: DriverInstanceSocket, reason: string): Promise<void> {
    if (this.#shuttingDown) {
      return;
    }

    this.#shuttingDown = true;
    this.#shutdownReason = reason;
    this.#logger?.debug("driver.runtime.shutdown.requested", {
      driverInstanceId: this.payload.driverInstanceId,
      reason,
    });

    this.#heartbeatLoop.stop(this.#logger, reason);
    this.#permissionBroker.rejectAll();
    if (this.#runtimeState.status() !== "failed" && this.#runtimeState.status() !== "stopped") {
      this.#runtimeState.enter("stopped");
    }

    const logger = this.#logger;
    const backend = this.#backend;

    if (logger && backend) {
      await logger.span("driver.backend.stop", async () => {
        await backend.stop(this.createAgentDriverContext(socket, logger), reason);
      });
    }
  }

  private async emitDriverBackendTimingEvent(
    socket: DriverInstanceSocket,
    logger: Logger,
    input: {
      backendDurationMs: number;
      backendLoadDurationMs: number;
      completedAtMs: number;
      helloDurationMs: number;
      sessionRunId: SessionRunId | null;
      startedAtMs: number;
    },
  ): Promise<void> {
    try {
      await socket.pushEvents({
        events: [
          createDriverRuntimeTimingEvent({
            completedAtMs: input.completedAtMs,
            path: input.sessionRunId === null ? "prewarm" : "cold",
            phases: [
              createDriverRuntimeTimingPhase("hello", input.helloDurationMs),
              createDriverRuntimeTimingPhase("backend.load", input.backendLoadDurationMs),
              createDriverRuntimeTimingPhase("backend.start", input.backendDurationMs),
            ],
            runId: input.sessionRunId,
            sessionId: this.payload.execution.configRevision.sessionId,
            stage: "driver_backend",
            startedAtMs: input.startedAtMs,
          }),
        ],
      });
    } catch (error) {
      logger.error("driver.runtime.timing_event.failed", error, {
        driverInstanceId: this.payload.driverInstanceId,
      });
    }
  }

  private async reportRunFailure(socket: DriverInstanceSocket, error: unknown): Promise<void> {
    if (this.#shuttingDown || !this.#logger) {
      return;
    }

    const message = error instanceof Error ? error.message : "Driver runtime failed.";
    const code = "driver.runtime_failed";
    this.#shutdownReason = code;

    this.#logger.error("driver.runtime.failed", error, {
      driverInstanceId: this.payload.driverInstanceId,
    });

    try {
      await socket.failRun({
        code,
        details: {},
        message,
        retryable: false,
      });
    } catch (failureError) {
      this.#logger.error("driver.runtime.failure_report_failed", failureError, {
        driverInstanceId: this.payload.driverInstanceId,
      });
    }
  }

  private async finalize(socket: DriverInstanceSocket): Promise<void> {
    if (!this.#shuttingDown) {
      await this.shutdown(socket, this.#shutdownReason ?? "runtime.socket.closed");
    }

    if (this.#logger) {
      this.#logger.debug("driver.runtime.finalizing", {
        driverInstanceId: this.payload.driverInstanceId,
        shutdownReason: this.#shutdownReason ?? "runtime.socket.closed",
      });
      await this.#logger.flush();
      await this.#logger.destroy();
    }

    socket.close(1000, this.#shutdownReason ?? "runtime.socket.closed");
  }

  private createAgentDriverContext(
    socket: DriverInstanceSocket,
    logger: Logger,
  ): AgentDriverContext {
    return {
      logger,
      payload: this.payload,
      permissions: {
        request: async (input) => {
          this.#runtimeState.enter("needs_approval");

          try {
            return await this.#permissionBroker.request(socket, input);
          } finally {
            if (this.#runtimeState.status() === "needs_approval") {
              this.#runtimeState.enter("running");
            }
          }
        },
      },
      socket,
    };
  }
}
