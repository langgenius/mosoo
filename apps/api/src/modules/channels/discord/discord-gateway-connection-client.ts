import type { ChannelBindingId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  startChannelConnection,
  stopChannelConnection,
} from "../application/channel-connection-client";
import type { DiscordGatewayStartResult, DiscordGatewayStopResult } from "./discord-gateway.do";

export async function startDiscordGatewayConnection(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: { bindingId: ChannelBindingId },
): Promise<DiscordGatewayStartResult> {
  return await startChannelConnection(bindings, {
    bindingId: input.bindingId,
    provider: "discord",
  });
}

export async function stopDiscordGatewayConnection(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: { bindingId: ChannelBindingId },
): Promise<DiscordGatewayStopResult> {
  return await stopChannelConnection(bindings, { bindingId: input.bindingId, provider: "discord" });
}
