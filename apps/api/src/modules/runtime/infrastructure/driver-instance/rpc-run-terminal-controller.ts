import type { DriverCompletionInput, DriverFailureInput } from "@mosoo/agent-driver/orpc";

import { logError, logInfo } from "../../../../platform/cloudflare/logger";
import { syncSessionViewerState } from "../../../sessions/application/session-viewer-events.service";
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
    context.assertActiveConnection();

    await viewerEventDelivery.flushSafely();
    context.assertActiveConnection();
    await recordDriverInstanceCompletion(env, {
      driverInstanceId,
      driverReady: state.hello !== null,
    });
    context.assertActiveConnection();

    withRuntimeLogContext(() => {
      logInfo("runtime.run.completed", {
        driverInstanceId: input.driverInstanceId,
        driverReady: state.hello !== null,
        heartbeatCount: state.heartbeatCount,
      });
    });

    const socket = sockets.getDriverSocket();

    if (socket && socket.readyState === WebSocket.OPEN) {
      sockets.scheduleDriverSocketClose(1000, "runtime.completed");
    } else {
      await state.persistClose({
        at: new Date().toISOString(),
        code: 1000,
        reason: "runtime.completed",
      });
      await finalizeTerminalState();
    }

    const link = await this.#getRuntimeSessionLink({
      refresh: runtimeSessionLinkNeedsRefresh(state.runtimeSessionLink),
    });
    await syncSessionViewerState(env, link.sessionId);

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
    context.assertActiveConnection();

    await viewerEventDelivery.flushSafely();
    context.assertActiveConnection();
    const link = await this.#getRuntimeSessionLink({
      refresh: runtimeSessionLinkNeedsRefresh(state.runtimeSessionLink),
    });
    await recordDriverInstanceFailure(env, {
      driverInstanceId,
      error: input.error,
      link,
    });
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

    await state.setErrorMessage(input.error.message);

    const socket = sockets.getDriverSocket();

    if (socket && socket.readyState === WebSocket.OPEN) {
      sockets.scheduleDriverSocketClose(1011, "runtime.failed");
    } else {
      await finalizeTerminalState();
    }

    await syncSessionViewerState(env, link.sessionId);

    return { ok: true };
  }

  async #getRuntimeSessionLink(options: { refresh?: boolean } = {}): Promise<RuntimeSessionLink> {
    const { env, state } = this.#dependencies;

    if (options.refresh !== true && state.runtimeSessionLink !== null) {
      return state.runtimeSessionLink;
    }

    const link = await getRuntimeSessionLink(env.DB, state.requireDriverInstanceId());
    state.setRuntimeSessionLink(link);
    return link;
  }
}
