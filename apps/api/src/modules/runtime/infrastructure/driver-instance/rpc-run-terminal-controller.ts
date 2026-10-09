import type { DriverFailureInput } from "@mosoo/agent-driver/orpc";

import { logError, logInfo } from "../../../../platform/cloudflare/logger";
import { syncSessionViewerState } from "../../../sessions/infrastructure/session/client";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";
import {
  recordDriverInstanceCompletion,
  recordDriverInstanceFailure,
} from "./terminal-driver-events";

export class DriverInstanceRpcRunTerminalController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;

  constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#dependencies = dependencies;
  }

  async handleCompleteRun(context: DriverInstanceRpcOperationContext): Promise<{ ok: true }> {
    const { env, finalizeTerminalState, sockets, state, withRuntimeLogContext } =
      this.#dependencies;
    const driverInstanceId = state.requireDriverInstanceId();
    context.assertActiveConnection();

    await recordDriverInstanceCompletion(env, { driverInstanceId });
    context.assertActiveConnection();

    withRuntimeLogContext(() => {
      logInfo("runtime.run.completed", {
        driverInstanceId,
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

    const link = await state.getRuntimeSessionLink(env.DB);
    await syncSessionViewerState(env, link.sessionId);

    return { ok: true };
  }

  async handleFailRun(
    input: DriverFailureInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    const { env, finalizeTerminalState, sockets, state, withRuntimeLogContext } =
      this.#dependencies;
    const driverInstanceId = state.requireDriverInstanceId();
    context.assertActiveConnection();

    const link = await state.getRuntimeSessionLink(env.DB);
    await recordDriverInstanceFailure(env, {
      driverInstanceId,
      error: input.error,
      link,
    });
    context.assertActiveConnection();

    withRuntimeLogContext(() => {
      logError("runtime.run.failed", {
        driverInstanceId,
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
}
