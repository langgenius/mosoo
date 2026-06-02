import type { ChannelBindingId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  claimChannelConnectionOwner,
  readChannelConnectionOwnerState,
  renewChannelConnectionOwnerLease,
} from "../application/channel-connection-state.service";
import type { DiscordGatewayDispatchEnvelope } from "./discord-events";
import { DiscordGatewayClient } from "./discord-gateway-client";
import type {
  DiscordGatewayClientAction,
  DiscordGatewayClientOptions,
  DiscordGatewayResumeState,
  DiscordGatewayWritableSocket,
} from "./discord-gateway-client";
import { createDiscordGatewayRelayRequest } from "./discord-gateway-relay";
import type { DiscordGatewayRelayRequest } from "./discord-gateway-relay";
import {
  createDiscordGatewayRuntimeStatePayload,
  parseDiscordGatewayResumeStateFromRuntimeState,
} from "./discord-gateway-runtime-state";

export class DiscordGatewayConnectionRelayError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Discord Gateway connection relay failed: ${code}`);
    this.code = code;
    this.name = "DiscordGatewayConnectionRelayError";
  }
}

class DiscordGatewayRuntimeLeaseLostError extends Error {
  constructor() {
    super("Discord Gateway runtime lost its lease.");
    this.name = "DiscordGatewayRuntimeLeaseLostError";
  }
}

export interface DiscordGatewayRuntimeOwnerOptions {
  apiBaseUrl: string;
  bindingId: ChannelBindingId;
  bindings: Pick<ApiBindings, "DB">;
  botToken: string;
  leaseDurationMs: number;
  nowMs: () => number;
  ownerId: string;
  relayFetch?: (request: DiscordGatewayRelayRequest) => Promise<Response>;
  relaySecret: string;
  resumeState?: DiscordGatewayResumeState | null;
  resolveRelayChannelType: (envelope: DiscordGatewayDispatchEnvelope) => Promise<number | null>;
  socket: DiscordGatewayWritableSocket;
}

async function defaultRelayFetch(request: DiscordGatewayRelayRequest): Promise<Response> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: "POST",
  });
}

function ensureRelayResponseOk(response: Response): void {
  if (response.ok) {
    return;
  }

  throw new DiscordGatewayConnectionRelayError(`relay_http_${response.status}`);
}

export class DiscordGatewayRuntimeOwner {
  readonly #apiBaseUrl: string;
  readonly #bindingId: ChannelBindingId;
  readonly #bindings: Pick<ApiBindings, "DB">;
  readonly #client: DiscordGatewayClient;
  readonly #leaseDurationMs: number;
  readonly #nowMs: () => number;
  readonly #ownerId: string;
  readonly #relayFetch: (request: DiscordGatewayRelayRequest) => Promise<Response>;
  readonly #relaySecret: string;
  readonly #resolveRelayChannelType: (
    envelope: DiscordGatewayDispatchEnvelope,
  ) => Promise<number | null>;
  readonly #tasks: Promise<void>[] = [];

  constructor(options: DiscordGatewayRuntimeOwnerOptions) {
    this.#apiBaseUrl = options.apiBaseUrl;
    this.#bindingId = options.bindingId;
    this.#bindings = options.bindings;
    this.#leaseDurationMs = options.leaseDurationMs;
    this.#nowMs = options.nowMs;
    this.#ownerId = options.ownerId;
    this.#relayFetch = options.relayFetch ?? defaultRelayFetch;
    this.#relaySecret = options.relaySecret;
    this.#resolveRelayChannelType = options.resolveRelayChannelType;
    const clientOptions: DiscordGatewayClientOptions = {
      nowMs: options.nowMs,
      onDispatch: (envelope) => {
        this.#tasks.push(this.#relayDispatch(envelope));
      },
      socket: options.socket,
      token: options.botToken,
    };

    if (options.resumeState !== undefined) {
      clientOptions.resumeState = options.resumeState;
    }

    this.#client = new DiscordGatewayClient(clientOptions);
  }

  static async claim(
    options: DiscordGatewayRuntimeOwnerOptions,
  ): Promise<DiscordGatewayRuntimeOwner | null> {
    const storedState = await readChannelConnectionOwnerState({
      bindingId: options.bindingId,
      bindings: options.bindings,
      provider: "discord",
    });
    const resumeState = storedState
      ? parseDiscordGatewayResumeStateFromRuntimeState(storedState.runtimeStateJson)
      : null;
    const owner = new DiscordGatewayRuntimeOwner({
      ...options,
      resumeState,
    });

    const claimed = await claimChannelConnectionOwner({
      bindingId: options.bindingId,
      bindings: options.bindings,
      leaseDurationMs: options.leaseDurationMs,
      nowMs: options.nowMs(),
      ownerId: options.ownerId,
      provider: "discord",
      state: createDiscordGatewayRuntimeStatePayload(owner.#client.getSnapshot()),
    });

    return claimed ? owner : null;
  }

  getSnapshot() {
    return this.#client.getSnapshot();
  }

  async handleMessage(rawMessage: string): Promise<DiscordGatewayClientAction> {
    let action: DiscordGatewayClientAction;

    try {
      action = this.#client.handleMessage(rawMessage);
    } catch (error) {
      this.#client.handleError("gateway_protocol_error");
      await this.#persist();
      throw error;
    }

    await this.#flushDispatchTasks();
    await this.#persist();
    return action;
  }

  async sendHeartbeat(): Promise<void> {
    this.#client.sendHeartbeat();
    await this.#persist();
  }

  async handleClose(code: number): Promise<void> {
    this.#client.handleClose(code);
    await this.#persist();
  }

  async handleError(errorCode: string): Promise<void> {
    this.#client.handleError(errorCode);
    await this.#persist();
  }

  async #relayDispatch(envelope: DiscordGatewayDispatchEnvelope): Promise<void> {
    const relayChannelType = await this.#resolveRelayChannelType(envelope);

    if (relayChannelType === null) {
      throw new DiscordGatewayConnectionRelayError("relay_channel_type_missing");
    }

    const request = await createDiscordGatewayRelayRequest({
      apiBaseUrl: this.#apiBaseUrl,
      bindingId: this.#bindingId,
      envelope,
      nowSeconds: Math.floor(this.#nowMs() / 1000),
      relayChannelType,
      relaySecret: this.#relaySecret,
    });
    ensureRelayResponseOk(await this.#relayFetch(request));
  }

  async #flushDispatchTasks(): Promise<void> {
    const tasks = this.#tasks.splice(0);

    if (tasks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(tasks);
    const failure = results.find((result) => result.status === "rejected");

    if (!failure) {
      return;
    }

    const code =
      failure.reason instanceof DiscordGatewayConnectionRelayError
        ? failure.reason.code
        : "relay_failed";
    this.#client.recordRecoverableError(code);
    await this.#persist();
    throw new DiscordGatewayConnectionRelayError(code);
  }

  async #persist(): Promise<void> {
    const renewed = await renewChannelConnectionOwnerLease({
      bindingId: this.#bindingId,
      bindings: this.#bindings,
      leaseDurationMs: this.#leaseDurationMs,
      nowMs: this.#nowMs(),
      ownerId: this.#ownerId,
      provider: "discord",
      state: createDiscordGatewayRuntimeStatePayload(this.#client.getSnapshot()),
    });

    if (!renewed) {
      throw new DiscordGatewayRuntimeLeaseLostError();
    }
  }
}
