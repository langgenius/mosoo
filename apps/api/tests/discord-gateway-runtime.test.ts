import { describe, expect, test } from "bun:test";

import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";

import type { DiscordGatewayDispatchEnvelope } from "../src/modules/channels/discord/discord-events";
import { parseDiscordGatewayDispatchEnvelope } from "../src/modules/channels/discord/discord-events";
import type { DiscordGatewayWritableSocket } from "../src/modules/channels/discord/discord-gateway-client";
import {
  DISCORD_GATEWAY_DEFAULT_INTENTS,
  DiscordGatewayClient,
} from "../src/modules/channels/discord/discord-gateway-client";
import { summarizeDiscordGatewayHealth } from "../src/modules/channels/discord/discord-gateway-health";
import {
  buildDiscordGatewayRelayBody,
  createDiscordGatewayRelayRequest,
} from "../src/modules/channels/discord/discord-gateway-relay";
import { verifyDiscordRelaySignature } from "../src/modules/channels/discord/discord-signing";

class FakeGatewaySocket implements DiscordGatewayWritableSocket {
  readonly sentFrames: string[] = [];
  closeCode: number | null = null;
  closeReason: string | null = null;

  close(code?: number, reason?: string): void {
    this.closeCode = code ?? null;
    this.closeReason = reason ?? null;
  }

  send(data: string): void {
    this.sentFrames.push(data);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSentFrame(socket: FakeGatewaySocket, index: number): Record<string, unknown> {
  const frame = socket.sentFrames.at(index);

  if (!frame) {
    throw new Error(`Expected gateway frame at index ${index}.`);
  }

  const parsed: unknown = JSON.parse(frame);

  if (!isRecord(parsed)) {
    throw new Error("Expected sent gateway frame to be a JSON object.");
  }

  return parsed;
}

function createMessageCreateEnvelope(): DiscordGatewayDispatchEnvelope {
  const parsed = parseDiscordGatewayDispatchEnvelope(
    JSON.stringify({
      d: {
        author: { bot: false, id: "user-1", username: "Ada" },
        channel_id: "dm-1",
        content: "review this",
        id: "message-1",
      },
      op: 0,
      s: 42,
      t: "MESSAGE_CREATE",
    }),
  );

  if (!parsed.ok) {
    throw new Error("Expected Discord dispatch parse success.");
  }

  return parsed.envelope;
}

describe("Discord gateway runtime scaffold", () => {
  test("identifies on HELLO and sends heartbeats with the latest sequence", () => {
    let nowMs = 1000;
    const socket = new FakeGatewaySocket();
    const client = new DiscordGatewayClient({
      nowMs: () => nowMs,
      onDispatch() {},
      socket,
      token: "discord-token",
    });

    expect(
      client.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 })),
    ).toBe("identified");
    expect(readSentFrame(socket, 0)).toEqual({
      d: {
        intents: DISCORD_GATEWAY_DEFAULT_INTENTS,
        properties: {
          browser: "mosoo",
          device: "mosoo",
          os: "cloudflare",
        },
        token: "discord-token",
      },
      op: 2,
    });

    nowMs = 1200;
    expect(
      client.handleMessage(
        JSON.stringify({
          d: { session_id: "session-1", resume_gateway_url: "wss://resume.example" },
          op: 0,
          s: 7,
          t: "READY",
        }),
      ),
    ).toBe("ignored");
    client.sendHeartbeat();

    expect(readSentFrame(socket, 1)).toEqual({ d: 7, op: 1 });
    expect(client.getSnapshot()).toMatchObject({
      heartbeatIntervalMs: 45_000,
      lastHeartbeatSentAtMs: 1200,
      resumeGatewayUrl: "wss://resume.example",
      sequence: 7,
      sessionId: "session-1",
      status: "connected",
    });
  });

  test("resumes when HELLO arrives with a previous session", () => {
    const socket = new FakeGatewaySocket();
    const client = new DiscordGatewayClient({
      nowMs: () => 2000,
      onDispatch() {},
      resumeState: {
        resumeGatewayUrl: "wss://resume.example",
        sequence: 99,
        sessionId: "session-1",
      },
      socket,
      token: "discord-token",
    });

    expect(
      client.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 })),
    ).toBe("resumed");
    expect(readSentFrame(socket, 0)).toEqual({
      d: {
        seq: 99,
        session_id: "session-1",
        token: "discord-token",
      },
      op: 6,
    });
  });

  test("identifies instead of sending invalid Resume frames when resume state is incomplete", () => {
    const socket = new FakeGatewaySocket();
    const client = new DiscordGatewayClient({
      nowMs: () => 2000,
      onDispatch() {},
      resumeState: {
        resumeGatewayUrl: null,
        sequence: null,
        sessionId: "session-1",
      },
      socket,
      token: "discord-token",
    });

    expect(
      client.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 })),
    ).toBe("identified");
    expect(readSentFrame(socket, 0)).toMatchObject({
      d: {
        token: "discord-token",
      },
      op: 2,
    });
    expect(client.getSnapshot()).toMatchObject({
      resumeGatewayUrl: null,
      sequence: null,
      sessionId: null,
      status: "connected",
    });
  });

  test("preserves reconnecting status after expected Gateway reconnect closes", () => {
    const socket = new FakeGatewaySocket();
    const client = new DiscordGatewayClient({
      nowMs: () => 3000,
      onDispatch() {},
      socket,
      token: "discord-token",
    });

    client.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));

    expect(client.handleMessage(JSON.stringify({ d: null, op: 7 }))).toBe("reconnect_requested");
    expect(client.getSnapshot()).toMatchObject({
      lastCloseCode: 4000,
      status: "reconnecting",
    });

    client.handleClose(4000);
    expect(client.getSnapshot()).toMatchObject({
      lastCloseCode: 4000,
      status: "reconnecting",
    });
  });

  test("marks connecting and reconnecting gateway snapshots stale", () => {
    const socket = new FakeGatewaySocket();
    const client = new DiscordGatewayClient({
      nowMs: () => 1000,
      onDispatch() {},
      socket,
      token: "discord-token",
    });

    expect(
      summarizeDiscordGatewayHealth(client.getSnapshot(), {
        nowMs: 20_000,
        staleAfterMs: 10_000,
      }),
    ).toEqual({
      reason: "connecting_stale",
      stale: true,
      status: "stale",
    });

    client.handleError("socket_error");

    expect(
      summarizeDiscordGatewayHealth(client.getSnapshot(), {
        nowMs: 20_000,
        staleAfterMs: 10_000,
      }),
    ).toEqual({
      reason: "socket_error",
      stale: true,
      status: "stale",
    });
  });

  test("rejects dispatches without a sequence instead of clearing resume state", () => {
    let nowMs = 3000;
    const socket = new FakeGatewaySocket();
    const dispatches: DiscordGatewayDispatchEnvelope[] = [];
    const client = new DiscordGatewayClient({
      nowMs: () => nowMs,
      onDispatch(dispatch) {
        dispatches.push(dispatch);
      },
      resumeState: {
        resumeGatewayUrl: "wss://resume.example",
        sequence: 99,
        sessionId: "session-1",
      },
      socket,
      token: "discord-token",
    });

    client.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
    nowMs = 3100;
    expect(
      client.handleMessage(
        JSON.stringify({
          d: {
            author: { bot: false, id: "user-1", username: "Ada" },
            channel_id: "dm-1",
            content: "review this",
            id: "message-1",
          },
          op: 0,
          s: null,
          t: "MESSAGE_CREATE",
        }),
      ),
    ).toBe("protocol_error");

    expect(dispatches).toEqual([]);
    expect(socket.closeCode).toBe(4000);
    expect(client.getSnapshot()).toMatchObject({
      lastErrorCode: "missing_dispatch_sequence",
      resumeGatewayUrl: "wss://resume.example",
      sequence: 99,
      sessionId: "session-1",
      status: "reconnecting",
    });
  });

  test("dispatches MESSAGE_CREATE and keeps runtime health observable", () => {
    let nowMs = 3000;
    const socket = new FakeGatewaySocket();
    const dispatches: DiscordGatewayDispatchEnvelope[] = [];
    const client = new DiscordGatewayClient({
      nowMs: () => nowMs,
      onDispatch(dispatch) {
        dispatches.push(dispatch);
      },
      socket,
      token: "discord-token",
    });

    client.handleMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
    nowMs = 3100;
    client.handleMessage(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          content: "review this",
          id: "message-1",
        },
        op: 0,
        s: 42,
        t: "MESSAGE_CREATE",
      }),
    );
    nowMs = 3200;
    expect(client.handleMessage(JSON.stringify({ d: null, op: 11 }))).toBe("heartbeat_ack");

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.message.id).toBe("message-1");
    expect(
      summarizeDiscordGatewayHealth(client.getSnapshot(), {
        nowMs: 3500,
        staleAfterMs: 10_000,
      }),
    ).toEqual({
      reason: null,
      stale: false,
      status: "connected",
    });
    expect(
      summarizeDiscordGatewayHealth(client.getSnapshot(), {
        nowMs: 30_000,
        staleAfterMs: 10_000,
      }),
    ).toEqual({
      reason: "heartbeat_ack_stale",
      stale: true,
      status: "stale",
    });
  });

  test("builds signed relay requests that the existing Discord route verifier accepts", async () => {
    const envelope = createMessageCreateEnvelope();
    const body = buildDiscordGatewayRelayBody({
      envelope,
      relayChannelType: 1,
    });
    const parsed = parseDiscordGatewayDispatchEnvelope(body);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected relay body to parse.");
    }

    expect(parsed.envelope.message.channelType).toBe(1);

    const request = await createDiscordGatewayRelayRequest({
      apiBaseUrl: "https://api.example.com/",
      bindingId: "binding-1",
      envelope,
      nowSeconds: 1779646500,
      relayChannelType: 1,
      relaySecret: "relay-secret",
    });

    expect(request.url).toBe(
      buildAgentChannelWebhookUrl({
        bindingId: "binding-1",
        origin: "https://api.example.com/",
        provider: "discord",
      }),
    );
    await expect(
      verifyDiscordRelaySignature({
        body: request.body,
        headers: new Headers(request.headers),
        nowSeconds: 1779646500,
        relaySecret: "relay-secret",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
