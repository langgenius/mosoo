import { parsePlatformId } from "@mosoo/id";
import type { AgentId, ChannelBindingId, AppId } from "@mosoo/id";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../time";
import { recordAgentChannelBindingError } from "../application/agent-channel-binding-error";
import { resolveAgentChannelBindingContextById } from "../application/channel-binding-context";
import {
  releaseChannelConnectionOwner,
  readChannelConnectionOwnerState,
} from "../application/channel-connection-state.service";
import { parseDiscordCredentials } from "./discord-credentials";
import type { DiscordGatewayDispatchEnvelope } from "./discord-events";
import type { DiscordGatewayRuntimeSnapshot } from "./discord-gateway-health";
import {
  DiscordGatewayConnectionRelayError,
  DiscordGatewayRuntimeOwner,
} from "./discord-gateway-owner";
import type { DiscordGatewayRuntimeOwnerOptions } from "./discord-gateway-owner";
import type { DiscordGatewayRelayRequest } from "./discord-gateway-relay";
import { parseDiscordGatewayResumeStateFromRuntimeState } from "./discord-gateway-runtime-state";
import type { DiscordGatewayConnect, DiscordGatewaySocket } from "./discord-gateway-socket";
import { createDefaultGatewaySocket, readGatewayMessageText } from "./discord-gateway-socket";
import { DiscordWebApiClient, DiscordWebApiError } from "./discord-web-api";

const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DISCORD_GATEWAY_OWNER_LEASE_DURATION_MS = 2 * 60 * 1000;
const DISCORD_GATEWAY_RECONNECT_DELAY_MS = 5 * 1000;
const DISCORD_GATEWAY_MIN_HEARTBEAT_DELAY_MS = 1 * 1000;
const DISCORD_GATEWAY_BINDING_STORAGE_KEY = "bindingId";
const DISCORD_GATEWAY_AUTH_FAILED_CLOSE = 4004;
const DISCORD_GATEWAY_DISALLOWED_INTENTS_CLOSE = 4014;

export type DiscordGatewayStartResult =
  | {
      bindingId: string;
      status: "already_started" | "started";
      snapshot: DiscordGatewayRuntimeSnapshot;
    }
  | {
      bindingId: string;
      status: "binding_not_found" | "lease_held";
    };

export interface DiscordGatewayStopResult {
  bindingId: string;
  status: "not_started" | "stopped";
}

export interface DiscordGatewaySnapshotResult {
  active: boolean;
  bindingId: string | null;
  snapshot: DiscordGatewayRuntimeSnapshot | null;
}

export interface DiscordGatewayDurableObjectStorage {
  delete(key: string): Promise<boolean>;
  deleteAlarm(): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: Date | number): Promise<void>;
}

export interface DiscordGatewayDurableObjectState {
  storage: DiscordGatewayDurableObjectStorage;
}

interface ActiveDiscordGatewayConnection {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  owner: DiscordGatewayRuntimeOwner;
  appId: AppId;
  socket: DiscordGatewaySocket;
}

export interface DiscordGatewayConnectionRuntimeServiceOptions {
  connectGateway?: DiscordGatewayConnect;
  nowMs?: () => number;
  relayFetch?: (request: DiscordGatewayRelayRequest) => Promise<Response>;
}

function getApiBaseUrl(bindings: ApiBindings): string {
  return bindings.MOSOO_API_BASE_URL ?? bindings.WEB_ORIGIN;
}

function createOwnerId(bindingId: ChannelBindingId): string {
  return `discord-gateway:${bindingId}`;
}

function parseDiscordGatewayBindingId(bindingId: string): ChannelBindingId {
  return parsePlatformId<ChannelBindingId>(bindingId, "Discord Gateway binding ID");
}

function toRelayChannelTypeError(error: DiscordWebApiError): DiscordGatewayConnectionRelayError {
  return new DiscordGatewayConnectionRelayError(`channel_type_${error.code}`);
}

function isFatalGatewayCloseCode(code: number): boolean {
  return (
    code === DISCORD_GATEWAY_AUTH_FAILED_CLOSE || code === DISCORD_GATEWAY_DISALLOWED_INTENTS_CLOSE
  );
}

function getFatalGatewayCloseErrorCode(code: number): string {
  switch (code) {
    case DISCORD_GATEWAY_AUTH_FAILED_CLOSE:
      return "discord_gateway_authentication_failed";
    case DISCORD_GATEWAY_DISALLOWED_INTENTS_CLOSE:
      return "discord_gateway_disallowed_intents";
    default:
      return `discord_gateway_close_${code}`;
  }
}

function isHeartbeatAckOverdue(snapshot: DiscordGatewayRuntimeSnapshot, nowMs: number): boolean {
  if (snapshot.heartbeatIntervalMs === null || snapshot.lastHeartbeatSentAtMs === null) {
    return false;
  }

  if (
    snapshot.lastHeartbeatAckAtMs !== null &&
    snapshot.lastHeartbeatAckAtMs >= snapshot.lastHeartbeatSentAtMs
  ) {
    return false;
  }

  return nowMs - snapshot.lastHeartbeatSentAtMs >= snapshot.heartbeatIntervalMs;
}

export class DiscordGatewayConnectionRuntimeService {
  readonly #bindings: ApiBindings;
  readonly #connectGateway: DiscordGatewayConnect;
  readonly #nowMs: () => number;
  readonly #relayFetch: ((request: DiscordGatewayRelayRequest) => Promise<Response>) | undefined;
  readonly #state: DiscordGatewayDurableObjectState;
  #active: ActiveDiscordGatewayConnection | null = null;
  #stoppingBindingId: ChannelBindingId | null = null;

  constructor(
    state: DiscordGatewayDurableObjectState,
    bindings: ApiBindings,
    options: DiscordGatewayConnectionRuntimeServiceOptions = {},
  ) {
    this.#bindings = bindings;
    this.#connectGateway = options.connectGateway ?? createDefaultGatewaySocket;
    this.#nowMs = options.nowMs ?? currentTimestampMs;
    this.#relayFetch = options.relayFetch;
    this.#state = state;
  }

  async start(bindingId: string): Promise<DiscordGatewayStartResult> {
    const requestedBindingId = parseDiscordGatewayBindingId(bindingId);

    if (this.#stoppingBindingId === requestedBindingId) {
      await this.#state.storage.deleteAlarm();
      await this.#state.storage.delete(DISCORD_GATEWAY_BINDING_STORAGE_KEY);
      return {
        bindingId: requestedBindingId,
        status: "binding_not_found",
      };
    }

    if (this.#active) {
      if (this.#active.bindingId !== requestedBindingId) {
        throw new Error("Discord Gateway Durable Object received a mismatched binding id.");
      }

      return {
        bindingId: requestedBindingId,
        snapshot: this.#active.owner.getSnapshot(),
        status: "already_started",
      };
    }

    const binding = await resolveAgentChannelBindingContextById(this.#bindings, {
      bindingId: requestedBindingId,
      provider: "discord",
    });

    if (!binding || binding.agentStatus !== "published") {
      await this.#state.storage.deleteAlarm();
      await this.#state.storage.delete(DISCORD_GATEWAY_BINDING_STORAGE_KEY);
      return {
        bindingId: requestedBindingId,
        status: "binding_not_found",
      };
    }

    const credentials = parseDiscordCredentials(binding.credentialsJson);
    const storedState = await readChannelConnectionOwnerState({
      bindingId: requestedBindingId,
      bindings: this.#bindings,
      provider: "discord",
    });
    const resumeState = storedState
      ? parseDiscordGatewayResumeStateFromRuntimeState(storedState.runtimeStateJson)
      : null;
    const socket = this.#connectGateway(resumeState?.resumeGatewayUrl ?? DISCORD_GATEWAY_URL);
    const ownerOptions: DiscordGatewayRuntimeOwnerOptions = {
      apiBaseUrl: getApiBaseUrl(this.#bindings),
      bindingId: requestedBindingId,
      bindings: this.#bindings,
      botToken: credentials.botToken,
      leaseDurationMs: DISCORD_GATEWAY_OWNER_LEASE_DURATION_MS,
      nowMs: this.#nowMs,
      ownerId: createOwnerId(requestedBindingId),
      relaySecret: credentials.relaySecret,
      resolveRelayChannelType: (envelope) =>
        this.#resolveRelayChannelType(credentials.botToken, envelope),
      socket,
    };

    if (this.#relayFetch) {
      ownerOptions.relayFetch = this.#relayFetch;
    }

    const owner = await DiscordGatewayRuntimeOwner.claim(ownerOptions);

    if (!owner) {
      socket.close(4000, "Discord Gateway lease is held by another owner.");
      await this.#scheduleReconnect();
      return {
        bindingId: requestedBindingId,
        status: "lease_held",
      };
    }

    const active = {
      agentId: binding.agentId,
      bindingId: requestedBindingId,
      owner,
      appId: binding.appId,
      socket,
    };
    this.#active = active;
    this.#attachSocketListeners(active);
    await this.#state.storage.put(DISCORD_GATEWAY_BINDING_STORAGE_KEY, requestedBindingId);
    await this.#scheduleNextAlarm(owner.getSnapshot());

    return {
      bindingId: requestedBindingId,
      snapshot: owner.getSnapshot(),
      status: "started",
    };
  }

  async stop(bindingId: string): Promise<DiscordGatewayStopResult> {
    const requestedBindingId = parseDiscordGatewayBindingId(bindingId);
    const active = this.#active;

    if (active && active.bindingId !== requestedBindingId) {
      throw new Error("Discord Gateway Durable Object received a mismatched binding id.");
    }

    this.#stoppingBindingId = requestedBindingId;
    try {
      await this.#state.storage.deleteAlarm();
      await this.#state.storage.delete(DISCORD_GATEWAY_BINDING_STORAGE_KEY);

      if (!active) {
        await this.#releaseOwner(requestedBindingId);
        return {
          bindingId: requestedBindingId,
          status: "not_started",
        };
      }

      active.socket.close(1000, "Discord Gateway connection stopped.");
      this.#active = null;
      await this.#releaseOwner(requestedBindingId);
    } finally {
      if (this.#stoppingBindingId === requestedBindingId) {
        this.#stoppingBindingId = null;
      }
    }

    return {
      bindingId: requestedBindingId,
      status: "stopped",
    };
  }

  snapshot(bindingId: string): DiscordGatewaySnapshotResult {
    const requestedBindingId = parseDiscordGatewayBindingId(bindingId);

    if (!this.#active) {
      return {
        active: false,
        bindingId: null,
        snapshot: null,
      };
    }

    if (this.#active.bindingId !== requestedBindingId) {
      throw new Error("Discord Gateway Durable Object received a mismatched binding id.");
    }

    return {
      active: true,
      bindingId: requestedBindingId,
      snapshot: this.#active.owner.getSnapshot(),
    };
  }

  async alarm(): Promise<void> {
    const active = this.#active;

    if (active) {
      try {
        if (active.owner.getSnapshot().heartbeatIntervalMs === null) {
          await active.owner.handleError("hello_timeout");
          active.socket.close(4000, "Discord Gateway HELLO timed out.");
          this.#active = null;
          await this.#scheduleReconnect();
          return;
        }

        if (isHeartbeatAckOverdue(active.owner.getSnapshot(), this.#nowMs())) {
          await active.owner.handleError("heartbeat_ack_timeout");
          active.socket.close(4000, "Discord Gateway heartbeat ACK timed out.");
          this.#active = null;
          await this.#scheduleReconnect();
          return;
        }

        await active.owner.sendHeartbeat();
        await this.#scheduleNextAlarm(active.owner.getSnapshot());
      } catch (error) {
        logError("discord-gateway-do.heartbeat_failed", {
          ...createErrorLogContext(error),
          bindingId: active.bindingId,
        });
        active.socket.close(4000, "Discord Gateway heartbeat failed.");
        this.#active = null;
        await this.#scheduleReconnect();
      }
      return;
    }

    const bindingId = await this.#state.storage.get<string>(DISCORD_GATEWAY_BINDING_STORAGE_KEY);

    if (!bindingId) {
      return;
    }

    await this.start(bindingId);
  }

  async #resolveRelayChannelType(
    botToken: string,
    envelope: DiscordGatewayDispatchEnvelope,
  ): Promise<number | null> {
    try {
      return await new DiscordWebApiClient(botToken).getChannelType({
        channelId: envelope.message.channelId,
      });
    } catch (error) {
      if (error instanceof DiscordWebApiError) {
        throw toRelayChannelTypeError(error);
      }

      throw error;
    }
  }

  #attachSocketListeners(active: ActiveDiscordGatewayConnection): void {
    active.socket.onMessage((event) => {
      void this.#handleSocketMessage(active, event);
    });
    active.socket.onClose((event) => {
      void this.#handleSocketClose(active, event);
    });
    active.socket.onError(() => {
      void this.#handleSocketError(active);
    });
  }

  async #handleSocketMessage(
    active: ActiveDiscordGatewayConnection,
    event: { data: ArrayBuffer | string },
  ): Promise<void> {
    if (this.#active !== active) {
      return;
    }

    try {
      const action = await active.owner.handleMessage(readGatewayMessageText(event.data));

      if (
        action === "invalid_session" ||
        action === "protocol_error" ||
        action === "reconnect_requested"
      ) {
        this.#active = null;
        await this.#scheduleReconnect();
        return;
      }

      await this.#scheduleNextAlarm(active.owner.getSnapshot());
    } catch (error) {
      if (error instanceof DiscordGatewayConnectionRelayError) {
        logError("discord-gateway-do.relay_failed", {
          ...createErrorLogContext(error),
          bindingId: active.bindingId,
        });
        await this.#scheduleNextAlarm(active.owner.getSnapshot());
        return;
      }

      logError("discord-gateway-do.message_failed", {
        ...createErrorLogContext(error),
        bindingId: active.bindingId,
      });
      active.socket.close(4000, "Discord Gateway message handling failed.");
      this.#active = null;
      await this.#scheduleReconnect();
    }
  }

  async #handleSocketClose(
    active: ActiveDiscordGatewayConnection,
    event: { code: number },
  ): Promise<void> {
    if (this.#active !== active) {
      return;
    }

    const stopping = this.#stoppingBindingId === active.bindingId;
    this.#active = null;

    if (isFatalGatewayCloseCode(event.code)) {
      try {
        await active.owner.handleError(`gateway_close_${event.code}`);
        await this.#releaseOwner(active.bindingId, "failed");
        await recordAgentChannelBindingError(this.#bindings.DB, {
          agentId: active.agentId,
          bindingId: active.bindingId,
          errorCode: getFatalGatewayCloseErrorCode(event.code),
          appId: active.appId,
        });
      } catch (error) {
        logError("discord-gateway-do.fatal_close_persist_failed", {
          ...createErrorLogContext(error),
          bindingId: active.bindingId,
          closeCode: event.code,
        });
      }
      try {
        await this.#state.storage.delete(DISCORD_GATEWAY_BINDING_STORAGE_KEY);
        await this.#state.storage.deleteAlarm();
      } catch (error) {
        logError("discord-gateway-do.fatal_close_local_cleanup_failed", {
          ...createErrorLogContext(error),
          bindingId: active.bindingId,
          closeCode: event.code,
        });
      }
      return;
    }

    if (stopping) {
      return;
    }

    try {
      await active.owner.handleClose(event.code);
    } catch (error) {
      logError("discord-gateway-do.close_persist_failed", {
        ...createErrorLogContext(error),
        bindingId: active.bindingId,
      });
    }

    await this.#scheduleReconnect();
  }

  async #handleSocketError(active: ActiveDiscordGatewayConnection): Promise<void> {
    if (this.#active !== active) {
      return;
    }

    try {
      await active.owner.handleError("socket_error");
    } catch (error) {
      logError("discord-gateway-do.socket_error_persist_failed", {
        ...createErrorLogContext(error),
        bindingId: active.bindingId,
      });
    }

    active.socket.close(4000, "Discord Gateway socket error.");
    this.#active = null;
    await this.#scheduleReconnect();
  }

  async #releaseOwner(
    bindingId: ChannelBindingId,
    status: "failed" | "stopped" = "stopped",
  ): Promise<void> {
    await releaseChannelConnectionOwner({
      bindingId,
      bindings: this.#bindings,
      nowMs: this.#nowMs(),
      ownerId: createOwnerId(bindingId),
      provider: "discord",
      status,
    });
  }

  async #scheduleNextAlarm(snapshot: DiscordGatewayRuntimeSnapshot): Promise<void> {
    const delayMs = snapshot.heartbeatIntervalMs ?? DISCORD_GATEWAY_RECONNECT_DELAY_MS;
    const boundedDelayMs = Math.max(DISCORD_GATEWAY_MIN_HEARTBEAT_DELAY_MS, delayMs);
    await this.#state.storage.setAlarm(this.#nowMs() + boundedDelayMs);
  }

  async #scheduleReconnect(): Promise<void> {
    await this.#state.storage.setAlarm(this.#nowMs() + DISCORD_GATEWAY_RECONNECT_DELAY_MS);
    logInfo("discord-gateway-do.reconnect_scheduled", {});
  }
}
