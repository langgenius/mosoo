import type {
  DriverCommandUpdateInput,
  DriverExternalToolEffectClaimInput,
  DriverExternalToolEffectClaimOutput,
  DriverExternalToolEffectObserveInput,
  DriverExternalToolEffectSettleInput,
  DriverExternalToolEffectState,
  DriverNextCommandInput,
  DriverNextCommandOutput,
} from "@mosoo/agent-driver/orpc";
import { ExternalToolEffectSettlement } from "@mosoo/contracts/external-tool-effect";
import { RuntimeCommandResult } from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, ExternalToolEffectId } from "@mosoo/id";

import {
  claimExternalToolEffect,
  observeExternalToolEffect,
  settleExternalToolEffect,
} from "../session-runs/external-tool-effect-store.repository";
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

function toStoredRuntimeCommandResult(
  result: NonNullable<
    Extract<DriverCommandUpdateInput, { readonly status: "completed" }>["result"]
  >,
): RuntimeCommandResult {
  return parseSchemaValue(RuntimeCommandResult, result);
}

export class DriverInstanceRpcCommandController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;

  constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#dependencies = dependencies;
  }

  async enqueueCommand(driverGeneration: number, command: RuntimeCommand): Promise<void> {
    const { env, state } = this.#dependencies;

    if (state.requireDriverGeneration() !== driverGeneration) {
      throw new Error("Driver generation is no longer current.");
    }

    await createRuntimeCommandRecord(env.DB, {
      command,
      driverGeneration,
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
    const driverGeneration = state.requireDriverGeneration();
    context.assertActiveConnection();

    const commandId = parsePlatformId<DriverCommandId>(input.commandId, "driver command id");
    const command = await getRuntimeCommandRecord(
      env.DB,
      driverInstanceId,
      driverGeneration,
      commandId,
    );
    context.assertActiveConnection();

    const terminalPayload =
      input.status === "failed"
        ? { error: input.error }
        : input.status === "completed" && input.result !== undefined
          ? { result: toStoredRuntimeCommandResult(input.result) }
          : {};
    const updateOutcome = await updateRuntimeCommandRecord(env.DB, {
      commandId,
      deliveryConnectionId: context.connectionId,
      driverGeneration,
      driverInstanceId,
      ...terminalPayload,
      status: input.status,
    });
    context.assertActiveConnection();

    if (updateOutcome.kind === "rejected") {
      throw new Error(`Runtime command status update rejected: ${updateOutcome.reason}.`);
    }

    if (command?.payload.kind === "input.start" && input.status !== "accepted") {
      await releaseLinkedTerminalDriverInstanceSessionRun(env, driverInstanceId, driverGeneration);
      context.assertActiveConnection();
    }

    return { ok: true };
  }

  async handleClaimExternalToolEffect(
    input: DriverExternalToolEffectClaimInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectClaimOutput> {
    const { env, state } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }
    context.assertActiveConnection();

    const claim = await claimExternalToolEffect(env.DB, {
      claimToken: input.claimToken,
      commandId: parsePlatformId<DriverCommandId>(input.commandId, "driver command id"),
      driverGeneration: state.requireDriverGeneration(),
      driverInstanceId: state.requireDriverInstanceId(),
    });
    context.assertActiveConnection();
    return claim;
  }

  async handleObserveExternalToolEffect(
    input: DriverExternalToolEffectObserveInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectState> {
    const { env, state } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }
    context.assertActiveConnection();

    const observation = await observeExternalToolEffect(env.DB, {
      commandId: parsePlatformId<DriverCommandId>(input.commandId, "driver command id"),
      driverGeneration: state.requireDriverGeneration(),
      driverInstanceId: state.requireDriverInstanceId(),
    });
    context.assertActiveConnection();
    return observation;
  }

  async handleSettleExternalToolEffect(
    input: DriverExternalToolEffectSettleInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectState> {
    const { env, state } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }
    context.assertActiveConnection();

    const settlement = await settleExternalToolEffect(env.DB, {
      claimToken: input.claimToken,
      commandId: parsePlatformId<DriverCommandId>(input.commandId, "driver command id"),
      driverGeneration: state.requireDriverGeneration(),
      driverInstanceId: state.requireDriverInstanceId(),
      effectId: parsePlatformId<ExternalToolEffectId>(input.effectId, "external tool effect id"),
      settlement: parseSchemaValue(ExternalToolEffectSettlement, input.settlement),
    });
    context.assertActiveConnection();
    return settlement;
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
      state.requireDriverGeneration(),
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
  ): Promise<"delivered" | "discarded" | "retry"> {
    const { env, state } = this.#dependencies;

    context.assertActiveConnection();
    const commandId = parsePlatformId<DriverCommandId>(command.commandId, "runtime command id");
    const deliveryOutcome = await markRuntimeCommandRecordDelivered(env.DB, {
      commandId,
      connectionId: context.connectionId,
      driverGeneration: state.requireDriverGeneration(),
      driverInstanceId: state.requireDriverInstanceId(),
    });
    context.assertActiveConnection();

    if (deliveryOutcome.kind === "applied") {
      return "delivered";
    }

    return deliveryOutcome.kind === "rejected" && deliveryOutcome.reason === "inactive_session_run"
      ? "discarded"
      : "retry";
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
