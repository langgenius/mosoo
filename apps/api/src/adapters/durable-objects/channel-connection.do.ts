import { DurableObject } from "cloudflare:workers";

import type {
  DiscordGatewaySnapshotResult,
  DiscordGatewayStartResult,
  DiscordGatewayStopResult,
} from "../../modules/channels/discord/discord-gateway.do";
import type {
  LarkGatewaySnapshot,
  LarkGatewayStartResult,
  LarkGatewayStopResult,
} from "../../modules/channels/lark/lark-gateway.do";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";

const CHANNEL_CONNECTION_PROVIDER_STORAGE_KEY = "provider";

export type ChannelConnectionProvider = "discord" | "lark";

export type ChannelConnectionStartResult = DiscordGatewayStartResult | LarkGatewayStartResult;
export type ChannelConnectionStopResult = DiscordGatewayStopResult | LarkGatewayStopResult;
export type ChannelConnectionSnapshotResult = DiscordGatewaySnapshotResult | LarkGatewaySnapshot;

interface ChannelConnectionDelegate {
  alarm(): Promise<void>;
  snapshot(
    bindingId: string,
  ): ChannelConnectionSnapshotResult | Promise<ChannelConnectionSnapshotResult>;
  start(bindingId: string): Promise<ChannelConnectionStartResult>;
  stop(bindingId: string): Promise<ChannelConnectionStopResult>;
}

function isChannelConnectionProvider(value: unknown): value is ChannelConnectionProvider {
  return value === "discord" || value === "lark";
}

function isBindingMissing(result: ChannelConnectionStartResult): boolean {
  return result.status === "binding_not_found";
}

export class ChannelConnection extends DurableObject<ApiBindings> {
  readonly #delegates = new Map<ChannelConnectionProvider, Promise<ChannelConnectionDelegate>>();

  async start(
    provider: ChannelConnectionProvider,
    bindingId: string,
  ): Promise<ChannelConnectionStartResult> {
    await this.ctx.storage.put(CHANNEL_CONNECTION_PROVIDER_STORAGE_KEY, provider);
    const result = await (await this.#getDelegate(provider)).start(bindingId);

    if (isBindingMissing(result)) {
      await this.ctx.storage.delete(CHANNEL_CONNECTION_PROVIDER_STORAGE_KEY);
    }

    return result;
  }

  async stop(
    provider: ChannelConnectionProvider,
    bindingId: string,
  ): Promise<ChannelConnectionStopResult> {
    const result = await (await this.#getDelegate(provider)).stop(bindingId);
    await this.ctx.storage.delete(CHANNEL_CONNECTION_PROVIDER_STORAGE_KEY);
    return result;
  }

  async snapshot(
    provider: ChannelConnectionProvider,
    bindingId: string,
  ): Promise<ChannelConnectionSnapshotResult> {
    return await (await this.#getDelegate(provider)).snapshot(bindingId);
  }

  override async alarm(): Promise<void> {
    const provider = await this.ctx.storage.get(CHANNEL_CONNECTION_PROVIDER_STORAGE_KEY);

    if (!isChannelConnectionProvider(provider)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await (await this.#getDelegate(provider)).alarm();
  }

  #getDelegate(provider: ChannelConnectionProvider): Promise<ChannelConnectionDelegate> {
    const existing = this.#delegates.get(provider);

    if (existing) {
      return existing;
    }

    const created = this.#createDelegate(provider);
    this.#delegates.set(provider, created);
    return created;
  }

  async #createDelegate(provider: ChannelConnectionProvider): Promise<ChannelConnectionDelegate> {
    switch (provider) {
      case "discord": {
        const { DiscordGatewayConnectionRuntimeService } =
          await import("../../modules/channels/discord/discord-gateway.do");
        return new DiscordGatewayConnectionRuntimeService(this.ctx, this.env);
      }
      case "lark": {
        const { LarkLongConnectionRuntimeService } =
          await import("../../modules/channels/lark/lark-gateway.do");
        return new LarkLongConnectionRuntimeService(this.ctx, this.env);
      }
    }
  }
}
