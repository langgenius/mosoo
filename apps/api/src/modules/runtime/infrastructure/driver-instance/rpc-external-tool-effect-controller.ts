import type {
  DriverExternalToolEffectClaimInput,
  DriverExternalToolEffectClaimOutput,
  DriverExternalToolEffectObserveInput,
  DriverExternalToolEffectSettleInput,
  DriverExternalToolEffectState,
} from "@mosoo/agent-driver/orpc";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId } from "@mosoo/id";

import {
  claimExternalToolEffect,
  observeExternalToolEffect,
  settleExternalToolEffect,
} from "../session-runs/external-tool-effect.repository";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";

export class DriverInstanceRpcExternalToolEffectController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;

  constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#dependencies = dependencies;
  }

  #identity(
    input: DriverExternalToolEffectObserveInput,
    context: DriverInstanceRpcOperationContext,
  ) {
    const driverInstanceId = this.#dependencies.state.requireDriverInstanceId();
    if (
      input.driverInstanceId !== driverInstanceId ||
      context.driverInstanceId !== driverInstanceId
    ) {
      throw new Error("Driver instance id mismatch.");
    }
    context.assertActiveConnection();
    return {
      commandId: parsePlatformId<DriverCommandId>(input.commandId, "driver command id"),
      connectionId: context.connectionId,
      driverInstanceId,
    };
  }

  async handleObserve(
    input: DriverExternalToolEffectObserveInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectState> {
    const result = await observeExternalToolEffect(
      this.#dependencies.env.DB,
      this.#identity(input, context),
    );
    context.assertActiveConnection();
    return result;
  }

  async handleClaim(
    input: DriverExternalToolEffectClaimInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectClaimOutput> {
    if (this.#dependencies.state.terminalized) {
      throw new Error("Cannot claim an external effect after the Driver is closed.");
    }
    const result = await claimExternalToolEffect(this.#dependencies.env.DB, {
      ...this.#identity(input, context),
      claimToken: input.claimToken,
    });
    context.assertActiveConnection();
    return result;
  }

  async handleSettle(
    input: DriverExternalToolEffectSettleInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectState> {
    const result = await settleExternalToolEffect(this.#dependencies.env.DB, {
      ...this.#identity(input, context),
      claimToken: input.claimToken,
      effectId: input.effectId,
      settlement: input.settlement,
    });
    context.assertActiveConnection();
    return result;
  }
}
