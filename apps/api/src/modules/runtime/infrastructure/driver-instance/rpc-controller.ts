import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type {
  DriverCommandUpdateInput,
  DriverCompletionInput,
  DriverEventBatchInput,
  DriverEventBatchOutput,
  DriverFailureInput,
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverHelloOutput,
  DriverLogBatchInput,
  DriverLogBatchOutput,
  DriverNextCommandInput,
  DriverNextCommandOutput,
  DriverReadyInput,
} from "agent-driver/orpc";

import type { DriverInstanceRpcHandler, DriverInstanceRpcOperationContext } from "./rpc";
import { DriverInstanceRpcCommandController } from "./rpc-command-controller";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";
import { DriverInstanceRpcEventIngestionController } from "./rpc-event-ingestion-controller";
import { DriverInstanceRpcHandshakeController } from "./rpc-handshake-controller";
import { DriverInstanceRpcRunTerminalController } from "./rpc-run-terminal-controller";

export class DriverInstanceRpcController implements DriverInstanceRpcHandler {
  readonly #commands: DriverInstanceRpcCommandController;
  readonly #events: DriverInstanceRpcEventIngestionController;
  readonly #handshake: DriverInstanceRpcHandshakeController;
  readonly #terminal: DriverInstanceRpcRunTerminalController;

  constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#commands = new DriverInstanceRpcCommandController(dependencies);
    this.#events = new DriverInstanceRpcEventIngestionController(dependencies);
    this.#handshake = new DriverInstanceRpcHandshakeController(dependencies);
    this.#terminal = new DriverInstanceRpcRunTerminalController(dependencies);
  }

  async enqueueCommand(command: RuntimeCommand): Promise<void> {
    await this.#commands.enqueueCommand(command);
  }

  async handleCommandUpdate(
    input: DriverCommandUpdateInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    return this.#commands.handleCommandUpdate(input, context);
  }

  async handleCompleteRun(
    input: DriverCompletionInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    return this.#terminal.handleCompleteRun(input, context);
  }

  async handleFailRun(
    input: DriverFailureInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    return this.#terminal.handleFailRun(input, context);
  }

  async handleHeartbeat(
    input: DriverHeartbeatInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ heartbeatCount: number; ok: true }> {
    return this.#handshake.handleHeartbeat(input, context);
  }

  async handleHello(
    input: DriverHelloInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverHelloOutput> {
    return this.#handshake.handleHello(input, context);
  }

  async handleNextCommand(
    input: DriverNextCommandInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverNextCommandOutput> {
    return this.#commands.handleNextCommand(input, context);
  }

  async handlePushEvents(
    input: DriverEventBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverEventBatchOutput> {
    return this.#events.handlePushEvents(input, context);
  }

  async handlePushLogs(
    input: DriverLogBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverLogBatchOutput> {
    return this.#events.handlePushLogs(input, context);
  }

  async handleReady(
    input: DriverReadyInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    return this.#handshake.handleReady(input, context);
  }

  async *watchCommands(context: DriverInstanceRpcOperationContext): AsyncIterable<RuntimeCommand> {
    yield* this.#commands.watchCommands(context);
  }
}
