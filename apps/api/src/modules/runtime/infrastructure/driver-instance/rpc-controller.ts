import type {
  DriverCommandUpdateInput,
  DriverCompletionInput,
  DriverEventBatchOutput,
  DriverExternalToolEffectClaimInput,
  DriverExternalToolEffectClaimOutput,
  DriverExternalToolEffectObserveInput,
  DriverExternalToolEffectSettleInput,
  DriverExternalToolEffectState,
  DriverFailureInput,
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverHelloOutput,
  DriverLogBatchInput,
  DriverLogBatchOutput,
  DriverNextCommandInput,
  DriverNextCommandOutput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";

import type { HostDriverEventBatchInput } from "./event-types";
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

  async enqueueCommand(driverGeneration: number, command: RuntimeCommand): Promise<void> {
    await this.#commands.enqueueCommand(driverGeneration, command);
  }

  async handleCommandUpdate(
    input: DriverCommandUpdateInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    return this.#commands.handleCommandUpdate(input, context);
  }

  async handleClaimExternalToolEffect(
    input: DriverExternalToolEffectClaimInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectClaimOutput> {
    return this.#commands.handleClaimExternalToolEffect(input, context);
  }

  async handleObserveExternalToolEffect(
    input: DriverExternalToolEffectObserveInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectState> {
    return this.#commands.handleObserveExternalToolEffect(input, context);
  }

  async handleCompleteRun(
    input: DriverCompletionInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    return this.#events.runAfterPendingEvents(() =>
      this.#terminal.handleCompleteRun(input, context),
    );
  }

  async handleFailRun(
    input: DriverFailureInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    return this.#events.runAfterPendingEvents(() => this.#terminal.handleFailRun(input, context));
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
    const result = await this.#handshake.handleHello(input, context);
    // Publish batches the driver flushed while hello was still in flight
    // without extending the hello round-trip that gates the driver's boot.
    void this.#events.publishPendingPreHelloLogs();
    return result;
  }

  async handleNextCommand(
    input: DriverNextCommandInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverNextCommandOutput> {
    return this.#commands.handleNextCommand(input, context);
  }

  async handlePushEvents(
    input: HostDriverEventBatchInput,
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

  async runAfterPendingEvents<T>(operation: () => Promise<T>): Promise<T> {
    return this.#events.runAfterPendingEvents(operation);
  }

  async handleSettleExternalToolEffect(
    input: DriverExternalToolEffectSettleInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectState> {
    return this.#commands.handleSettleExternalToolEffect(input, context);
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
