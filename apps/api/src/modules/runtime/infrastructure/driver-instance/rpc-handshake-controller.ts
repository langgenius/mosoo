import type {
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverHelloOutput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import { SANDBOX_ORGANIZATION_ROOT } from "@mosoo/agent-driver/paths";

import { logInfo } from "../../../../platform/cloudflare/logger";
import { DRIVER_HEARTBEAT_INTERVAL_MS } from "../../domain/runtime-config";
import { COMMAND_LEASE_MS } from "./commands";
import { EVENT_BATCH_MAX_SIZE } from "./connections";
import { getRuntimeSessionLink } from "./events";
import type { RuntimeSessionLink } from "./events";
import {
  markDriverInstanceReady,
  recordDriverInstanceHeartbeat,
  recordDriverInstanceHello,
} from "./lifecycle";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";

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

    const record = await state.recordHeartbeat(input);

    if (record.shouldPersistCanonical) {
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
    context.assertActiveConnection();

    let link: RuntimeSessionLink | null = null;
    let output = state.helloOutput ?? state.pendingHello?.output ?? null;

    if (output === null) {
      link = await this.#getRuntimeSessionLink(context);
      context.assertActiveConnection();
      output = {
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

    const staged = await state.stageHello(context.epoch, input, output);
    context.assertActiveConnection();

    if (staged === "replay") {
      return output;
    }

    const projection = await recordDriverInstanceHello(env, {
      connectionId: context.connectionId,
      driverInstanceId: state.requireDriverInstanceId(),
      generation: context.epoch.generation,
      hello: input,
    });

    if (projection === "conflict") {
      throw new Error("Driver hello conflicts with the lifecycle projection.");
    }
    context.assertActiveConnection();

    const committedOutput = await state.commitHello(context.epoch);
    context.assertActiveConnection();

    link ??= await this.#getRuntimeSessionLink(context);
    context.assertActiveConnection();

    if (state.traceId === null && link.traceId !== null) {
      await state.setTraceId(link.traceId, context.epoch);
      context.assertActiveConnection();
    }

    withRuntimeLogContext(() => {
      logInfo("runtime.driver.hello.received", {
        capabilities: input.capabilities,
        connectionId: state.connectionId,
        driverInstanceId: state.requireDriverInstanceId(),
        driverVersion: input.driverVersion,
        pid: input.pid,
        runId: link.sessionRunId,
      });
    });

    return committedOutput;
  }

  async handleReady(
    input: DriverReadyInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }> {
    const { env, state, withRuntimeLogContext } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }

    if (!state.hello) {
      throw new Error("Driver hello is required before ready.");
    }

    context.assertActiveConnection();

    const staged = await state.stageReady(context.epoch, input);
    context.assertActiveConnection();

    if (staged === "replay") {
      return { ok: true };
    }

    const projection = await markDriverInstanceReady(env, {
      ...input,
      connectionId: context.connectionId,
      driverInstanceId: state.requireDriverInstanceId(),
      generation: context.epoch.generation,
    });

    if (projection === "conflict") {
      throw new Error("Driver ready conflicts with the lifecycle projection.");
    }
    context.assertActiveConnection();

    const result = await state.commitReady(context.epoch);
    state.resolveReadyWaiters(result, context.epoch.generation);

    withRuntimeLogContext(() => {
      logInfo("runtime.driver.ready.received", {
        driverInstanceId: input.driverInstanceId,
        pid: input.pid,
        readyAt: input.at,
      });
    });

    return { ok: true };
  }

  async #getRuntimeSessionLink(
    context: DriverInstanceRpcOperationContext,
    options: { refresh?: boolean } = {},
  ): Promise<RuntimeSessionLink> {
    const { env, state } = this.#dependencies;

    if (options.refresh !== true && state.runtimeSessionLink !== null) {
      return state.runtimeSessionLink;
    }

    const link = await getRuntimeSessionLink(env.DB, state.requireDriverInstanceId());
    context.assertActiveConnection();
    state.setRuntimeSessionLink(link);
    return link;
  }
}
