import type { ChannelBindingId } from "@mosoo/id";

import type {
  ChannelConnection,
  ChannelConnectionProvider,
} from "../../../adapters/durable-objects/channel-connection.do";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { DiscordGatewaySnapshotResult } from "../discord/discord-gateway.do";
import type { DiscordGatewayStartResult } from "../discord/discord-gateway.do";
import type { DiscordGatewayStopResult } from "../discord/discord-gateway.do";
import type { LarkGatewaySnapshot } from "../lark/lark-gateway.do";
import type { LarkGatewayStartResult } from "../lark/lark-gateway.do";
import type { LarkGatewayStopResult } from "../lark/lark-gateway.do";

interface ChannelConnectionKey {
  readonly bindingId: ChannelBindingId;
  readonly provider: ChannelConnectionProvider;
}

function createChannelConnectionInstanceName(input: ChannelConnectionKey): string {
  return `${input.provider}:${input.bindingId}`;
}

function getChannelConnectionNamespace(
  bindings: Pick<ApiBindings, "ChannelConnection">,
): DurableObjectNamespace<ChannelConnection> {
  if (!bindings.ChannelConnection) {
    throw new Error("ChannelConnection Durable Object binding is required.");
  }

  return bindings.ChannelConnection;
}

function getChannelConnectionStub(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: ChannelConnectionKey,
) {
  const namespace = getChannelConnectionNamespace(bindings);
  return namespace.get(namespace.idFromName(createChannelConnectionInstanceName(input)));
}

export async function startChannelConnection(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: { bindingId: ChannelBindingId; provider: "discord" },
): Promise<DiscordGatewayStartResult>;
export async function startChannelConnection(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: { bindingId: ChannelBindingId; provider: "lark" },
): Promise<LarkGatewayStartResult>;
export async function startChannelConnection(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: ChannelConnectionKey,
): Promise<DiscordGatewayStartResult | LarkGatewayStartResult> {
  const stub = getChannelConnectionStub(bindings, input);

  switch (input.provider) {
    case "discord":
      return await stub.start("discord", input.bindingId);
    case "lark":
      return await stub.start("lark", input.bindingId);
  }
}

export async function stopChannelConnection(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: { bindingId: ChannelBindingId; provider: "discord" },
): Promise<DiscordGatewayStopResult>;
export async function stopChannelConnection(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: { bindingId: ChannelBindingId; provider: "lark" },
): Promise<LarkGatewayStopResult>;
export async function stopChannelConnection(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: ChannelConnectionKey,
): Promise<DiscordGatewayStopResult | LarkGatewayStopResult> {
  const stub = getChannelConnectionStub(bindings, input);

  switch (input.provider) {
    case "discord":
      return await stub.stop("discord", input.bindingId);
    case "lark":
      return await stub.stop("lark", input.bindingId);
  }
}

export async function readChannelConnectionSnapshot(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: { bindingId: ChannelBindingId; provider: "discord" },
): Promise<DiscordGatewaySnapshotResult>;
export async function readChannelConnectionSnapshot(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: { bindingId: ChannelBindingId; provider: "lark" },
): Promise<LarkGatewaySnapshot>;
export async function readChannelConnectionSnapshot(
  bindings: Pick<ApiBindings, "ChannelConnection">,
  input: ChannelConnectionKey,
): Promise<DiscordGatewaySnapshotResult | LarkGatewaySnapshot> {
  const stub = getChannelConnectionStub(bindings, input);

  switch (input.provider) {
    case "discord":
      return await stub.snapshot("discord", input.bindingId);
    case "lark":
      return await stub.snapshot("lark", input.bindingId);
  }
}
