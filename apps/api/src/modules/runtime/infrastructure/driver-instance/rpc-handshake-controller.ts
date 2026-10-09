import type { DriverHeartbeatInput, DriverReadyInput } from "@mosoo/agent-driver/orpc";
import { SANDBOX_ORGANIZATION_ROOT } from "@mosoo/agent-driver/paths";

import { logInfo } from "../../../../platform/cloudflare/logger";
import { DRIVER_HEARTBEAT_INTERVAL_MS } from "../../domain/runtime-config";
import { COMMAND_LEASE_MS, EVENT_BATCH_MAX_SIZE } from "./connections";
import {
  markDriverInstanceReady,
  recordDriverInstanceHeartbeat,
  recordDriverInstanceHello,
} from "./lifecycle";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";
import type { DriverHelloInput, DriverHelloOutput } from "./rpc-wire";

export class DriverInstanceRpcHandshakeController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;

  constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#dependencies = dependencies;
  }

  async handleHeartbeat(
    input: DriverHeartbeatInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ heartbeatCount: number; ok: true }> {
    const { env, state } = this.#dependencies;

    if (!state.hello) {
      throw new Error("Driver hello is required before heartbeat.");
    }
    context.assertActiveConnection();

    await state.recordHeartbeat(input);
    context.assertActiveConnection();
    const recorded = await recordDriverInstanceHeartbeat(env, {
      connectionId: context.connectionId,
      driverInstanceId: state.requireDriverInstanceId(),
      generation: state.requireDriverGeneration(),
      heartbeat: input,
      heartbeatCount: state.heartbeatCount,
    });

    if (!recorded) {
      throw new Error("Driver connection is no longer current.");
    }

    return {
      heartbeatCount: state.heartbeatCount,
      ok: true,
    };
  }

  async handleHello(
    input: DriverHelloInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverHelloOutput> {
    const { env, state, withRuntimeLogContext } = this.#dependencies;

    if (state.hello) {
      throw new Error("Driver hello has already been received.");
    }
    context.assertActiveConnection();

    const recorded = await recordDriverInstanceHello(env, {
      connectionId: context.connectionId,
      driverInstanceId: state.requireDriverInstanceId(),
      generation: state.requireDriverGeneration(),
      hello: input,
    });

    if (!recorded) {
      throw new Error("Driver connection is no longer current.");
    }
    context.assertActiveConnection();

    await state.recordHello(input);

    const link = await state.getRuntimeSessionLink(env.DB);

    if (state.traceId === null && link.traceId !== null) {
      await state.setTraceId(link.traceId);
    }

    withRuntimeLogContext(() => {
      logInfo("runtime.driver.hello.received", {
        // The capability list is unvalidated Driver input; log only its size.
        capabilityCount: input.capabilities.length,
        connectionId: context.connectionId,
        driverInstanceId: state.requireDriverInstanceId(),
        driverVersion: input.driverVersion,
        pid: input.pid,
        runId: link.sessionRunId,
      });
    });

    return {
      acceptedCapabilities: input.capabilities,
      connectionId: context.connectionId,
      driverInstanceId: state.requireDriverInstanceId(),
      heartbeatIntervalMs: DRIVER_HEARTBEAT_INTERVAL_MS,
      runConfig: {
        commandLeaseMs: COMMAND_LEASE_MS,
        envPolicy: "strict",
        eventBatchMaxSize: EVENT_BATCH_MAX_SIZE,
        organizationPath: SANDBOX_ORGANIZATION_ROOT,
      },
      runId: link.sessionRunId,
    };
  }

  async handleReady(
    input: DriverReadyInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    const { env, state, withRuntimeLogContext } = this.#dependencies;

    if (!state.hello) {
      throw new Error("Driver hello is required before ready.");
    }

    if (state.ready) {
      throw new Error("Driver ready has already been received.");
    }
    context.assertActiveConnection();

    const markedReady = await markDriverInstanceReady(env, {
      ...input,
      connectionId: context.connectionId,
      driverInstanceId: state.requireDriverInstanceId(),
      generation: state.requireDriverGeneration(),
    });

    if (!markedReady) {
      throw new Error("Driver connection is no longer current.");
    }
    context.assertActiveConnection();

    await state.recordReady(input);

    withRuntimeLogContext(() => {
      logInfo("runtime.driver.ready.received", {
        driverInstanceId: input.driverInstanceId,
        pid: input.pid,
        readyAt: input.at,
      });
    });

    return { ok: true };
  }
}
