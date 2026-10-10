import type { DriverCompletionInput, DriverFailureInput } from "@mosoo/agent-driver/orpc";
import { sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { logError, logInfo } from "../../../../platform/cloudflare/logger";
import { getAppDatabase } from "../../../../platform/db/drizzle";
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

  async handleCompleteRun(
    input: DriverCompletionInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    const { env, finalizeTerminalState, sockets, state, withRuntimeLogContext } =
      this.#dependencies;
    const driverInstanceId = state.requireDriverInstanceId();
    context.assertActiveConnection();

    const runId = parsePlatformId<SessionRunId>(input.runId, "completion run id");
    const link = await recordDriverInstanceCompletion(env, { driverInstanceId, runId });
    if (!(await this.#isCurrentRun(link.sessionId, runId))) {
      return { ok: true };
    }
    context.assertActiveConnection();

    withRuntimeLogContext(() => {
      logInfo("runtime.run.completed", {
        driverInstanceId,
        driverReady: state.hello !== null,
        heartbeatCount: state.heartbeatCount,
        runId,
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

    const runId = parsePlatformId<SessionRunId>(input.runId, "failure run id");
    const link = await recordDriverInstanceFailure(env, {
      driverInstanceId,
      error: input.error,
      runId,
    });
    if (!(await this.#isCurrentRun(link.sessionId, runId))) {
      return { ok: true };
    }
    context.assertActiveConnection();

    withRuntimeLogContext(() => {
      logError("runtime.run.failed", {
        driverInstanceId,
        errorCode: input.error.code,
        errorDetails: input.error.details,
        errorMessage: input.error.message,
        heartbeatCount: state.heartbeatCount,
        retryable: input.error.retryable,
        runId,
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

  async #isCurrentRun(sessionId: SessionId, runId: SessionRunId): Promise<boolean> {
    const session = await getAppDatabase(this.#dependencies.env.DB)
      .select({ runId: sessionsTable.lastRunId })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .get();
    return session?.runId === runId;
  }
}
