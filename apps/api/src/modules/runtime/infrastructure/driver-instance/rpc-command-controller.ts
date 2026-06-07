import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId } from "@mosoo/id";
import type {
  DriverCommandUpdateInput,
  DriverNextCommandInput,
  DriverNextCommandOutput,
} from "agent-driver/orpc";

import {
  claimNextQueuedRuntimeCommandRecord,
  createRuntimeCommandRecord,
  getRuntimeCommandRecord,
  markRuntimeCommandRecordDelivered,
  updateRuntimeCommandRecord,
} from "../session-runs/runtime-command-store.repository";
import {
  COMMAND_LEASE_MS,
  enqueueRuntimeCommand,
  nextRuntimeCommand,
  removeRuntimeCommandFromQueue,
  watchRuntimeCommands,
} from "./commands";
import { currentTimestampPlus } from "./driver-instance-support";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";
import { releaseLinkedTerminalDriverInstanceSessionRun } from "./terminal-run-release";

export class DriverInstanceRpcCommandController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;

  constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#dependencies = dependencies;
  }

  async enqueueCommand(command: RuntimeCommand): Promise<void> {
    const { env, state } = this.#dependencies;

    await createRuntimeCommandRecord(env.DB, {
      command,
      driverInstanceId: state.requireDriverInstanceId(),
      expiresAt: currentTimestampPlus(COMMAND_LEASE_MS),
    });
    await enqueueRuntimeCommand(state.commandState(), command, {
      onClosed: () =>
        new Error(`Driver instance ${state.requireDriverInstanceId()} is already closed.`),
      persistCommandQueue: async () => state.persistCommandQueue(),
    });
  }

  async handleCommandUpdate(
    input: DriverCommandUpdateInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    const { env, state } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }
    const driverInstanceId = state.requireDriverInstanceId();
    context.assertActiveConnection();

    const commandId = parsePlatformId<DriverCommandId>(input.commandId, "driver command id");
    const command = await getRuntimeCommandRecord(env.DB, driverInstanceId, commandId);
    context.assertActiveConnection();

    const updateOutcome = await updateRuntimeCommandRecord(env.DB, {
      commandId,
      deliveryConnectionId: context.connectionId,
      driverInstanceId,
      ...(input.error === undefined ? {} : { error: input.error }),
      status: input.status,
      ...(input.result === undefined ? {} : { result: input.result }),
    });
    context.assertActiveConnection();

    if (updateOutcome.kind === "rejected") {
      throw new Error(`Runtime command status update rejected: ${updateOutcome.reason}.`);
    }

    if (
      command?.payload.kind === "input.start" &&
      (input.status === "completed" ||
        input.status === "failed" ||
        input.status === "cancelled" ||
        input.status === "expired")
    ) {
      await releaseLinkedTerminalDriverInstanceSessionRun(env, driverInstanceId);
    }

    return { ok: true };
  }

  async handleNextCommand(
    input: DriverNextCommandInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverNextCommandOutput> {
    const { env, state } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }
    const driverInstanceId = state.requireDriverInstanceId();

    if (state.commandState().terminalized) {
      return { command: null };
    }
    context.assertActiveConnection();

    const record = await claimNextQueuedRuntimeCommandRecord(
      env.DB,
      driverInstanceId,
      context.connectionId,
    );

    if (record === null) {
      return { command: null };
    }
    context.assertActiveConnection();

    await removeRuntimeCommandFromQueue(state.commandState(), record.id, {
      persistCommandQueue: async () => state.persistCommandQueue(),
    });

    return { command: record.payload };
  }

  async *watchCommands(context: DriverInstanceRpcOperationContext): AsyncIterable<RuntimeCommand> {
    const { state } = this.#dependencies;

    context.assertActiveConnection();
    yield* watchRuntimeCommands(state.commandState(), async () => this.#nextCommand(context));
  }

  async #markCommandDelivered(
    command: RuntimeCommand,
    context: DriverInstanceRpcOperationContext,
  ): Promise<boolean> {
    const { env, state } = this.#dependencies;

    context.assertActiveConnection();
    const commandId = parsePlatformId<DriverCommandId>(command.commandId, "runtime command id");
    const deliveryOutcome = await markRuntimeCommandRecordDelivered(env.DB, {
      commandId,
      connectionId: context.connectionId,
      driverInstanceId: state.requireDriverInstanceId(),
    });
    context.assertActiveConnection();

    return deliveryOutcome.kind === "applied";
  }

  async #nextCommand(context: DriverInstanceRpcOperationContext): Promise<RuntimeCommand | null> {
    const { state } = this.#dependencies;

    return nextRuntimeCommand(state.commandState(), {
      assertActiveConnection: () => context.assertActiveConnection(),
      connectionId: context.connectionId,
      markCommandDelivered: async (command) => this.#markCommandDelivered(command, context),
      persistCommandQueue: async () => state.persistCommandQueue(),
    });
  }
}
