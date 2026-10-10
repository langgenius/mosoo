import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId } from "@mosoo/id";
import { parseTraceparent } from "@mosoo/observability";
import { RPCHandler } from "@orpc/server/websocket";
import { DurableObject } from "cloudflare:workers";

import { DurableObjectIdentity } from "../../../../platform/cloudflare/durable-object-support";
import {
  createErrorLogContext,
  logError,
  logInfo,
  runWithApiLogContext,
} from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import { decodeAndHashBootToken } from "../runtime-boot-token";
import { claimDriverInstanceByBootTokenHash } from "./driver-instance-token.repository";
import { getDriverInstanceStatus, markDriverInstanceConnected } from "./lifecycle";
import { createDriverInstanceRpcContext } from "./rpc";
import type { DriverInstanceRpcControllers } from "./rpc";
import { DriverInstanceRpcCommandController } from "./rpc-command-controller";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";
import { DriverInstanceRpcEventIngestionController } from "./rpc-event-ingestion-controller";
import { DriverInstanceRpcExternalToolEffectController } from "./rpc-external-tool-effect-controller";
import { DriverInstanceRpcHandshakeController } from "./rpc-handshake-controller";
import { DriverInstanceRpcRunTerminalController } from "./rpc-run-terminal-controller";
import { runtimeOrpcRouter } from "./rpc-wire";
import { DriverInstanceRuntimeState } from "./runtime-state";
import { DriverInstanceSocketRegistry } from "./sockets";
import type { DriverInstanceCloseSnapshot, DriverInstanceSnapshot } from "./state";
import { DriverInstanceTerminalStateCoordinator } from "./terminal-state-coordinator";

function toErrorMessage(error: unknown, defaultMessage = "Unknown error."): string {
  return error instanceof Error ? error.message : defaultMessage;
}

export class DriverInstance extends DurableObject {
  #destroyed = false;
  readonly #controllers: DriverInstanceRpcControllers;
  readonly #identity = new DurableObjectIdentity({
    mismatchMessage: "Driver instance id does not match the active Durable Object.",
    requiredMessage: "Driver instance id is required.",
  });
  readonly #rpcHandler = new RPCHandler(runtimeOrpcRouter);
  readonly #sockets: DriverInstanceSocketRegistry;
  readonly #state: DriverInstanceRuntimeState;
  readonly #terminalState: DriverInstanceTerminalStateCoordinator;

  constructor(ctx: DurableObjectState, env: ApiBindings) {
    super(ctx, env);

    this.#state = new DriverInstanceRuntimeState(ctx);
    this.#sockets = new DriverInstanceSocketRegistry(ctx);
    this.#terminalState = new DriverInstanceTerminalStateCoordinator({
      env,
      state: this.#state,
      withRuntimeLogContext: (fn) => this.#withRuntimeLogContext(fn),
    });
    const dependencies: DriverInstanceRpcControllerDependencies = {
      env,
      finalizeTerminalState: async () => this.#terminalState.finalize(),
      sockets: this.#sockets,
      state: this.#state,
      waitUntil: (task) => this.ctx.waitUntil(task),
      withRuntimeLogContext: (fn) => this.#withRuntimeLogContext(fn),
    };
    this.#controllers = {
      commands: new DriverInstanceRpcCommandController(dependencies),
      events: new DriverInstanceRpcEventIngestionController(dependencies),
      effects: new DriverInstanceRpcExternalToolEffectController(dependencies),
      handshake: new DriverInstanceRpcHandshakeController(dependencies),
      terminal: new DriverInstanceRpcRunTerminalController(dependencies),
    };
    void this.ctx.blockConcurrencyWhile(async () => this.#state.load());
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      if (this.#destroyed) {
        return Response.json(
          { error: "Driver instance Durable Object was destroyed." },
          { status: 410 },
        );
      }

      const url = new URL(request.url);
      await this.#ensureDriverInstanceId(url.searchParams.get("driverInstanceId"));
      return await this.#acceptDriverSocket(url);
    } catch (error) {
      this.#withRuntimeLogContext(() => {
        logError("runtime.run.request.failed", {
          ...createErrorLogContext(error),
          driverInstanceId: this.#state.driverInstanceId,
        });
      });
      return Response.json({ error: toErrorMessage(error) }, { status: 500 });
    }
  }

  override async alarm(): Promise<void> {
    if (!this.#destroyed && this.#state.close !== null) {
      await this.#terminalState.finalize();
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    this.#rpcHandler.close(ws);

    // A socket replaced by a newer accepted connection must not finalize the
    // state that now belongs to its successor.
    if (this.#sockets.isSupersededDriverSocket(ws)) {
      this.#sockets.releaseDriverSocket(ws);
      return;
    }

    this.#sockets.releaseDriverSocket(ws);

    const close: DriverInstanceCloseSnapshot = {
      at: new Date().toISOString(),
      code,
      reason,
    };

    await this.#state.persistClose(close);

    this.#withRuntimeLogContext(() => {
      logInfo("runtime.socket.closed", {
        closeCode: code,
        closeReason: reason || null,
        driverInstanceId: this.#state.driverInstanceId,
      });
    });
    await this.#terminalState.finalize();
  }

  override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    if (!this.#sockets.isActiveDriverSocket(ws)) {
      return;
    }

    try {
      const connectionId = this.#state.requireConnectionId();

      await this.#rpcHandler.message(ws, message, {
        context: createDriverInstanceRpcContext(this.#controllers, {
          assertActiveConnection: () => {
            if (
              this.#state.connectionId !== connectionId ||
              !this.#sockets.isActiveDriverSocket(ws)
            ) {
              throw new Error("Driver connection is no longer current.");
            }
          },
          connectionId,
          driverInstanceId: this.#state.requireDriverInstanceId(),
        }),
      });
    } catch (error) {
      this.#withRuntimeLogContext(() => {
        logError("runtime.socket.message.failed", {
          ...createErrorLogContext(error),
          driverInstanceId: this.#state.driverInstanceId,
        });
      });

      await this.#state.setErrorMessage(
        toErrorMessage(error, "Driver instance WebSocket message failed."),
      );

      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1003, "runtime.invalid-message");
      } else {
        await this.#terminalState.finalize();
      }
    }
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    if (this.#sockets.isSupersededDriverSocket(ws)) {
      return;
    }

    this.#withRuntimeLogContext(() => {
      logError("runtime.socket.error", {
        driverInstanceId: this.#state.driverInstanceId,
      });
    });

    await this.#state.setErrorMessage("Driver instance WebSocket error.");

    const socket = this.#sockets.getDriverSocket();

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1011, "runtime.socket.error");
    } else {
      await this.#terminalState.finalize();
    }
  }

  async #acceptDriverSocket(url: URL): Promise<Response> {
    const token = url.searchParams.get("token");

    if (!isTruthy(token)) {
      return Response.json({ error: "Driver boot token is required." }, { status: 401 });
    }

    let bootTokenHash: Uint8Array;

    try {
      bootTokenHash = await decodeAndHashBootToken(token);
    } catch {
      return Response.json({ error: "Boot token is invalid." }, { status: 401 });
    }

    if (this.#state.terminalized) {
      await this.#state.resetForReuse();
    }

    const claim = await claimDriverInstanceByBootTokenHash(this.env, bootTokenHash);

    if (claim === null || claim.driverInstanceId !== this.#state.requireDriverInstanceId()) {
      return Response.json({ error: "Boot token is invalid." }, { status: 401 });
    }

    const connectionId = createPlatformId();
    const connected = await markDriverInstanceConnected(this.env, {
      bootTokenHash,
      connectionId,
      driverInstanceId: this.#state.requireDriverInstanceId(),
      generation: claim.generation,
    });

    if (!connected) {
      return Response.json({ error: "Driver connection is no longer current." }, { status: 409 });
    }

    const traceparent = url.searchParams.get("traceparent");
    const parsedTraceparent = isTruthy(traceparent) ? parseTraceparent(traceparent) : null;
    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = [pair[0], pair[1]];

    this.#sockets.replaceDriverSockets();
    this.#sockets.acceptDriverSocket(serverSocket);

    await this.#state.recordAcceptedConnection({
      connectionId,
      driverGeneration: claim.generation,
      traceId: parsedTraceparent?.traceId ?? null,
    });

    this.#withRuntimeLogContext(() => {
      logInfo("runtime.socket.accepted", {
        connectionId,
        driverInstanceId: this.#state.requireDriverInstanceId(),
      });
    });

    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  }

  async #ensureDriverInstanceId(candidate: string | null): Promise<void> {
    if (isTruthy(this.#state.driverInstanceId)) {
      this.#identity.remember(this.#state.driverInstanceId);

      if (isTruthy(candidate)) {
        this.#identity.ensure(candidate);
      }

      if (this.#state.terminalized) {
        await this.#terminalState.finalize();
        const status = await getDriverInstanceStatus(this.env, this.#state.driverInstanceId);

        if (status === "provisioning" || status === "connecting" || status === "ready") {
          await this.#state.resetForReuse();
        }
      }

      return;
    }

    await this.#state.setDriverInstanceId(
      parsePlatformId<DriverInstanceId>(this.#identity.ensure(candidate), "driver instance id"),
    );
  }

  async #ensureActive(driverInstanceId: DriverInstanceId): Promise<void> {
    if (this.#destroyed) {
      throw new Error("Driver instance Durable Object was destroyed.");
    }

    await this.#ensureDriverInstanceId(driverInstanceId);
  }

  async sendControlCommand(
    driverInstanceId: DriverInstanceId,
    command: RuntimeCommand,
  ): Promise<void> {
    await this.#ensureActive(driverInstanceId);
    const socket = this.#sockets.getDriverSocket();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      const message = "Runtime driver control socket is not connected.";
      await this.#state.setErrorMessage(message);
      await this.#terminalState.finalize();
      throw new Error(message);
    }

    await this.#controllers.commands.enqueueCommand(command);
  }

  async destroy(driverInstanceId: DriverInstanceId, reason: string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    await this.#ensureDriverInstanceId(driverInstanceId);
    this.#destroyed = true;
    this.#identity.clear();
    const socket = this.#sockets.getDriverSocket();

    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(1000, reason);
    }

    await this.#state.destroy(reason);
  }

  async fail(driverInstanceId: DriverInstanceId, message: string): Promise<void> {
    await this.#ensureActive(driverInstanceId);
    await this.#state.setErrorMessage(message);

    const socket = this.#sockets.getDriverSocket();

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1011, "runtime.failed");
      return;
    }

    await this.#terminalState.finalize();
  }

  async snapshot(driverInstanceId: DriverInstanceId): Promise<DriverInstanceSnapshot> {
    await this.#ensureActive(driverInstanceId);
    const socket = this.#sockets.getDriverSocket();
    return { driverSocketConnected: socket?.readyState === WebSocket.OPEN };
  }

  async waitForClose(driverInstanceId: DriverInstanceId, timeoutMs: number): Promise<void> {
    await this.#ensureActive(driverInstanceId);
    await this.#state.waitForClose(timeoutMs);
  }

  async waitForReady(driverInstanceId: DriverInstanceId, timeoutMs: number): Promise<void> {
    await this.#ensureActive(driverInstanceId);
    await this.#state.waitForReady(timeoutMs);
  }

  #withRuntimeLogContext<T>(fn: () => T): T {
    return runWithApiLogContext(
      {
        ...(isTruthy(this.#state.driverInstanceId)
          ? { driverInstanceId: this.#state.driverInstanceId }
          : {}),
        ...(isTruthy(this.#state.traceId) ? { traceId: this.#state.traceId } : {}),
      },
      fn,
    );
  }
}
