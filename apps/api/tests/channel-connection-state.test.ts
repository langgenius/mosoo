import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createDiscordAgentChannelBinding } from "../src/modules/channels/application/agent-channel-binding.service";
import {
  claimChannelConnectionOwner,
  readChannelConnectionOwnerSnapshot,
  releaseChannelConnectionOwner,
  renewChannelConnectionOwnerLease,
} from "../src/modules/channels/application/channel-connection-state.service";
import type { DiscordGatewayWritableSocket } from "../src/modules/channels/discord/discord-gateway-client";
import { DiscordGatewayClient } from "../src/modules/channels/discord/discord-gateway-client";
import {
  createDiscordGatewayRuntimeStatePayload,
  parseDiscordGatewayResumeStateFromRuntimeState,
} from "../src/modules/channels/discord/discord-gateway-runtime-state";
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

  close(): void {}

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

async function readRuntimeStateJson(bindings: ApiBindings, bindingId: string): Promise<string> {
  const row = await bindings.DB.prepare(
    "select runtime_state_json from channel_runtime_state where binding_id = ?",
  )
    .bind(bindingId)
    .first<{ runtime_state_json: string }>();

  if (!row) {
    throw new Error("Expected channel connection state row.");
  }

  return row.runtime_state_json;
}

describe("channel connection state", () => {
  test("claims one runtime owner per provider binding until the lease expires", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();

    const firstClaim = await claimChannelConnectionOwner({
      bindingId,
      bindings,
      leaseDurationMs: 30_000,
      nowMs: 1000,
      ownerId: "owner-a",
      provider: "discord",
    });

    expect(firstClaim).toMatchObject({
      key: {
        accountId: null,
        bindingId,
        provider: "discord",
      },
      leaseExpiresAtMs: 31_000,
      leaseOwnerId: "owner-a",
      status: "starting",
    });

    await expect(
      claimChannelConnectionOwner({
        bindingId,
        bindings,
        leaseDurationMs: 30_000,
        nowMs: 2000,
        ownerId: "owner-b",
        provider: "discord",
      }),
    ).resolves.toBeNull();

    await expect(
      renewChannelConnectionOwnerLease({
        bindingId,
        bindings,
        leaseDurationMs: 30_000,
        nowMs: 31_000,
        ownerId: "owner-a",
        provider: "discord",
        state: {
          status: "running",
          statusChangedAtMs: 31_000,
        },
      }),
    ).resolves.toBeNull();

    const takeover = await claimChannelConnectionOwner({
      bindingId,
      bindings,
      leaseDurationMs: 30_000,
      nowMs: 31_000,
      ownerId: "owner-b",
      provider: "discord",
    });

    expect(takeover).toMatchObject({
      leaseExpiresAtMs: 61_000,
      leaseOwnerId: "owner-b",
      status: "starting",
    });
  });

  test("renews only the current owner and persists Discord Gateway health fields", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    let nowMs = 10_000;
    const socket = new FakeGatewaySocket();
    const client = new DiscordGatewayClient({
      nowMs: () => nowMs,
      onDispatch() {},
      socket,
      token: "discord-token",
    });

    client.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
    nowMs = 10_100;
    client.handleMessage(
      JSON.stringify({
        d: { resume_gateway_url: "wss://resume.discord.example", session_id: "session-1" },
        op: 0,
        s: 7,
        t: "READY",
      }),
    );
    nowMs = 10_200;
    client.handleMessage(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          content: "review this",
          id: "message-1",
          relay_channel_type: 1,
        },
        op: 0,
        s: 8,
        t: "MESSAGE_CREATE",
      }),
    );
    nowMs = 10_300;
    client.handleMessage(JSON.stringify({ d: null, op: 11 }));

    const claimed = await claimChannelConnectionOwner({
      bindingId,
      bindings,
      leaseDurationMs: 60_000,
      nowMs,
      ownerId: "gateway-01J00000000000000000000001",
      provider: "discord",
      state: createDiscordGatewayRuntimeStatePayload(client.getSnapshot()),
    });

    expect(claimed).toMatchObject({
      lastHeartbeatAtMs: 10_300,
      lastInboundAtMs: 10_200,
      leaseExpiresAtMs: 70_300,
      leaseOwnerId: "gateway-01J00000000000000000000001",
      status: "running",
      statusChangedAtMs: 10_000,
    });

    await expect(
      renewChannelConnectionOwnerLease({
        bindingId,
        bindings,
        leaseDurationMs: 60_000,
        nowMs: 20_000,
        ownerId: "gateway-owner-2",
        provider: "discord",
        state: createDiscordGatewayRuntimeStatePayload(client.getSnapshot()),
      }),
    ).resolves.toBeNull();

    const renewed = await renewChannelConnectionOwnerLease({
      bindingId,
      bindings,
      leaseDurationMs: 60_000,
      nowMs: 20_000,
      ownerId: "gateway-01J00000000000000000000001",
      provider: "discord",
      state: createDiscordGatewayRuntimeStatePayload(client.getSnapshot()),
    });

    expect(renewed).toMatchObject({
      leaseExpiresAtMs: 80_000,
      leaseOwnerId: "gateway-01J00000000000000000000001",
      status: "running",
      statusChangedAtMs: 10_000,
    });

    const runtimeStateJson = await readRuntimeStateJson(bindings, bindingId);
    expect(parseDiscordGatewayResumeStateFromRuntimeState(runtimeStateJson)).toEqual({
      resumeGatewayUrl: "wss://resume.discord.example",
      sequence: 8,
      sessionId: "session-1",
    });
  });

  test("releases only the current owner and keeps the last observable state readable", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();

    await claimChannelConnectionOwner({
      bindingId,
      bindings,
      leaseDurationMs: 30_000,
      nowMs: 1000,
      ownerId: "owner-a",
      provider: "discord",
      state: {
        lastErrorCode: "socket_closed",
        status: "reconnecting",
        statusChangedAtMs: 1000,
      },
    });

    await expect(
      releaseChannelConnectionOwner({
        bindingId,
        bindings,
        nowMs: 2000,
        ownerId: "owner-b",
        provider: "discord",
      }),
    ).resolves.toBeNull();

    const released = await releaseChannelConnectionOwner({
      bindingId,
      bindings,
      nowMs: 2000,
      ownerId: "owner-a",
      provider: "discord",
    });

    expect(released).toMatchObject({
      lastErrorCode: "socket_closed",
      leaseExpiresAtMs: null,
      leaseOwnerId: null,
      status: "stopped",
    });

    await expect(
      readChannelConnectionOwnerSnapshot({
        bindingId,
        bindings,
        provider: "discord",
      }),
    ).resolves.toMatchObject({
      status: "stopped",
    });
  });

  test("does not parse incomplete Discord Gateway resume state", async () => {
    expect(parseDiscordGatewayResumeStateFromRuntimeState("{}")).toBeNull();
    expect(parseDiscordGatewayResumeStateFromRuntimeState("{")).toBeNull();
    expect(
      parseDiscordGatewayResumeStateFromRuntimeState(
        JSON.stringify({
          resumeGatewayUrl: "wss://resume.discord.example",
          sequence: null,
          sessionId: "session-1",
          status: "connected",
          statusChangedAtMs: 1000,
        }),
      ),
    ).toBeNull();
  });
});
