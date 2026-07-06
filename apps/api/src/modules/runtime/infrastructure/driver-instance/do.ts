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
import { claimDriverInstanceByBootTokenHash } from "./driver-instance-token.repository";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import { handleDriverInstanceRequest } from "./http";
import type { DriverInstanceHttpHandler } from "./http";
import { getDriverInstanceStatus, markDriverInstanceConnected } from "./lifecycle";
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
  DriverInstanceHeartbeatResult,
  DriverInstanceHelloResult,
  DriverInstanceReadyResult,
  DriverInstanceSnapshot,
  DriverInstanceWaitForCloseResult,
} from "./state";
import { DriverInstanceTerminalStateCoordinator } from "./terminal-state-coordinator";

export class DriverInstance extends DurableObject implements DriverInstanceHttpHandler {
  #destroyed = false;
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
      finalizeTerminalState: async () => this.#terminalState.finalize(),
      sockets: this.#sockets,
      state: this.#state,
      viewCache: this.#viewCache,
      viewerEventDelivery: this.#viewerEventDelivery,
      withRuntimeLogContext: (fn) => this.#withRuntimeLogContext(fn),
    });
    void this.ctx.blockConcurrencyWhile(async () => this.#state.load());
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (this.#destroyed) {
        if (request.method === "POST" && url.pathname === "/control/destroy") {
          return json({ ok: true });
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
    if (this.#destroyed) {
      return;
    }

    this.#rpcHandler?.close(ws);

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
    await this.#appendTransportWsDisconnectedEvent(close);

    if (!this.#state.hello) {
      this.#state.rejectHelloWaiters(
        new Error(`Driver instance socket closed before hello: ${reason || code}.`),
      );
    }

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
      const rpcHandler = await this.#getRpcHandler();

      if (!this.#sockets.isActiveDriverSocket(ws)) {
        return;
      }
      const connectionId = this.#state.requireConnectionId();

      await rpcHandler.message(ws, message, {
        context: createDriverInstanceRpcContext(this.#rpcController, {
          assertActiveConnection: () => {
            if (
              this.#state.connectionId !== connectionId ||
              !this.#sockets.isActiveDriverSocket(ws)
            ) {
              throw new Error("Driver connection is no longer current.");
            }
          },
          connectionId,
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
      await this.#appendTransportRpcErrorEvent(error);

      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1003, "runtime.invalid-message");
      } else {
        await this.#terminalState.finalize();
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
    await this.#appendTransportRpcErrorEvent("Driver instance WebSocket error.");

    const socket = this.#sockets.getDriverSocket();

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1011, "runtime.socket.error");
    } else {
      await this.#terminalState.finalize();
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

    if (this.#state.terminalized) {
      await this.#terminalState.resetForReuse();
    }

    const claim = await claimDriverInstanceByBootTokenHash(this.env, bootTokenHash);

    if (
      claim.driverInstanceId === null ||
      claim.generation === null ||
      claim.driverInstanceId !== this.#state.requireDriverInstanceId()
    ) {
      return json({ error: claim.error ?? "Boot token is invalid." }, { status: 401 });
    }

    const connectedAt = Date.now();
    const connectionId = createPlatformId();
    const connected = await markDriverInstanceConnected(this.env, {
      bootTokenHash,
      connectedAt,
      connectionId,
      driverInstanceId: this.#state.requireDriverInstanceId(),
      generation: claim.generation,
    });

    if (!connected) {
      return json({ error: "Driver connection is no longer current." }, { status: 409 });
    }

    const traceparent = url.searchParams.get("traceparent");
    const parsedTraceparent = isTruthy(traceparent) ? parseTraceparent(traceparent) : null;
    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = [pair[0], pair[1]];

    this.#sockets.replaceDriverSockets();
    this.#sockets.acceptDriverSocket(serverSocket);

    await this.#state.recordAcceptedConnection({
      connectedAt,
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

  async ensureDriverInstanceId(candidate: string | null): Promise<DriverInstanceId> {
    if (isTruthy(this.#state.driverInstanceId)) {
      this.#identity.remember(this.#state.driverInstanceId);

      if (isTruthy(candidate)) {
        this.#identity.ensure(candidate);
      }

      if (this.#state.terminalized) {
        const status = await getDriverInstanceStatus(this.env, this.#state.driverInstanceId);

        if (status === "provisioning" || status === "connecting" || status === "ready") {
          await this.#terminalState.resetForReuse();
        }
      }

      return this.#state.driverInstanceId;
    }

    const driverInstanceId = parsePlatformId<DriverInstanceId>(
      this.#identity.ensure(candidate),
      "driver instance id",
    );
    await this.#state.setDriverInstanceId(driverInstanceId);
    return driverInstanceId;
  }

  async sendControlCommand(command: RuntimeCommand): Promise<void> {
    const socket = this.#sockets.getDriverSocket();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      const message = "Runtime driver control socket is not connected.";
      await this.#state.setErrorMessage(message);
      await this.#terminalState.finalize();
      throw new Error(message);
    }

    await this.#rpcController.enqueueCommand(command);
  }

  async destroy(reason: string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.#identity.clear();
    const socket = this.#sockets.getDriverSocket();

    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(1000, reason);
    }

    await this.#terminalState.destroy(reason);
  }

  async fail(message: string): Promise<void> {
    await this.#state.setErrorMessage(message);

    const socket = this.#sockets.getDriverSocket();

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1011, "runtime.failed");
      return;
    }

    await this.#terminalState.finalize();
  }

  snapshot(): DriverInstanceSnapshot {
    const socket = this.#sockets.getDriverSocket();
    return this.#state.snapshot(Boolean(socket && socket.readyState === WebSocket.OPEN));
  }

  async waitForClose(timeoutMs: number): Promise<DriverInstanceWaitForCloseResult> {
    return this.#state.waitForClose(timeoutMs);
  }

  async waitForHeartbeat(
    afterCount: number,
    timeoutMs: number,
  ): Promise<DriverInstanceHeartbeatResult> {
    return this.#state.waitForHeartbeat(afterCount, timeoutMs);
  }

  async waitForHello(timeoutMs: number): Promise<DriverInstanceHelloResult> {
    return this.#state.waitForHello(timeoutMs);
  }

  async waitForReady(timeoutMs: number): Promise<DriverInstanceReadyResult> {
    return this.#state.waitForReady(timeoutMs);
  }

  async #getRuntimeSessionLink() {
    const existing = this.#state.runtimeSessionLink;

    if (existing !== null && !runtimeSessionLinkNeedsRefresh(existing)) {
      return existing;
    }

    const link = await getRuntimeSessionLink(this.env.DB, this.#state.requireDriverInstanceId());
    this.#state.setRuntimeSessionLink(link);
    return link;
  }

  async #appendTransportRpcErrorEvent(error: unknown): Promise<void> {
    try {
      const link = await this.#getRuntimeSessionLink();

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

  async #appendTransportWsDisconnectedEvent(close: DriverInstanceCloseSnapshot): Promise<void> {
    try {
      const link = await this.#getRuntimeSessionLink();

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
