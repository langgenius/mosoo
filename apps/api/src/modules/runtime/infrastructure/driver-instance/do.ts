import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId } from "@mosoo/id";
import { parseTraceparent } from "@mosoo/observability";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";
import type { RPCHandler } from "@orpc/server/websocket";
import { DurableObject } from "cloudflare:workers";

import { DurableObjectIdentity } from "../../../../platform/cloudflare/durable-object-support";
import {
  createErrorLogContext,
  logError,
  logInfo,
  logWarn,
  runWithApiLogContext,
} from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../../application/runtime-diagnostic-events";
import { decodeAndHashBootToken } from "../runtime-boot-token";
import { toDriverInstanceRequestErrorStatus } from "./connections";
import { json, toErrorMessage } from "./driver-instance-support";
import {
  claimDriverInstanceByBootTokenHash,
  validateDriverInstanceBootTokenHash,
} from "./driver-instance-token.repository";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import { handleDriverInstanceRequest } from "./http";
import type { DriverInstanceHttpHandler } from "./http";
import { getDriverInstanceLifecycleIdentity, markDriverInstanceConnected } from "./lifecycle";
import { createDriverInstanceRpcContext } from "./rpc";
import type { DriverInstanceRpcContext } from "./rpc";
import { DriverInstanceRpcController } from "./rpc-controller";
import { RuntimeSessionViewCache } from "./runtime-session-view-cache";
import { DriverInstanceRuntimeState } from "./runtime-state";
import { getRuntimeSessionLink } from "./session-link.repository";
import { SessionViewerEventDeliveryBuffer } from "./session-viewer-event-delivery-buffer";
import { DriverInstanceSocketRegistry } from "./sockets";
import type {
  DriverInstanceCloseSnapshot,
  DriverInstanceConnectionEpoch,
  DriverInstanceReadyResult,
  DriverInstanceSnapshot,
  DriverInstanceWaitForCloseResult,
} from "./state";
import { DriverInstanceTerminalStateCoordinator } from "./terminal-state-coordinator";

export class DriverInstance extends DurableObject implements DriverInstanceHttpHandler {
  #destroyedGeneration: number | null = null;
  #destroyTask: Promise<void> | null = null;
  readonly #identity = new DurableObjectIdentity({
    mismatchMessage: "Driver instance id does not match the active Durable Object.",
    requiredMessage: "Driver instance id is required.",
  });
  readonly #rpcController: DriverInstanceRpcController;
  #rpcHandler: RPCHandler<DriverInstanceRpcContext> | null = null;
  #rpcHandlerPromise: Promise<RPCHandler<DriverInstanceRpcContext>> | null = null;
  readonly #sockets: DriverInstanceSocketRegistry;
  readonly #state: DriverInstanceRuntimeState;
  readonly #terminalState: DriverInstanceTerminalStateCoordinator;
  readonly #viewCache: RuntimeSessionViewCache;
  readonly #viewerEventDelivery: SessionViewerEventDeliveryBuffer;

  constructor(ctx: DurableObjectState, env: ApiBindings) {
    super(ctx, env);

    this.#state = new DriverInstanceRuntimeState(ctx);
    this.#viewCache = new RuntimeSessionViewCache();
    this.#sockets = new DriverInstanceSocketRegistry(ctx);
    this.#viewerEventDelivery = new SessionViewerEventDeliveryBuffer({
      ctx,
      env,
      getDriverInstanceId: () => this.#state.driverInstanceId,
      withRuntimeLogContext: (fn) => this.#withRuntimeLogContext(fn),
    });
    this.#terminalState = new DriverInstanceTerminalStateCoordinator({
      clearStorage: async () => {
        await ctx.storage.deleteAlarm();
        await ctx.storage.deleteAll();
      },
      env,
      state: this.#state,
      viewCache: this.#viewCache,
      viewerEventDelivery: this.#viewerEventDelivery,
      withRuntimeLogContext: (fn) => this.#withRuntimeLogContext(fn),
    });
    this.#rpcController = new DriverInstanceRpcController({
      env,
      finalizeTerminalState: async (epoch) => this.#terminalState.finalize(epoch),
      sockets: this.#sockets,
      state: this.#state,
      viewCache: this.#viewCache,
      viewerEventDelivery: this.#viewerEventDelivery,
      waitUntil: (task) => this.ctx.waitUntil(task),
      withRuntimeLogContext: (fn) => this.#withRuntimeLogContext(fn),
    });
    void this.ctx.blockConcurrencyWhile(async () => {
      await this.#state.load();

      if (this.#state.driverInstanceId !== null && this.#state.driverGeneration === null) {
        const identity = await getDriverInstanceLifecycleIdentity(
          this.env,
          this.#state.driverInstanceId,
        );

        if (identity !== null) {
          await this.#state.setDriverGeneration(identity.generation);
        }
      }

      if (
        (this.#state.terminalized || this.#state.errorMessage !== null) &&
        !this.#state.terminalCleanupComplete
      ) {
        const epoch = this.#state.connectionEpoch();

        if (epoch !== null) {
          await this.#finalizeTerminalState(epoch);
        }
      }
    });
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (this.#destroyedGeneration !== null) {
        if (request.method === "POST" && url.pathname === "/control/destroy") {
          return handleDriverInstanceRequest(this, request);
        }

        return json({ error: "Driver instance Durable Object was destroyed." }, { status: 410 });
      }

      await this.ensureDriverInstanceId(request.headers.get("x-driver-instance-id"));
      return await handleDriverInstanceRequest(this, request);
    } catch (error) {
      const message = toErrorMessage(error);
      const status = toDriverInstanceRequestErrorStatus(message);
      this.#withRuntimeLogContext(() => {
        logError("runtime.run.request.failed", {
          ...createErrorLogContext(error),
          driverInstanceId: this.#state.driverInstanceId,
          status,
        });
      });
      return json({ error: message }, { status });
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    if (this.#destroyedGeneration !== null) {
      return;
    }

    this.#rpcHandler?.close(ws);
    const epoch = this.#sockets.getSocketEpoch(ws);

    if (epoch === null || !this.#isCurrentSocketEpoch(ws, epoch)) {
      return;
    }

    const close: DriverInstanceCloseSnapshot = {
      at: new Date().toISOString(),
      code,
      reason,
    };

    await this.#state.persistClose(close, epoch);

    if (!this.#isCurrentSocketEpoch(ws, epoch)) {
      return;
    }

    this.#withRuntimeLogContext(() => {
      logInfo("runtime.socket.closed", {
        closeCode: code,
        closeReason: reason || null,
        driverInstanceId: this.#state.driverInstanceId,
      });
    });
    await this.#appendTransportWsDisconnectedEvent(close, epoch);

    if (!this.#isCurrentSocketEpoch(ws, epoch)) {
      return;
    }

    await this.#finalizeTerminalState(epoch);
  }

  override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (this.#destroyedGeneration !== null) {
      return;
    }

    const epoch = this.#sockets.getSocketEpoch(ws);

    if (epoch === null || !this.#isCurrentSocketEpoch(ws, epoch)) {
      return;
    }

    try {
      const rpcHandler = await this.#getRpcHandler();

      if (!this.#isCurrentSocketEpoch(ws, epoch)) {
        return;
      }

      await rpcHandler.message(ws, message, {
        context: createDriverInstanceRpcContext(this.#rpcController, {
          assertActiveConnection: () => {
            if (!this.#isCurrentSocketEpoch(ws, epoch)) {
              throw new Error("Driver connection is no longer current.");
            }
          },
          connectionId: epoch.connectionId,
          epoch,
        }),
      });

      if (!this.#isCurrentSocketEpoch(ws, epoch)) {
        this.#closeSocket(ws, 1000, "runtime.socket.superseded");
      }
    } catch (error) {
      if (!this.#isCurrentSocketEpoch(ws, epoch)) {
        this.#closeSocket(ws, 1000, "runtime.socket.superseded");
        return;
      }

      this.#withRuntimeLogContext(() => {
        logError("runtime.socket.message.failed", {
          ...createErrorLogContext(error),
          driverInstanceId: this.#state.driverInstanceId,
        });
      });

      await this.#state.setConnectionErrorMessage(
        epoch,
        toErrorMessage(error, "Driver instance WebSocket message failed."),
      );

      if (!this.#isCurrentSocketEpoch(ws, epoch)) {
        this.#closeSocket(ws, 1000, "runtime.socket.superseded");
        return;
      }

      await this.#appendTransportRpcErrorEvent(error, epoch);

      if (!this.#isCurrentSocketEpoch(ws, epoch)) {
        this.#closeSocket(ws, 1000, "runtime.socket.superseded");
        return;
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1003, "runtime.invalid-message");
      } else {
        await this.#finalizeTerminalState(epoch);
      }
    }
  }

  async #getRpcHandler(): Promise<RPCHandler<DriverInstanceRpcContext>> {
    if (this.#rpcHandler !== null) {
      return this.#rpcHandler;
    }

    this.#rpcHandlerPromise ??= import("./rpc-handler").then(
      ({ createDriverInstanceRpcHandler }) => {
        const rpcHandler = createDriverInstanceRpcHandler();
        this.#rpcHandler = rpcHandler;
        return rpcHandler;
      },
    );

    return this.#rpcHandlerPromise;
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    if (this.#destroyedGeneration !== null) {
      return;
    }

    const epoch = this.#sockets.getSocketEpoch(ws);

    if (epoch === null || !this.#isCurrentSocketEpoch(ws, epoch)) {
      this.#closeSocket(ws, 1000, "runtime.socket.superseded");
      return;
    }

    this.#withRuntimeLogContext(() => {
      logError("runtime.socket.error", {
        driverInstanceId: this.#state.driverInstanceId,
      });
    });

    await this.#state.setConnectionErrorMessage(epoch, "Driver instance WebSocket error.");

    if (!this.#isCurrentSocketEpoch(ws, epoch)) {
      this.#closeSocket(ws, 1000, "runtime.socket.superseded");
      return;
    }

    await this.#appendTransportRpcErrorEvent("Driver instance WebSocket error.", epoch);

    if (!this.#isCurrentSocketEpoch(ws, epoch)) {
      this.#closeSocket(ws, 1000, "runtime.socket.superseded");
      return;
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, "runtime.socket.error");
    } else {
      await this.#finalizeTerminalState(epoch);
    }
  }

  async acceptDriverSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Driver socket requires a WebSocket upgrade." }, { status: 426 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!isTruthy(token)) {
      return json({ error: "Driver boot token is required." }, { status: 401 });
    }

    let bootTokenHash: Uint8Array;

    try {
      bootTokenHash = await decodeAndHashBootToken(token);
    } catch {
      return json({ error: "Boot token is invalid." }, { status: 401 });
    }

    return this.ctx.blockConcurrencyWhile(async () => {
      const validation = await validateDriverInstanceBootTokenHash(this.env, bootTokenHash);
      const driverInstanceId = this.#state.requireDriverInstanceId();

      if (
        validation.driverInstanceId === null ||
        validation.generation === null ||
        validation.driverInstanceId !== driverInstanceId
      ) {
        return json({ error: validation.error ?? "Boot token is invalid." }, { status: 401 });
      }

      let shouldReset = this.#state.terminalized;

      if (shouldReset) {
        if (!this.#state.terminalCleanupComplete) {
          const epoch = this.#state.connectionEpoch();

          if (epoch !== null) {
            await this.#finalizeTerminalState(epoch);
          }
        }

        if (validation.generation <= this.#state.requireDriverGeneration()) {
          return json({ error: "Driver generation is no longer current." }, { status: 409 });
        }

        await this.#terminalState.prepareForReuse();
      } else if (this.#state.requireDriverGeneration() !== validation.generation) {
        if (this.#state.connectionId !== null) {
          return json({ error: "Driver generation is no longer current." }, { status: 409 });
        }

        shouldReset = true;
        await this.#terminalState.prepareForReuse();
      }

      const claim = await claimDriverInstanceByBootTokenHash(this.env, bootTokenHash);

      if (
        claim.driverInstanceId !== driverInstanceId ||
        claim.generation !== validation.generation
      ) {
        return json({ error: claim.error ?? "Boot token is invalid." }, { status: 401 });
      }

      if (shouldReset) {
        await this.#terminalState.resetForReuse(validation.generation);
      }

      const connectedAt = Date.now();
      const connectionId = createPlatformId();
      const connected = await markDriverInstanceConnected(this.env, {
        bootTokenHash,
        connectedAt,
        connectionId,
        driverInstanceId,
        generation: validation.generation,
      });

      if (!connected) {
        return json({ error: "Driver connection is no longer current." }, { status: 409 });
      }

      const traceparent = url.searchParams.get("traceparent");
      const parsedTraceparent = isTruthy(traceparent) ? parseTraceparent(traceparent) : null;
      const pair = new WebSocketPair();
      const [clientSocket, serverSocket] = [pair[0], pair[1]];
      const epoch = { connectionId, generation: validation.generation };

      this.#sockets.replaceDriverSockets();
      this.#sockets.acceptDriverSocket(serverSocket, epoch);

      await this.#state.recordAcceptedConnection({
        connectedAt,
        connectionId,
        driverGeneration: validation.generation,
        traceId: parsedTraceparent?.traceId ?? null,
      });

      this.#withRuntimeLogContext(() => {
        logInfo("runtime.socket.accepted", {
          connectionId,
          driverInstanceId,
        });
      });

      return new Response(null, {
        status: 101,
        webSocket: clientSocket,
      });
    });
  }

  async ensureDriverInstanceId(candidate: string | null): Promise<DriverInstanceId> {
    if (isTruthy(this.#state.driverInstanceId)) {
      this.#identity.remember(this.#state.driverInstanceId);

      if (isTruthy(candidate)) {
        this.#identity.ensure(candidate);
      }

      if (this.#state.driverGeneration === null) {
        const identity = await getDriverInstanceLifecycleIdentity(
          this.env,
          this.#state.driverInstanceId,
        );

        if (identity === null) {
          throw new Error("Driver instance record was not found.");
        }

        await this.#state.setDriverGeneration(identity.generation);
      }

      return this.#state.driverInstanceId;
    }

    const driverInstanceId = parsePlatformId<DriverInstanceId>(
      this.#identity.ensure(candidate),
      "driver instance id",
    );
    const identity = await getDriverInstanceLifecycleIdentity(this.env, driverInstanceId);

    if (identity === null) {
      throw new Error("Driver instance record was not found.");
    }

    await this.#state.initializeDriverInstance(driverInstanceId, identity.generation);
    return driverInstanceId;
  }

  async sendControlCommand(generation: number, command: RuntimeCommand): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.#assertCurrentGeneration(generation);
      const epoch = this.#state.requireConnectionEpoch();
      const socket = this.#sockets.getDriverSocket(epoch);

      if (!socket || socket.readyState !== WebSocket.OPEN) {
        const message = "Runtime driver control socket is not connected.";
        await this.#state.setConnectionErrorMessage(epoch, message);
        await this.#finalizeTerminalState(epoch);
        throw new Error(message);
      }

      await this.#rpcController.enqueueCommand(generation, command);
    });
  }

  async destroy(generation: number, reason: string): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.#destroyedGeneration !== null) {
        if (this.#destroyedGeneration !== generation) {
          throw new Error("Driver generation is no longer current.");
        }

        return;
      }

      await this.#assertCurrentGeneration(generation);

      return (this.#destroyTask ??= this.#destroy(generation, reason).finally(() => {
        if (this.#destroyedGeneration === null) {
          this.#destroyTask = null;
        }
      }));
    });
  }

  async #destroy(generation: number, reason: string): Promise<void> {
    const socket = this.#sockets.getDriverSocket(this.#state.connectionEpoch());

    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(1000, reason);
    }

    await this.#rpcController.runAfterPendingEvents(() => this.#terminalState.destroy(reason));
    this.#identity.clear();
    this.#destroyedGeneration = generation;
  }

  async fail(generation: number, message: string): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.#assertCurrentGeneration(generation);
      const epoch = this.#state.requireConnectionEpoch();
      await this.#state.setConnectionErrorMessage(epoch, message);

      const socket = this.#sockets.getDriverSocket(epoch);

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close(1011, "runtime.failed");
        return;
      }

      await this.#finalizeTerminalState(epoch);
    });
  }

  async #finalizeTerminalState(epoch: DriverInstanceConnectionEpoch): Promise<void> {
    await this.#rpcController.runAfterPendingEvents(() => this.#terminalState.finalize(epoch));
  }

  async #assertCurrentGeneration(generation: number): Promise<void> {
    if (this.#state.requireDriverGeneration() !== generation) {
      throw new Error("Driver generation is no longer current.");
    }

    const driverInstanceId = this.#state.requireDriverInstanceId();
    const identity = await getDriverInstanceLifecycleIdentity(this.env, driverInstanceId);

    if (identity === null || identity.generation !== generation) {
      throw new Error("Driver generation is no longer current.");
    }
  }

  snapshot(): DriverInstanceSnapshot {
    const socket = this.#sockets.getDriverSocket(this.#state.connectionEpoch());
    return this.#state.snapshot(Boolean(socket && socket.readyState === WebSocket.OPEN));
  }

  async waitForClose(
    generation: number,
    timeoutMs: number,
  ): Promise<DriverInstanceWaitForCloseResult> {
    return this.#state.waitForClose(generation, timeoutMs);
  }

  async waitForReady(generation: number, timeoutMs: number): Promise<DriverInstanceReadyResult> {
    return this.#state.waitForReady(generation, timeoutMs);
  }

  async #getRuntimeSessionLink(epoch: DriverInstanceConnectionEpoch) {
    this.#state.assertConnectionEpoch(epoch);
    const existing = this.#state.runtimeSessionLink;

    if (existing !== null && !runtimeSessionLinkNeedsRefresh(existing)) {
      return existing;
    }

    const link = await getRuntimeSessionLink(this.env.DB, this.#state.requireDriverInstanceId());
    this.#state.assertConnectionEpoch(epoch);
    this.#state.setRuntimeSessionLink(link);
    return link;
  }

  async #appendTransportRpcErrorEvent(
    error: unknown,
    epoch: DriverInstanceConnectionEpoch,
  ): Promise<void> {
    try {
      const link = await this.#getRuntimeSessionLink(epoch);
      this.#state.assertConnectionEpoch(epoch);

      if (!isTruthy(link.agentId) || !isTruthy(link.sessionId)) {
        return;
      }

      await appendRuntimeDiagnosticEvent(this.env, {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.transportRpcError.name,
        sessionId: link.sessionId,
        value: {
          ...toRuntimeDiagnosticBaseValue({
            agentId: link.agentId,
            sessionId: link.sessionId,
            traceId: this.#state.traceId,
          }),
          driverInstanceId: this.#state.requireDriverInstanceId(),
          errorCode: "RPC_TRANSPORT_ERROR",
          reason: toRuntimeDiagnosticReason(error, "Runtime driver transport error."),
        },
      });
    } catch (appendError) {
      this.#withRuntimeLogContext(() => {
        logWarn("runtime.transport.rpc_error_event.emit_failed", {
          ...createErrorLogContext(appendError),
          driverInstanceId: this.#state.driverInstanceId,
        });
      });
    }
  }

  async #appendTransportWsDisconnectedEvent(
    close: DriverInstanceCloseSnapshot,
    epoch: DriverInstanceConnectionEpoch,
  ): Promise<void> {
    try {
      const link = await this.#getRuntimeSessionLink(epoch);
      this.#state.assertConnectionEpoch(epoch);

      if (!isTruthy(link.agentId) || !isTruthy(link.sessionId)) {
        return;
      }

      await appendRuntimeDiagnosticEvent(this.env, {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.transportWsDisconnected.name,
        sessionId: link.sessionId,
        value: {
          ...toRuntimeDiagnosticBaseValue({
            agentId: link.agentId,
            sessionId: link.sessionId,
            traceId: this.#state.traceId,
          }),
          closeCode: close.code,
          closeReason: close.reason || null,
          driverInstanceId: this.#state.requireDriverInstanceId(),
        },
      });
    } catch (appendError) {
      this.#withRuntimeLogContext(() => {
        logWarn("runtime.transport.ws_disconnected_event.emit_failed", {
          ...createErrorLogContext(appendError),
          driverInstanceId: this.#state.driverInstanceId,
        });
      });
    }
  }

  #isCurrentSocketEpoch(ws: WebSocket, epoch: DriverInstanceConnectionEpoch): boolean {
    return this.#sockets.isCurrentDriverSocket(ws, epoch, this.#state.connectionEpoch());
  }

  #closeSocket(ws: WebSocket, code: number, reason: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(code, reason);
    }
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
