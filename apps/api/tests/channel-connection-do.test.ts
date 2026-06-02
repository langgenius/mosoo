import { describe, expect, test } from "bun:test";

import { agentChannelBindingsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { readChannelConnectionOwnerSnapshot } from "../src/modules/channels/application/channel-connection-state.service";
import { runDiscordGatewayConnectionMaintenance } from "../src/modules/channels/application/discord-gateway-connection-maintenance.service";
import { parseDiscordGatewayDispatchEnvelope } from "../src/modules/channels/discord/discord-events";
import type { DiscordGatewayRelayRequest } from "../src/modules/channels/discord/discord-gateway-relay";
import type { DiscordGatewayStartResult } from "../src/modules/channels/discord/discord-gateway.do";
import { DiscordGatewayConnectionRuntimeService } from "../src/modules/channels/discord/discord-gateway.do";
import {
  FakeDurableObjectStorage,
  FakeGatewaySocket,
  STARTED_SNAPSHOT,
  createDiscordBindingFixture,
  createFakeChannelConnectionNamespace,
  createMessageCreateFrame,
  installDiscordFetch,
  readSentFrame,
  settleGatewayEvent,
} from "./channel-connection-do-fixtures";

describe("ChannelConnection Durable Object", () => {
  test("starts from a deterministic DO owner, relays enriched dispatches, and heartbeats on alarm", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const storage = new FakeDurableObjectStorage();
    const sockets: FakeGatewaySocket[] = [];
    const relayRequests: DiscordGatewayRelayRequest[] = [];
    let nowMs = 1_000;
    const restoreFetch = installDiscordFetch();
    const service = new DiscordGatewayConnectionRuntimeService(
      { storage },
      {
        ...bindings,
        MOSOO_API_BASE_URL: "https://api.mosoo.example",
      },
      {
        connectGateway(url) {
          expect(url).toBe("wss://gateway.discord.gg/?v=10&encoding=json");
          const socket = new FakeGatewaySocket();
          sockets.push(socket);
          return socket;
        },
        nowMs: () => nowMs,
        relayFetch: async (request) => {
          relayRequests.push(request);
          return Response.json({ accepted: true, ok: true });
        },
      },
    );

    try {
      await expect(service.start(bindingId)).resolves.toMatchObject({
        bindingId,
        status: "started",
      });
      expect(service.snapshot(bindingId)).toMatchObject({
        active: true,
        bindingId,
      });
      expect(storage.alarmTime).toBe(6_000);

      const socket = sockets[0];
      if (!socket) {
        throw new Error("Expected fake Discord Gateway socket.");
      }

      socket.emitMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
      await settleGatewayEvent();
      expect(readSentFrame(socket, 0)).toMatchObject({ op: 2 });
      expect(storage.alarmTime).toBe(46_000);

      nowMs = 1_100;
      socket.emitMessage(
        JSON.stringify({
          d: { resume_gateway_url: "wss://resume.discord.example", session_id: "session-1" },
          op: 0,
          s: 7,
          t: "READY",
        }),
      );
      await settleGatewayEvent();

      nowMs = 1_200;
      socket.emitMessage(createMessageCreateFrame(8));
      await settleGatewayEvent();

      expect(relayRequests).toHaveLength(1);
      const parsedRelay = parseDiscordGatewayDispatchEnvelope(relayRequests[0]?.body ?? "");
      expect(parsedRelay.ok).toBe(true);
      if (!parsedRelay.ok) {
        throw new Error("Expected relayed Discord Gateway body to parse.");
      }
      expect(parsedRelay.envelope.message.channelType).toBe(1);

      nowMs = 1_300;
      await service.alarm();
      expect(readSentFrame(socket, 1)).toEqual({ d: 8, op: 1 });

      await expect(
        readChannelConnectionOwnerSnapshot({
          bindingId,
          bindings,
          provider: "discord",
        }),
      ).resolves.toMatchObject({
        lastHeartbeatAtMs: 1_300,
        lastInboundAtMs: 1_200,
        leaseOwnerId: expect.any(String),
        status: "running",
      });
    } finally {
      restoreFetch();
    }
  });

  test("keeps the Gateway socket alive when a relay dispatch fails", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const storage = new FakeDurableObjectStorage();
    const sockets: FakeGatewaySocket[] = [];
    let nowMs = 1_000;
    const restoreFetch = installDiscordFetch();
    const service = new DiscordGatewayConnectionRuntimeService(
      { storage },
      {
        ...bindings,
        MOSOO_API_BASE_URL: "https://api.mosoo.example",
      },
      {
        connectGateway() {
          const socket = new FakeGatewaySocket();
          sockets.push(socket);
          return socket;
        },
        nowMs: () => nowMs,
        relayFetch: async () => Response.json({ ok: false }, { status: 503 }),
      },
    );

    try {
      await service.start(bindingId);
      const socket = sockets[0];
      if (!socket) {
        throw new Error("Expected fake Discord Gateway socket.");
      }

      socket.emitMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
      await settleGatewayEvent();

      nowMs = 1_200;
      socket.emitMessage(createMessageCreateFrame(8));
      await settleGatewayEvent();

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
    } finally {
      restoreFetch();
    }
  });

  test("reconnects promptly when the Gateway asks the client to reconnect", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const storage = new FakeDurableObjectStorage();
    const sockets: FakeGatewaySocket[] = [];
    let nowMs = 1_000;
    const service = new DiscordGatewayConnectionRuntimeService({ storage }, bindings, {
      connectGateway() {
        const socket = new FakeGatewaySocket();
        sockets.push(socket);
        return socket;
      },
      nowMs: () => nowMs,
      relayFetch: async () => Response.json({ accepted: true, ok: true }),
    });

    await service.start(bindingId);
    const socket = sockets[0];
    if (!socket) {
      throw new Error("Expected fake Discord Gateway socket.");
    }

    socket.emitMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
    await settleGatewayEvent();
    expect(storage.alarmTime).toBe(46_000);

    nowMs = 1_200;
    socket.emitMessage(JSON.stringify({ d: null, op: 7 }));
    await settleGatewayEvent();

    expect(socket.closeCode).toBe(4000);
    expect(storage.alarmTime).toBe(6_200);
    expect(service.snapshot(bindingId)).toEqual({
      active: false,
      bindingId: null,
      snapshot: null,
    });
    await expect(
      readChannelConnectionOwnerSnapshot({
        bindingId,
        bindings,
        provider: "discord",
      }),
    ).resolves.toMatchObject({
      status: "reconnecting",
    });
  });

  test("reconnects the Gateway connection when heartbeat ACKs stop arriving", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const storage = new FakeDurableObjectStorage();
    const sockets: FakeGatewaySocket[] = [];
    let nowMs = 1_000;
    const service = new DiscordGatewayConnectionRuntimeService({ storage }, bindings, {
      connectGateway() {
        const socket = new FakeGatewaySocket();
        sockets.push(socket);
        return socket;
      },
      nowMs: () => nowMs,
      relayFetch: async () => Response.json({ accepted: true, ok: true }),
    });

    await service.start(bindingId);
    const socket = sockets[0];
    if (!socket) {
      throw new Error("Expected fake Discord Gateway socket.");
    }

    socket.emitMessage(JSON.stringify({ d: { heartbeat_interval: 45_000 }, op: 10 }));
    await settleGatewayEvent();
    expect(storage.alarmTime).toBe(46_000);

    nowMs = 46_000;
    await service.alarm();
    expect(readSentFrame(socket, 1)).toEqual({ d: null, op: 1 });
    expect(storage.alarmTime).toBe(91_000);

    nowMs = 91_000;
    await service.alarm();

    expect(socket.closeCode).toBe(4000);
    expect(socket.closeReason).toBeString();
    expect(storage.alarmTime).toBe(96_000);
    expect(service.snapshot(bindingId)).toEqual({
      active: false,
      bindingId: null,
      snapshot: null,
    });
    await expect(
      readChannelConnectionOwnerSnapshot({
        bindingId,
        bindings,
        provider: "discord",
      }),
    ).resolves.toMatchObject({
      lastErrorCode: "heartbeat_ack_timeout",
      status: "reconnecting",
    });
  });

  test("marks Discord bindings errored and clears alarms on fatal Gateway close codes", async () => {
    const { bindingId, bindings, database } = await createDiscordBindingFixture();
    const storage = new FakeDurableObjectStorage();
    const sockets: FakeGatewaySocket[] = [];
    const restoreFetch = installDiscordFetch();
    const service = new DiscordGatewayConnectionRuntimeService({ storage }, bindings, {
      connectGateway() {
        const socket = new FakeGatewaySocket();
        sockets.push(socket);
        return socket;
      },
      nowMs: () => 1_000,
    });

    try {
      await service.start(bindingId);
      const socket = sockets[0];
      if (!socket) {
        throw new Error("Expected fake Discord Gateway socket.");
      }

      socket.emitClose(4014);
      await settleGatewayEvent();

      const binding = await database
        .app()
        .select({
          lastErrorCode: agentChannelBindingsTable.lastErrorCode,
          status: agentChannelBindingsTable.status,
        })
        .from(agentChannelBindingsTable)
        .where(eq(agentChannelBindingsTable.id, bindingId))
        .get();

      expect(binding).toEqual({
        lastErrorCode: "discord_gateway_disallowed_intents",
        status: "error",
      });
      expect(storage.alarmTime).toBeNull();
      expect(service.snapshot(bindingId)).toEqual({
        active: false,
        bindingId: null,
        snapshot: null,
      });
    } finally {
      restoreFetch();
    }
  });

  test("clears fatal close local state even when binding error persistence fails", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const storage = new FakeDurableObjectStorage();
    const sockets: FakeGatewaySocket[] = [];
    const restoreFetch = installDiscordFetch();
    const service = new DiscordGatewayConnectionRuntimeService({ storage }, bindings, {
      connectGateway() {
        const socket = new FakeGatewaySocket();
        sockets.push(socket);
        return socket;
      },
      nowMs: () => 1_000,
    });

    try {
      await service.start(bindingId);
      const socket = sockets[0];
      if (!socket) {
        throw new Error("Expected fake Discord Gateway socket.");
      }

      const originalPrepare = bindings.DB.prepare;
      bindings.DB.prepare = () => {
        throw new Error("D1 unavailable during fatal close.");
      };

      try {
        socket.emitClose(4014);
        await settleGatewayEvent();
      } finally {
        bindings.DB.prepare = originalPrepare;
      }

      expect(storage.alarmTime).toBeNull();
      expect(service.snapshot(bindingId)).toEqual({
        active: false,
        bindingId: null,
        snapshot: null,
      });
    } finally {
      restoreFetch();
    }
  });

  test("stops the active owner so alarms cannot restart a deleted binding", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const storage = new FakeDurableObjectStorage();
    const sockets: FakeGatewaySocket[] = [];
    const service = new DiscordGatewayConnectionRuntimeService({ storage }, bindings, {
      connectGateway() {
        const socket = new FakeGatewaySocket();
        sockets.push(socket);
        return socket;
      },
      nowMs: () => 1_000,
    });

    await expect(service.start(bindingId)).resolves.toMatchObject({
      bindingId,
      status: "started",
    });
    expect(service.snapshot(bindingId)).toMatchObject({
      active: true,
      bindingId,
    });

    await expect(service.stop(bindingId)).resolves.toEqual({
      bindingId,
      status: "stopped",
    });
    expect(service.snapshot(bindingId)).toEqual({
      active: false,
      bindingId: null,
      snapshot: null,
    });
    expect(storage.alarmTime).toBeNull();

    await service.alarm();
    expect(sockets).toHaveLength(1);
  });

  test("scheduled maintenance lists published active Discord bindings", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const startedBindingIds: string[] = [];
    const result = await runDiscordGatewayConnectionMaintenance(bindings, new Date(0), {
      startConnection: async (_bindings, input): Promise<DiscordGatewayStartResult> => {
        startedBindingIds.push(input.bindingId);
        return {
          bindingId: input.bindingId,
          snapshot: STARTED_SNAPSHOT,
          status: "started",
        };
      },
    });

    expect(startedBindingIds).toEqual([bindingId]);
    expect(result).toEqual({
      failed: 0,
      started: 1,
      total: 1,
    });
  });

  test("scheduled maintenance starts published active Discord bindings through the DO client boundary", async () => {
    const { bindingId, bindings } = await createDiscordBindingFixture();
    const startedBindingIds: string[] = [];
    const result = await runDiscordGatewayConnectionMaintenance(
      {
        ...bindings,
        ChannelConnection: createFakeChannelConnectionNamespace(startedBindingIds),
      },
      new Date(0),
    );

    expect(startedBindingIds).toEqual([bindingId]);
    expect(result).toEqual({
      failed: 0,
      started: 1,
      total: 1,
    });
  });
});
