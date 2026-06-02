import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { ChannelBindingId } from "@mosoo/id";

import { logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../time";
import { resolveAgentChannelBindingContextById } from "../application/channel-binding-context";
import {
  claimChannelConnectionOwner,
  readChannelConnectionOwnerState,
  releaseChannelConnectionOwner,
  renewChannelConnectionOwnerLease,
} from "../application/channel-connection-state.service";
import type { ChannelConnectionStatePayload } from "../application/channel-connection-state.service";
import { parseLarkCredentials } from "./lark-credentials";
import {
  LARK_GATEWAY_LEASE_DURATION_MS,
  LARK_GATEWAY_MAX_CONSECUTIVE_RECONNECT_FAILURES,
  LARK_GATEWAY_PROVIDER,
  LARK_GATEWAY_RECONNECT_INITIAL_BACKOFF_MS,
  LARK_GATEWAY_STORAGE_BINDING_KEY,
  LARK_GATEWAY_STORAGE_OWNER_KEY,
  defaultResumeState,
  mapResumeToRuntimeStatus,
  nextReconnectBackoff,
  parseResumeState,
  serializeResumeState,
} from "./lark-gateway-state";
import type { LarkGatewayResumeState } from "./lark-gateway-state";
import { createLarkGatewayClient, resolveLarkLongConnectionUrl } from "./lark-gateway-wiring";
import type {
  LarkLongConnectionClient,
  LarkLongConnectionCloseInfo,
} from "./lark-long-connection-client";

export type { LarkGatewayResumeState, LarkGatewayStatus } from "./lark-gateway-state";

export interface LarkGatewayStartResult {
  readonly bindingId: string;
  readonly status: "already_started" | "started" | "lease_held" | "binding_not_found";
}

export interface LarkGatewayStopResult {
  readonly bindingId: string;
  readonly status: "not_started" | "stopped";
}

export interface LarkGatewaySnapshot {
  readonly bindingId: string | null;
  readonly resume: LarkGatewayResumeState;
}

function parseLarkGatewayBindingId(bindingId: string): ChannelBindingId {
  return parsePlatformId<ChannelBindingId>(bindingId, "Lark Gateway binding ID");
}

export class LarkLongConnectionRuntimeService {
  readonly #ctx: DurableObjectState;
  readonly #env: ApiBindings;
  #client: LarkLongConnectionClient | null = null;
  #resume: LarkGatewayResumeState = defaultResumeState(0);

  constructor(ctx: DurableObjectState, env: ApiBindings) {
    this.#ctx = ctx;
    this.#env = env;
  }

  async start(bindingId: string): Promise<LarkGatewayStartResult> {
    return await this.#start(parseLarkGatewayBindingId(bindingId));
  }

  async stop(bindingId: string): Promise<LarkGatewayStopResult> {
    return await this.#stop(parseLarkGatewayBindingId(bindingId));
  }

  async snapshot(bindingId: string): Promise<LarkGatewaySnapshot> {
    return await this.#snapshot(parseLarkGatewayBindingId(bindingId));
  }

  async alarm(): Promise<void> {
    const nowMs = currentTimestampMs();
    const storedBindingId = await this.#ctx.storage.get<string>(LARK_GATEWAY_STORAGE_BINDING_KEY);
    const ownerId = await this.#ctx.storage.get<string>(LARK_GATEWAY_STORAGE_OWNER_KEY);

    if (!storedBindingId || !ownerId) {
      await this.#ctx.storage.deleteAlarm();
      return;
    }
    const bindingId = parseLarkGatewayBindingId(storedBindingId);

    await this.#loadResumeState(bindingId, nowMs);
    this.#reconcileInMemoryClientState(nowMs);

    const renewed = await renewChannelConnectionOwnerLease({
      bindingId,
      bindings: this.#env,
      leaseDurationMs: LARK_GATEWAY_LEASE_DURATION_MS,
      nowMs,
      ownerId,
      provider: LARK_GATEWAY_PROVIDER,
      state: this.#runtimeStatePayload(nowMs),
    });

    if (!renewed) {
      logError("lark.gateway.lease_lost", { bindingId, ownerId });
      await this.#forceStop(bindingId, ownerId, nowMs, "lease_lost");
      return;
    }

    if (this.#resume.status === "connected" && this.#client) {
      this.#client.sendPing();
      await this.#scheduleNextHeartbeat();
      return;
    }

    if (
      this.#resume.status === "reconnecting" ||
      this.#resume.status === "stale" ||
      this.#resume.status === "connecting"
    ) {
      await this.#attemptReconnect(bindingId, ownerId, nowMs);
      return;
    }

    await this.#forceStop(bindingId, ownerId, nowMs, "idle_tick");
  }

  /**
   * Align persisted health with the in-memory client after hello handshakes or
   * DO hibernation. A persisted connected state without a live client must
   * reconnect, not release the lease.
   */
  #reconcileInMemoryClientState(nowMs: number): void {
    if (this.#client) {
      const clientState = this.#client.snapshot().state;
      if (clientState === "connected" && this.#resume.status !== "connected") {
        this.#resume = {
          ...this.#resume,
          consecutiveReconnectFailures: 0,
          lastConnectedAtMs: nowMs,
          reconnectBackoffMs: LARK_GATEWAY_RECONNECT_INITIAL_BACKOFF_MS,
          status: "connected",
          statusChangedAtMs: nowMs,
        };
      }
      return;
    }

    if (this.#resume.status === "connected") {
      this.#resume = {
        ...this.#resume,
        status: "reconnecting",
        statusChangedAtMs: nowMs,
      };
    }
  }

  async #start(bindingId: ChannelBindingId): Promise<LarkGatewayStartResult> {
    const nowMs = currentTimestampMs();
    const existingBindingId = await this.#ctx.storage.get<string>(LARK_GATEWAY_STORAGE_BINDING_KEY);

    if (existingBindingId === bindingId && this.#resume.status === "connected") {
      return { bindingId, status: "already_started" };
    }

    const ownerId = `lark-gateway:${bindingId}:${createPlatformId()}`;
    const claimed = await claimChannelConnectionOwner({
      bindingId,
      bindings: this.#env,
      leaseDurationMs: LARK_GATEWAY_LEASE_DURATION_MS,
      nowMs,
      ownerId,
      provider: LARK_GATEWAY_PROVIDER,
      state: { status: "starting", statusChangedAtMs: nowMs },
    });

    if (!claimed) {
      return { bindingId, status: "lease_held" };
    }

    await this.#ctx.storage.put(LARK_GATEWAY_STORAGE_BINDING_KEY, bindingId);
    await this.#ctx.storage.put(LARK_GATEWAY_STORAGE_OWNER_KEY, ownerId);

    this.#resume = {
      ...defaultResumeState(nowMs),
      status: "connecting",
    };

    try {
      await this.#openClient(bindingId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      this.#resume = {
        ...this.#resume,
        lastErrorCode: "connect_failed",
        status: "reconnecting",
        statusChangedAtMs: nowMs,
      };
      logError("lark.gateway.connect_failed", { bindingId, detail });
      await this.#persistResumeState(bindingId, ownerId, nowMs);
      await this.#ctx.storage.setAlarm(nowMs + this.#resume.reconnectBackoffMs);
      return { bindingId, status: "started" };
    }

    await this.#persistResumeState(bindingId, ownerId, nowMs);
    await this.#scheduleNextHeartbeat();
    return { bindingId, status: "started" };
  }

  async #stop(requestedBindingId: ChannelBindingId): Promise<LarkGatewayStopResult> {
    const storedBindingId = await this.#ctx.storage.get<string>(LARK_GATEWAY_STORAGE_BINDING_KEY);
    const ownerId = await this.#ctx.storage.get<string>(LARK_GATEWAY_STORAGE_OWNER_KEY);

    if (!storedBindingId || !ownerId) {
      return { bindingId: requestedBindingId, status: "not_started" };
    }
    const bindingId = parseLarkGatewayBindingId(storedBindingId);

    if (bindingId !== requestedBindingId) {
      throw new Error("Lark long-connection runtime received a mismatched binding id.");
    }

    await this.#forceStop(bindingId, ownerId, currentTimestampMs(), "explicit_stop");
    return { bindingId, status: "stopped" };
  }

  async #snapshot(requestedBindingId: ChannelBindingId): Promise<LarkGatewaySnapshot> {
    const storedBindingId = await this.#ctx.storage.get<string>(LARK_GATEWAY_STORAGE_BINDING_KEY);
    const bindingId = storedBindingId ? parseLarkGatewayBindingId(storedBindingId) : null;

    if (bindingId && bindingId !== requestedBindingId) {
      throw new Error("Lark long-connection runtime received a mismatched binding id.");
    }

    return { bindingId: bindingId ?? null, resume: this.#resume };
  }

  async #openClient(bindingId: ChannelBindingId): Promise<void> {
    const binding = await resolveAgentChannelBindingContextById(this.#env, {
      bindingId,
      provider: "lark",
    });
    if (!binding) {
      throw new Error(`Lark binding ${bindingId} not found.`);
    }
    const credentials = parseLarkCredentials(binding.credentialsJson);
    if (credentials.connectionMode !== "websocket") {
      throw new Error(
        `Lark binding ${bindingId} is connectionMode=${credentials.connectionMode}; long-connection runtime only runs websocket-mode bindings.`,
      );
    }

    const wsUrl = await resolveLarkLongConnectionUrl({ credentials });

    // Closing the old client can synchronously fire #onClientClose. The
    // reconnect path overwrites its near-term alarm, so setAlarm remains
    // last-write-wins.
    this.#client?.close();
    this.#client = null;

    const client = createLarkGatewayClient({
      bindingId,
      bindings: this.#env,
      onClose: (info) => {
        this.#onClientClose(bindingId, info);
      },
    });

    client.connect(wsUrl);
    this.#client = client;
    // The client is observable as connected only after the Lark hello frame.
    // Until then, the gateway stays connecting/reconnecting.
  }

  #onClientClose(bindingId: ChannelBindingId, info: LarkLongConnectionCloseInfo): void {
    const nowMs = currentTimestampMs();
    this.#client = null;

    if (info.kind === "auth_failed" || info.kind === "client_initiated") {
      this.#resume = {
        ...this.#resume,
        lastErrorCode: info.kind === "auth_failed" ? "auth_failed" : null,
        status: "stopped",
        statusChangedAtMs: nowMs,
      };
      logInfo("lark.gateway.close", {
        bindingId,
        code: info.code,
        kind: info.kind,
        reason: info.reason,
      });
      // Persist the stopped state and release the lease before hibernation.
      void this.#ctx.storage.setAlarm(nowMs + 100);
      return;
    }

    this.#resume = {
      ...this.#resume,
      lastErrorCode: info.errorDetail ?? `close_${info.code}`,
      reconnectBackoffMs: nextReconnectBackoff(this.#resume.reconnectBackoffMs),
      status: "reconnecting",
      statusChangedAtMs: nowMs,
    };
    logInfo("lark.gateway.reconnect_scheduled", {
      bindingId,
      code: info.code,
      kind: info.kind,
      reconnectBackoffMs: this.#resume.reconnectBackoffMs,
    });
    // Reconnect through alarm so the synchronous close callback does no I/O.
    void this.#ctx.storage.setAlarm(nowMs + 100);
  }

  async #attemptReconnect(
    bindingId: ChannelBindingId,
    ownerId: string,
    nowMs: number,
  ): Promise<void> {
    try {
      await this.#openClient(bindingId);
      // A constructed WebSocket is not a completed Lark handshake. Reset the
      // failure count only after the client reports connected.
      this.#resume = {
        ...this.#resume,
        status: this.#resume.status === "stopped" ? "connecting" : this.#resume.status,
        statusChangedAtMs: nowMs,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      const failures = this.#resume.consecutiveReconnectFailures + 1;
      this.#resume = {
        ...this.#resume,
        consecutiveReconnectFailures: failures,
        lastErrorCode: "reconnect_failed",
        reconnectBackoffMs: nextReconnectBackoff(this.#resume.reconnectBackoffMs),
        statusChangedAtMs: nowMs,
      };
      logError("lark.gateway.reconnect_failed", { bindingId, detail, failures });

      if (failures >= LARK_GATEWAY_MAX_CONSECUTIVE_RECONNECT_FAILURES) {
        logError("lark.gateway.reconnect_giving_up", { bindingId, failures });
        await this.#forceStop(bindingId, ownerId, nowMs, "reconnect_exhausted");
        return;
      }
    }

    await this.#persistResumeState(bindingId, ownerId, nowMs);
    await this.#ctx.storage.setAlarm(nowMs + this.#resume.reconnectBackoffMs);
  }

  async #forceStop(
    bindingId: ChannelBindingId,
    ownerId: string,
    nowMs: number,
    reason: string,
  ): Promise<void> {
    this.#client?.close();
    this.#client = null;
    const stoppedErrorCode =
      reason === "lease_lost" || reason === "reconnect_exhausted" ? reason : null;
    const releaseStatus: "failed" | "stopped" =
      reason === "reconnect_exhausted" ? "failed" : "stopped";
    this.#resume = {
      ...this.#resume,
      consecutiveReconnectFailures: 0,
      lastErrorCode: stoppedErrorCode ?? this.#resume.lastErrorCode,
      status: "stopped",
      statusChangedAtMs: nowMs,
    };
    await releaseChannelConnectionOwner({
      bindingId,
      bindings: this.#env,
      nowMs,
      ownerId,
      provider: LARK_GATEWAY_PROVIDER,
      status: releaseStatus,
    });
    await this.#ctx.storage.delete(LARK_GATEWAY_STORAGE_BINDING_KEY);
    await this.#ctx.storage.delete(LARK_GATEWAY_STORAGE_OWNER_KEY);
    await this.#ctx.storage.deleteAlarm();
    logInfo("lark.gateway.stopped", { bindingId, reason });
  }

  async #scheduleNextHeartbeat(): Promise<void> {
    await this.#ctx.storage.setAlarm(currentTimestampMs() + this.#resume.heartbeatIntervalMs);
  }

  async #loadResumeState(bindingId: ChannelBindingId, nowMs: number): Promise<void> {
    const record = await readChannelConnectionOwnerState({
      bindingId,
      bindings: this.#env,
      provider: LARK_GATEWAY_PROVIDER,
    });
    if (record) {
      this.#resume = parseResumeState(record.runtimeStateJson, nowMs);
    }
  }

  async #persistResumeState(
    bindingId: ChannelBindingId,
    ownerId: string,
    nowMs: number,
  ): Promise<void> {
    await renewChannelConnectionOwnerLease({
      bindingId,
      bindings: this.#env,
      leaseDurationMs: LARK_GATEWAY_LEASE_DURATION_MS,
      nowMs,
      ownerId,
      provider: LARK_GATEWAY_PROVIDER,
      state: this.#runtimeStatePayload(nowMs),
    });
  }

  #runtimeStatePayload(nowMs: number): ChannelConnectionStatePayload {
    return {
      lastErrorCode: this.#resume.lastErrorCode,
      lastHeartbeatAtMs: nowMs,
      runtimeStateJson: serializeResumeState(this.#resume),
      status: mapResumeToRuntimeStatus(this.#resume.status),
      statusChangedAtMs: this.#resume.statusChangedAtMs,
    };
  }
}
