import { describe, expect, test } from "bun:test";

import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createDiscordAgentChannelBinding } from "../src/modules/channels/application/agent-channel-binding.service";
import { readChannelConnectionOwnerSnapshot } from "../src/modules/channels/application/channel-connection-state.service";
import { parseDiscordGatewayDispatchEnvelope } from "../src/modules/channels/discord/discord-events";
import type { DiscordGatewayWritableSocket } from "../src/modules/channels/discord/discord-gateway-client";
import {
  DiscordGatewayConnectionRelayError,
  DiscordGatewayRuntimeOwner,
} from "../src/modules/channels/discord/discord-gateway-owner";
import type { DiscordGatewayRelayRequest } from "../src/modules/channels/discord/discord-gateway-relay";
import { verifyDiscordRelaySignature } from "../src/modules/channels/discord/discord-signing";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { readFetchUrl } from "./helpers/fetch-request-url";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/published-agent-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

class FakeGatewaySocket implements DiscordGatewayWritableSocket {
  readonly sentFrames: string[] = [];
  closeCode: number | null = null;

  close(code?: number): void {
    this.closeCode = code ?? null;
  }

  send(data: string): void {
    this.sentFrames.push(data);
  }
}

function installDiscordIdentityFetch(): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://discord.com/api/v10/users/@me") {
      return Response.json({
        bot: true,
        id: "discord-bot-1",
        username: "mosoobot",
      });
    }

    return Response.json({
      data: [{ id: "gpt-5.4" }],
    });
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function createDiscordBindingFixture(): Promise<{
  bindingId: string;
  bindings: ApiBindings;
}> {
  const database = await createPublicHttpContractDatabase();
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const restoreFetch = installDiscordIdentityFetch();

  try {
    const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
      agentId: "01J00000000000000000000009",
      applicationId: "discord-app-1",
      botToken: "discord-token",
      relaySecret: "discord-relay-secret",
    });

    return {
      bindingId: binding.id,
      bindings,
    };
  } finally {
    restoreFetch();
  }
}

function createMessageCreateFrame(input: { sequence: number }): string {
  return JSON.stringify({
    d: {
      author: { bot: false, id: "user-1", username: "Ada" },
      channel_id: "dm-1",
      content: "review this",
      id: "message-1",
    },
    op: 0,
    s: input.sequence,
    t: "MESSAGE_CREATE",
  });
}

describe("Discord Gateway runtime owner", () => {
  test("claims the runtime lease and relays Gateway dispatches through the signed callback contract", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    let nowMs = 1_000;
    const socket = new FakeGatewaySocket();
    const relayRequests: DiscordGatewayRelayRequest[] = [];
    const owner = await DiscordGatewayRuntimeOwner.claim({
      apiBaseUrl: "https://api.mosoo.example",
      bindingId,
      bindings,
      botToken: "discord-token",
      leaseDurationMs: 60_000,
      nowMs: () => nowMs,
      ownerId: "gateway-01J00000000000000000000001",
      relayFetch: async (request) => {
        relayRequests.push(request);
        return Response.json({ accepted: true, ok: true });
      },
      relaySecret: "discord-relay-secret",
      resolveRelayChannelType: async () => 1,
      socket,
    });

    expect(owner).not.toBeNull();
    if (!owner) {
      throw new Error("Expected Discord Gateway runtime owner.");
    }

    expect(
      await readChannelConnectionOwnerSnapshot({
        bindingId,
        bindings,
        provider: "discord",
      }),
    ).toMatchObject({
      leaseExpiresAtMs: 61_000,
      leaseOwnerId: "gateway-01J00000000000000000000001",
      status: "starting",
    });

    expect(
      await owner.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 })),
    ).toBe("identified");
    expect(socket.sentFrames).toHaveLength(1);

    nowMs = 1_100;
    expect(
      await owner.handleMessage(
        JSON.stringify({
          d: { resume_gateway_url: "wss://resume.discord.example", session_id: "session-1" },
          op: 0,
          s: 7,
          t: "READY",
        }),
      ),
    ).toBe("ignored");

    nowMs = 1_200;
    expect(await owner.handleMessage(createMessageCreateFrame({ sequence: 8 }))).toBe("dispatch");
    expect(relayRequests).toHaveLength(1);
    expect(relayRequests[0]?.url).toBe(
      buildAgentChannelWebhookUrl({
        bindingId,
        origin: "https://api.mosoo.example",
        provider: "discord",
      }),
    );

    const relayRequest = relayRequests[0];
    if (!relayRequest) {
      throw new Error("Expected Discord relay request.");
    }

    await expect(
      verifyDiscordRelaySignature({
        body: relayRequest.body,
        headers: new Headers(relayRequest.headers),
        nowSeconds: 1,
        relaySecret: "discord-relay-secret",
      }),
    ).resolves.toEqual({ ok: true });

    const parsedRelayBody = parseDiscordGatewayDispatchEnvelope(relayRequest.body);
    expect(parsedRelayBody.ok).toBe(true);
    if (!parsedRelayBody.ok) {
      throw new Error("Expected relay body to parse.");
    }
    expect(parsedRelayBody.envelope.message.channelType).toBe(1);

    await expect(
      readChannelConnectionOwnerSnapshot({
        bindingId,
        bindings,
        provider: "discord",
      }),
    ).resolves.toMatchObject({
      lastInboundAtMs: 1_200,
      leaseExpiresAtMs: 61_200,
      leaseOwnerId: "gateway-01J00000000000000000000001",
      status: "running",
    });
  });

  test("rejects duplicate runtime owners before the lease expires", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const socket = new FakeGatewaySocket();

    await DiscordGatewayRuntimeOwner.claim({
      apiBaseUrl: "https://api.mosoo.example",
      bindingId,
      bindings,
      botToken: "discord-token",
      leaseDurationMs: 60_000,
      nowMs: () => 1_000,
      ownerId: "gateway-01J00000000000000000000001",
      relaySecret: "discord-relay-secret",
      resolveRelayChannelType: async () => 1,
      socket,
    });

    await expect(
      DiscordGatewayRuntimeOwner.claim({
        apiBaseUrl: "https://api.mosoo.example",
        bindingId,
        bindings,
        botToken: "discord-token",
        leaseDurationMs: 60_000,
        nowMs: () => 2_000,
        ownerId: "gateway-owner-2",
        relaySecret: "discord-relay-secret",
        resolveRelayChannelType: async () => 1,
        socket: new FakeGatewaySocket(),
      }),
    ).resolves.toBeNull();
  });

  test("records relay failures as recoverable runtime health", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    let nowMs = 1_000;
    const socket = new FakeGatewaySocket();
    const owner = await DiscordGatewayRuntimeOwner.claim({
      apiBaseUrl: "https://api.mosoo.example",
      bindingId,
      bindings,
      botToken: "discord-token",
      leaseDurationMs: 60_000,
      nowMs: () => nowMs,
      ownerId: "gateway-01J00000000000000000000001",
      relayFetch: async () => Response.json({ ok: false }, { status: 503 }),
      relaySecret: "discord-relay-secret",
      resolveRelayChannelType: async () => 1,
      socket,
    });

    expect(owner).not.toBeNull();
    if (!owner) {
      throw new Error("Expected Discord Gateway runtime owner.");
    }

    await owner.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
    nowMs = 1_200;

    await expect(owner.handleMessage(createMessageCreateFrame({ sequence: 8 }))).rejects.toThrow(
      DiscordGatewayConnectionRelayError,
    );
    expect(socket.closeCode).toBeNull();

    await expect(
      readChannelConnectionOwnerSnapshot({
        bindingId,
        bindings,
        provider: "discord",
      }),
    ).resolves.toMatchObject({
      lastErrorCode: "relay_http_503",
      status: "running",
    });
  });

  test("records Gateway protocol parse failures as reconnecting runtime health", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const owner = await DiscordGatewayRuntimeOwner.claim({
      apiBaseUrl: "https://api.mosoo.example",
      bindingId,
      bindings,
      botToken: "discord-token",
      leaseDurationMs: 60_000,
      nowMs: () => 1_000,
      ownerId: "gateway-01J00000000000000000000001",
      relaySecret: "discord-relay-secret",
      resolveRelayChannelType: async () => 1,
      socket: new FakeGatewaySocket(),
    });

    expect(owner).not.toBeNull();
    if (!owner) {
      throw new Error("Expected Discord Gateway runtime owner.");
    }

    await expect(owner.handleMessage("{")).rejects.toThrow();

    await expect(
      readChannelConnectionOwnerSnapshot({
        bindingId,
        bindings,
        provider: "discord",
      }),
    ).resolves.toMatchObject({
      lastErrorCode: "gateway_protocol_error",
      status: "reconnecting",
    });
  });
});
