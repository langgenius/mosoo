import type { DriverCompletionInput, DriverFailureInput } from "@mosoo/agent-driver/orpc";
import { parsePlatformId } from "@mosoo/id";
import type { SessionRunId } from "@mosoo/id";

import { logError, logInfo } from "../../../../platform/cloudflare/logger";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import {
  getRuntimeSessionLink,
  recordDriverInstanceCompletion,
  recordDriverInstanceFailure,
} from "./events";
import type { RuntimeSessionLink } from "./events";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";

export class DriverInstanceRpcRunTerminalController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;

  constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#dependencies = dependencies;
  }

  async handleCompleteRun(
    input: DriverCompletionInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    const {
      env,
      finalizeTerminalState,
      sockets,
      state,
      viewerEventDelivery,
      withRuntimeLogContext,
    } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }
    const driverInstanceId = state.requireDriverInstanceId();
    const sessionRunId = readTerminalRunId(input);
    context.assertActiveConnection();

    await recordDriverInstanceCompletion(env, {
      driverConnectionId: context.connectionId,
      driverGeneration: context.epoch.generation,
      driverInstanceId,
      sessionRunId,
    });

    await state.setTerminalSessionRunId(sessionRunId, context.epoch);

    const link = await this.#getRuntimeSessionLink(context, {
      refresh: runtimeSessionLinkNeedsRefresh(state.runtimeSessionLink),
      sessionRunId,
    });
    viewerEventDelivery.requestStateSync(link.sessionId);
    context.assertActiveConnection();

    withRuntimeLogContext(() => {
      logInfo("runtime.run.completed", {
        driverInstanceId: input.driverInstanceId,
        driverReady: state.hello !== null,
        heartbeatCount: state.heartbeatCount,
      });
    });

    const socket = sockets.getDriverSocket(context.epoch);

    if (socket && socket.readyState === WebSocket.OPEN) {
      sockets.scheduleDriverSocketClose(context.epoch, 1000, "runtime.completed");
    } else {
      await state.persistClose(
        {
          at: new Date().toISOString(),
          code: 1000,
          reason: "runtime.completed",
        },
        context.epoch,
      );
      await finalizeTerminalState(context.epoch);
    }

    return { ok: true };
  }

  async handleFailRun(
    input: DriverFailureInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    const {
      env,
      finalizeTerminalState,
      sockets,
      state,
      viewerEventDelivery,
      withRuntimeLogContext,
    } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }
    const driverInstanceId = state.requireDriverInstanceId();
    const sessionRunId = readTerminalRunId(input);
    context.assertActiveConnection();

    const link = await this.#getRuntimeSessionLink(context, {
      refresh: runtimeSessionLinkNeedsRefresh(state.runtimeSessionLink),
      sessionRunId,
    });
    await recordDriverInstanceFailure(env, {
      driverConnectionId: context.connectionId,
      driverGeneration: context.epoch.generation,
      driverInstanceId,
      error: input.error,
      link,
      sessionRunId,
    });

    await state.setTerminalSessionRunId(sessionRunId, context.epoch);

    viewerEventDelivery.requestStateSync(link.sessionId);
    context.assertActiveConnection();

    withRuntimeLogContext(() => {
      logError("runtime.run.failed", {
        driverInstanceId: input.driverInstanceId,
        errorCode: input.error.code,
        errorDetails: input.error.details,
        errorMessage: input.error.message,
        heartbeatCount: state.heartbeatCount,
        retryable: input.error.retryable,
      });
    });

    await state.setConnectionErrorMessage(context.epoch, input.error.message);
    context.assertActiveConnection();

    const socket = sockets.getDriverSocket(context.epoch);

    if (socket && socket.readyState === WebSocket.OPEN) {
      sockets.scheduleDriverSocketClose(context.epoch, 1011, "runtime.failed");
    } else {
      await finalizeTerminalState(context.epoch);
    }

    return { ok: true };
  }

  async #getRuntimeSessionLink(
    context: DriverInstanceRpcOperationContext,
    options: { refresh?: boolean; sessionRunId: SessionRunId },
  ): Promise<RuntimeSessionLink> {
    const { env, state } = this.#dependencies;

    if (
      options.refresh !== true &&
      state.runtimeSessionLink?.sessionRunId === options.sessionRunId
    ) {
      return state.runtimeSessionLink;
    }

    const link = await getRuntimeSessionLink(env.DB, state.requireDriverInstanceId(), {
      sessionRunId: options.sessionRunId,
    });
    context.assertActiveConnection();

    if (link.sessionRunId !== options.sessionRunId) {
      throw new Error("Terminal Driver Session Run identity does not match the request.");
    }

    state.setRuntimeSessionLink(link);
    return link;
  }
}

function readTerminalRunId(input: DriverCompletionInput | DriverFailureInput): SessionRunId {
  return parsePlatformId<SessionRunId>(input.runId, "terminal Driver Session Run id");
}
