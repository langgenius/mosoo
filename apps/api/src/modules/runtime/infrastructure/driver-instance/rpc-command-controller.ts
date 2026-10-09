import type { DriverCommandUpdateInput } from "@mosoo/agent-driver/orpc";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../../../platform/cloudflare/logger";
import {
  claimNextQueuedRuntimeCommand,
  createRuntimeCommandRecord,
  getRuntimeCommandKind,
  updateRuntimeCommandRecord,
} from "../session-runs/runtime-command-store.repository";
import { COMMAND_LEASE_MS } from "./connections";
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

    if (state.terminalized) {
      throw new Error(`Driver instance ${state.requireDriverInstanceId()} is already closed.`);
    }

    await createRuntimeCommandRecord(env.DB, {
      command,
      driverInstanceId: state.requireDriverInstanceId(),
      expiresAt: Date.now() + COMMAND_LEASE_MS,
    });
  }

  async handleCommandUpdate(
    input: DriverCommandUpdateInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    const { env, state } = this.#dependencies;
    const driverInstanceId = state.requireDriverInstanceId();
    context.assertActiveConnection();

    const commandId = parsePlatformId<DriverCommandId>(input.commandId, "driver command id");
    const commandKind = await getRuntimeCommandKind(env.DB, driverInstanceId, commandId);
    context.assertActiveConnection();

    const updateOutcome = await updateRuntimeCommandRecord(env.DB, {
      commandId,
      driverInstanceId,
      status: input.status,
    });
    context.assertActiveConnection();

    if (updateOutcome.kind === "rejected") {
      throw new Error(`Runtime command status update rejected: ${updateOutcome.reason}.`);
    }

    if (
      commandKind === "input.start" &&
      (input.status === "completed" ||
        input.status === "failed" ||
        input.status === "cancelled" ||
        input.status === "expired")
    ) {
      const release = releaseLinkedTerminalDriverInstanceSessionRun(env, driverInstanceId).catch(
        (error: unknown) => {
          this.#dependencies.withRuntimeLogContext(() => {
            logError("runtime.terminal.lease_release.failed", {
              ...createErrorLogContext(error),
              driverInstanceId,
            });
          });
        },
      );
      this.#dependencies.waitUntil(release);
    }

    return { ok: true };
  }

  async handleNextCommand(
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ command: RuntimeCommand | null }> {
    const { env, state } = this.#dependencies;

    if (state.terminalized) {
      return { command: null };
    }
    context.assertActiveConnection();

    const command = await claimNextQueuedRuntimeCommand(
      env.DB,
      state.requireDriverInstanceId(),
      context.connectionId,
    );

    if (command === null) {
      return { command: null };
    }
    context.assertActiveConnection();

    return { command };
  }
}
