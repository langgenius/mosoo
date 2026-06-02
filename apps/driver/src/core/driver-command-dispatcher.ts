import type { RunError, RuntimeCommand, RuntimeCommandResult } from "@mosoo/contracts";
import { sleepPromise } from "@mosoo/effects";
import { parsePlatformId } from "@mosoo/id";
import type { SessionRunId } from "@mosoo/id";
import { createScopedWideEvent, emitWideEvent } from "@mosoo/observability";
import type { Logger } from "@mosoo/observability";

import {
  summarizeRuntimeCommand,
  summarizeRuntimeCommandResult,
} from "../infrastructure/logging/driver-debug";
import type { DriverInstanceSocket } from "../infrastructure/runtime/driver-instance-socket";
import type { AgentDriverBackend, AgentDriverContext } from "../runtimes/agent-driver-backend";
import { DriverActiveInputCancellation } from "./driver-active-input-cancellation";
import type { DriverPermissionBroker } from "./driver-permission-broker";
import type { DriverRuntimeStateMachine } from "./driver-runtime-state";
import { isDriverTurnCancelledError } from "./driver-runtime-state";

interface DriverCommandDispatcherOptions {
  backend: AgentDriverBackend;
  driverInstanceId: string;
  isShuttingDown(): boolean;
  permissionRequests: DriverPermissionBroker;
  runtimeContextFactory(socket: DriverInstanceSocket, logger: Logger): AgentDriverContext;
  runtimeState: DriverRuntimeStateMachine;
  sandboxId: string;
  shutdown(socket: DriverInstanceSocket, reason: string): Promise<void>;
}

const COMMAND_POLL_INTERVAL_MS = 250;
const ACTIVE_INPUT_SETTLE_GRACE_MS = 2_000;

function isCommandFailureFatal(command: RuntimeCommand): boolean {
  return command.kind === "input.start";
}

function toCommandFailure(command: RuntimeCommand, error: unknown): RunError {
  return {
    code: `driver.command_failed.${command.kind}`,
    details: {
      commandId: command.commandId,
      commandKind: command.kind,
    },
    message: error instanceof Error ? error.message : `Driver command ${command.kind} failed.`,
    retryable: false,
  };
}

function parseSessionRunId(value: string): SessionRunId {
  return parsePlatformId(value, "Session run ID") as SessionRunId;
}

async function sendCommandUpdate(
  runtimeContext: AgentDriverContext,
  command: RuntimeCommand,
  update: {
    error?: RunError;
    result?: RuntimeCommandResult;
    status: "accepted" | "cancelled" | "completed" | "failed";
  },
): Promise<void> {
  await runtimeContext.socket.commandUpdate({
    commandId: command.commandId,
    ...(update.error ? { error: update.error } : {}),
    ...(update.result ? { result: update.result } : {}),
    status: update.status,
  });

  runtimeContext.logger.debug("driver.runtime.command.status.sent", {
    command: summarizeRuntimeCommand(command),
    ...(update.error ? { error: update.error } : {}),
    result: update.result ? summarizeRuntimeCommandResult(update.result) : null,
    status: update.status,
  });
}

async function waitForActiveInputSettle(activeRunTask: Promise<void>): Promise<void> {
  await Promise.race([
    activeRunTask,
    sleepPromise(ACTIVE_INPUT_SETTLE_GRACE_MS).then(() => {
      throw new Error(
        `Previous driver run input did not settle within ${ACTIVE_INPUT_SETTLE_GRACE_MS}ms.`,
      );
    }),
  ]);
}

export class DriverCommandDispatcher {
  readonly #backend: AgentDriverBackend;
  readonly #driverInstanceId: string;
  readonly #isShuttingDown: () => boolean;
  readonly #permissionRequests: DriverPermissionBroker;
  readonly #runtimeContextFactory: (
    socket: DriverInstanceSocket,
    logger: Logger,
  ) => AgentDriverContext;
  readonly #runtimeState: DriverRuntimeStateMachine;
  readonly #sandboxId: string;
  readonly #shutdown: (socket: DriverInstanceSocket, reason: string) => Promise<void>;
  #activeInputCancellation: DriverActiveInputCancellation | null = null;
  #activeRunGeneration = 0;
  #activeRunTask: Promise<void> | null = null;

  constructor(options: DriverCommandDispatcherOptions) {
    this.#backend = options.backend;
    this.#driverInstanceId = options.driverInstanceId;
    this.#isShuttingDown = () => options.isShuttingDown();
    this.#permissionRequests = options.permissionRequests;
    this.#runtimeContextFactory = (socket, logger) => options.runtimeContextFactory(socket, logger);
    this.#runtimeState = options.runtimeState;
    this.#sandboxId = options.sandboxId;
    this.#shutdown = options.shutdown;
  }

  async run(socket: DriverInstanceSocket, logger: Logger): Promise<void> {
    const runtimeContext = this.#runtimeContextFactory(socket, logger);

    logger.debug("driver.runtime.command.poll.started", {
      driverInstanceId: this.#driverInstanceId,
      intervalMs: COMMAND_POLL_INTERVAL_MS,
    });

    const commandLoopEvent = createScopedWideEvent({
      fields: {
        runtime: {
          driver_instance_id: this.#driverInstanceId,
          sandbox_id: this.#sandboxId,
        },
      },
      type: "driver.command-loop",
    });

    try {
      await logger.span("driver.command-loop", async () => {
        while (!this.#isShuttingDown()) {
          const command = await socket.nextCommand();

          if (command === null) {
            if (this.#isShuttingDown()) {
              return;
            }

            await sleepPromise(COMMAND_POLL_INTERVAL_MS);
            continue;
          }

          await this.#handleCommand(runtimeContext, command);

          if (this.#isShuttingDown()) {
            return;
          }
        }
      });
      emitWideEvent(logger, commandLoopEvent, {
        status: "success",
      });
    } catch (error) {
      commandLoopEvent.setError(error, {
        driverInstanceId: this.#driverInstanceId,
      });
      emitWideEvent(logger, commandLoopEvent, {
        ...(error instanceof Error ? { error } : {}),
        status: "error",
      });
      logger.error("driver.runtime.command-loop-failed", error, {
        driverInstanceId: this.#driverInstanceId,
      });

      try {
        logger.debug("driver.runtime.run.failing", {
          code: "driver.command_loop_failed",
          driverInstanceId: this.#driverInstanceId,
        });
        await socket.failRun({
          code: "driver.command_loop_failed",
          details: {},
          message: error instanceof Error ? error.message : "Command loop failed.",
          retryable: false,
        });
        logger.debug("driver.runtime.run.failed", {
          code: "driver.command_loop_failed",
          driverInstanceId: this.#driverInstanceId,
        });
      } catch {
        /* Ignore runtime error propagation failures */
      }

      throw error;
    }
  }

  async #handleCommand(runtimeContext: AgentDriverContext, command: RuntimeCommand): Promise<void> {
    const commandSummary = summarizeRuntimeCommand(command);
    runtimeContext.logger.debug("driver.runtime.command.received", commandSummary);
    await sendCommandUpdate(runtimeContext, command, {
      status: "accepted",
    });

    try {
      if (command.kind === "permission.resolve") {
        this.#permissionRequests.resolve(command.requestId, command.decision);
        await sendCommandUpdate(runtimeContext, command, {
          status: "completed",
        });
        return;
      }

      if (command.kind === "access.refresh") {
        await this.#backend.refreshOrganizationAccess(
          runtimeContext,
          command.organizationAccessSnapshot,
        );
        await sendCommandUpdate(runtimeContext, command, {
          result: {
            entryCount: command.organizationAccessSnapshot.entries.length,
          },
          status: "completed",
        });
        return;
      }

      if (command.kind === "input.start") {
        if (this.#activeRunTask) {
          await waitForActiveInputSettle(this.#activeRunTask);
        }
        if (this.#activeRunTask) {
          throw new Error("Driver run input is already in progress.");
        }
        if (this.#runtimeState.status() !== "ready") {
          throw new Error(`Driver is not ready for input: ${this.#runtimeState.status()}.`);
        }

        this.#runtimeState.enter("running");
        this.#activeRunGeneration += 1;
        const cancellation = new DriverActiveInputCancellation();
        const runId = parseSessionRunId(command.runId);
        this.#activeInputCancellation = cancellation;
        runtimeContext.socket.beginRun(runId);
        const activeRunTask = this.#runInputCommandAndClear(
          runtimeContext,
          command,
          cancellation,
          this.#activeRunGeneration,
          runId,
        );
        this.#activeRunTask = activeRunTask;
        return;
      }

      if (command.kind === "mcp.execute") {
        const result = await this.#backend.handleMcpExecute(runtimeContext, command);
        await sendCommandUpdate(runtimeContext, command, {
          result,
          status: "completed",
        });
        return;
      }

      if (command.kind === "turn.cancel") {
        const reason = command.reason ?? "turn.cancelled";
        this.#permissionRequests.rejectAll();
        this.#activeInputCancellation?.cancel(reason);
        await this.#backend.cancelActiveTurn(runtimeContext, reason);
        await sendCommandUpdate(runtimeContext, command, {
          status: "completed",
        });
        return;
      }

      if (command.kind === "session.stop") {
        this.#permissionRequests.rejectAll();
        if (this.#runtimeState.status() !== "failed" && this.#runtimeState.status() !== "stopped") {
          this.#runtimeState.enter("stopped");
        }
        await sendCommandUpdate(runtimeContext, command, {
          status: "completed",
        });
        runtimeContext.logger.debug("driver.runtime.run.completing", {
          commandId: command.commandId,
          reason: command.reason,
        });
        await runtimeContext.socket.completeRun();
        runtimeContext.logger.debug("driver.runtime.run.completed", {
          commandId: command.commandId,
          reason: command.reason,
        });
        await this.#shutdown(runtimeContext.socket, command.reason);
        return;
      }
    } catch (error) {
      const commandFailure = toCommandFailure(command, error);

      await sendCommandUpdate(runtimeContext, command, {
        error: commandFailure,
        status: "failed",
      });
      runtimeContext.logger.error("driver.runtime.command.failed", error, {
        commandId: command.commandId,
        commandKind: command.kind,
        driverInstanceId: this.#driverInstanceId,
        fatal: isCommandFailureFatal(command),
      });

      if (isCommandFailureFatal(command)) {
        throw error;
      }
    }
  }

  async #runInputCommand(
    runtimeContext: AgentDriverContext,
    command: Extract<RuntimeCommand, { kind: "input.start" }>,
    cancellation: DriverActiveInputCancellation,
    runId: SessionRunId,
  ): Promise<void> {
    try {
      cancellation.throwIfCancelled();

      if (command.organizationAccessSnapshot) {
        await this.#backend.refreshOrganizationAccess(
          runtimeContext,
          command.organizationAccessSnapshot,
        );
      }

      cancellation.throwIfCancelled();
      await this.#backend.handleInput(runtimeContext, command.input, runId);
      cancellation.throwIfCancelled();
      await sendCommandUpdate(runtimeContext, command, {
        result: {
          requestId: command.requestId,
        },
        status: "completed",
      });
      if (this.#runtimeState.status() === "running") {
        this.#runtimeState.enter("ready");
      }
    } catch (error) {
      if (isDriverTurnCancelledError(error)) {
        await sendCommandUpdate(runtimeContext, command, {
          status: "cancelled",
        });
        runtimeContext.logger.info("driver.runtime.input.cancelled", {
          commandId: command.commandId,
          commandKind: command.kind,
          driverInstanceId: this.#driverInstanceId,
        });

        if (this.#runtimeState.status() === "running") {
          this.#runtimeState.enter("ready");
        }
        return;
      }

      const commandFailure = toCommandFailure(command, error);

      this.#runtimeState.enter("failed");
      await sendCommandUpdate(runtimeContext, command, {
        error: commandFailure,
        status: "failed",
      });
      runtimeContext.logger.error("driver.runtime.command.failed", error, {
        commandId: command.commandId,
        commandKind: command.kind,
        driverInstanceId: this.#driverInstanceId,
        fatal: true,
      });

      try {
        runtimeContext.logger.debug("driver.runtime.run.failing", {
          code: commandFailure.code,
          driverInstanceId: this.#driverInstanceId,
        });
        await runtimeContext.socket.failRun(commandFailure);
        runtimeContext.logger.debug("driver.runtime.run.failed", {
          code: commandFailure.code,
          driverInstanceId: this.#driverInstanceId,
        });
      } catch {
        /* Ignore runtime error propagation failures */
      }

      await this.#shutdown(runtimeContext.socket, commandFailure.code);
    }
  }

  async #runInputCommandAndClear(
    runtimeContext: AgentDriverContext,
    command: Extract<RuntimeCommand, { kind: "input.start" }>,
    cancellation: DriverActiveInputCancellation,
    generation: number,
    runId: SessionRunId,
  ): Promise<void> {
    try {
      await this.#runInputCommand(runtimeContext, command, cancellation, runId);
    } finally {
      runtimeContext.socket.endRun(runId);
      if (this.#activeRunGeneration === generation) {
        this.#activeRunTask = null;
        this.#activeInputCancellation = null;
      }
    }
  }
}
