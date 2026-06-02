import { describe, expect, test } from "bun:test";

import {
  normalizeDiscordGatewayWorkTrigger,
  parseDiscordGatewayDispatchEnvelope,
} from "../src/modules/channels/discord/discord-events";
import { verifyDiscordRelaySignature } from "../src/modules/channels/discord/discord-signing";

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function signDiscordRelayBody(input: {
  body: string;
  relaySecret: string;
  timestamp: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.relaySecret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`v0:${input.timestamp}:${input.body}`),
  );

  return `v0=${bytesToHex(signature)}`;
}

describe("Discord channel dispatch", () => {
  test("verifies relay signatures over the raw dispatch body", async () => {
    const body = JSON.stringify({ d: { id: "message-1" }, op: 0, s: 1, t: "MESSAGE_CREATE" });
    const timestamp = "1779646500";
    const relaySecret = "relay-secret";
    const signature = await signDiscordRelayBody({ body, relaySecret, timestamp });

    await expect(
      verifyDiscordRelaySignature({
        body,
        headers: new Headers({
          "x-mosoo-discord-relay-signature": signature,
          "x-mosoo-discord-relay-timestamp": timestamp,
        }),
        nowSeconds: 1779646500,
        relaySecret,
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      verifyDiscordRelaySignature({
        body,
        headers: new Headers({
          "x-mosoo-discord-relay-signature": signature,
          "x-mosoo-discord-relay-timestamp": timestamp,
        }),
        nowSeconds: 1779646500,
        relaySecret: "wrong-secret",
      }),
    ).resolves.toMatchObject({ code: "signature_mismatch", ok: false, status: 401 });
  });

  test("rejects malformed and stale relay timestamps", async () => {
    const body = JSON.stringify({ d: { id: "message-1" }, op: 0, s: 1, t: "MESSAGE_CREATE" });
    const relaySecret = "relay-secret";
    const timestamp = "1779646500";
    const signature = await signDiscordRelayBody({ body, relaySecret, timestamp });

    await expect(
      verifyDiscordRelaySignature({
        body,
        headers: new Headers({
          "x-mosoo-discord-relay-signature": signature,
          "x-mosoo-discord-relay-timestamp": `${timestamp}junk`,
        }),
        nowSeconds: 1779646500,
        relaySecret,
      }),
    ).resolves.toMatchObject({ code: "missing_header", ok: false, status: 400 });

    await expect(
      verifyDiscordRelaySignature({
        body,
        headers: new Headers({
          "x-mosoo-discord-relay-signature": signature,
          "x-mosoo-discord-relay-timestamp": timestamp,
        }),
        nowSeconds: 1779650101,
        relaySecret,
      }),
    ).resolves.toMatchObject({ code: "stale_timestamp", ok: false, status: 401 });
  });

  test("normalizes DM gateway messages into message-scoped thread keys", () => {
    const parsed = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          content: "review this",
          id: "message-1",
          relay_channel_type: 1,
        },
        op: 0,
        s: 42,
        t: "MESSAGE_CREATE",
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected Discord dispatch parse success.");
    }

    expect(
      normalizeDiscordGatewayWorkTrigger(parsed.envelope, {
        botUserId: "bot-1",
      }),
    ).toEqual({
      authorDisplayName: "Ada",
      authorId: "user-1",
      channelId: "dm-1",
      channelType: 1,
      eventId: "discord:message:message-1",
      externalActorId: "discord:user:user-1",
      externalMessageId: "dm-1:message-1",
      externalThreadId: "dm:dm-1:message:message-1",
      guildId: null,
      messageId: "message-1",
      text: "review this",
    });
  });

  test("requires a bot mention for guild channel messages", () => {
    const parsed = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "channel-1",
          content: "<@bot-1> review this",
          guild_id: "guild-1",
          id: "message-1",
          relay_channel_type: 0,
        },
        op: 0,
        s: 43,
        t: "MESSAGE_CREATE",
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected Discord dispatch parse success.");
    }

    expect(
      normalizeDiscordGatewayWorkTrigger(parsed.envelope, {
        botUserId: "bot-1",
      }),
    ).toMatchObject({
      externalThreadId: "guild:guild-1:channel:channel-1:message:message-1",
      text: "review this",
    });

    const unmentioned = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "channel-1",
          content: "review this",
          guild_id: "guild-1",
          id: "message-2",
          relay_channel_type: 0,
        },
        op: 0,
        s: 44,
        t: "MESSAGE_CREATE",
      }),
    );

    expect(unmentioned.ok).toBe(true);
    if (!unmentioned.ok) {
      throw new Error("Expected Discord dispatch parse success.");
    }

    expect(normalizeDiscordGatewayWorkTrigger(unmentioned.envelope, { botUserId: "bot-1" })).toBe(
      null,
    );
  });

  test("ignores bot authors and group DMs from gateway messages", () => {
    const botMessage = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: true, id: "bot-2", username: "Other Bot" },
          channel_id: "dm-1",
          content: "review this",
          id: "message-1",
          relay_channel_type: 1,
        },
        op: 0,
        s: 45,
        t: "MESSAGE_CREATE",
      }),
    );
    const groupDm = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "group-dm-1",
          content: "review this",
          id: "message-2",
          relay_channel_type: 3,
        },
        op: 0,
        s: 46,
        t: "MESSAGE_CREATE",
      }),
    );

    expect(botMessage.ok).toBe(true);
    expect(groupDm.ok).toBe(true);
    if (!botMessage.ok || !groupDm.ok) {
      throw new Error("Expected Discord dispatch parse success.");
    }

    expect(normalizeDiscordGatewayWorkTrigger(botMessage.envelope, { botUserId: "bot-1" })).toBe(
      null,
    );
    expect(normalizeDiscordGatewayWorkTrigger(groupDm.envelope, { botUserId: "bot-1" })).toBe(null);
  });

  test("drops dispatches when relay channel type enrichment is missing", () => {
    const missingChannelType = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          content: "review this",
          id: "message-1",
        },
        op: 0,
        s: 47,
        t: "MESSAGE_CREATE",
      }),
    );
    const rawGatewayChannelType = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          channel_type: 1,
          content: "review this",
          id: "message-2",
        },
        op: 0,
        s: 48,
        t: "MESSAGE_CREATE",
      }),
    );
    const rawGuildChannelType = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "channel-1",
          channel_type: 0,
          content: "<@bot-1> review this",
          guild_id: "guild-1",
          id: "message-3",
        },
        op: 0,
        s: 49,
        t: "MESSAGE_CREATE",
      }),
    );

    expect(missingChannelType.ok).toBe(true);
    expect(rawGatewayChannelType.ok).toBe(true);
    expect(rawGuildChannelType.ok).toBe(true);
    if (!missingChannelType.ok || !rawGatewayChannelType.ok || !rawGuildChannelType.ok) {
      throw new Error("Expected Discord dispatch parse success.");
    }

    expect(
      normalizeDiscordGatewayWorkTrigger(missingChannelType.envelope, { botUserId: "bot-1" }),
    ).toBe(null);
    expect(
      normalizeDiscordGatewayWorkTrigger(rawGatewayChannelType.envelope, { botUserId: "bot-1" }),
    ).toBe(null);
    expect(
      normalizeDiscordGatewayWorkTrigger(rawGuildChannelType.envelope, { botUserId: "bot-1" }),
    ).toBe(null);
  });

  test("parses empty message content but drops it before session creation", () => {
    const parsed = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          content: "",
          id: "message-1",
          relay_channel_type: 1,
        },
        op: 0,
        s: 47,
        t: "MESSAGE_CREATE",
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected Discord dispatch parse success.");
    }

    expect(normalizeDiscordGatewayWorkTrigger(parsed.envelope, { botUserId: "bot-1" })).toBe(null);
  });

  test("keeps same-channel Discord messages in separate external threads", () => {
    const first = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "channel-1",
          content: "<@bot-1> first question",
          guild_id: "guild-1",
          id: "message-1",
          relay_channel_type: 0,
        },
        op: 0,
        s: 50,
        t: "MESSAGE_CREATE",
      }),
    );
    const second = parseDiscordGatewayDispatchEnvelope(
      JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "channel-1",
          content: "<@bot-1> second question",
          guild_id: "guild-1",
          id: "message-2",
          relay_channel_type: 0,
        },
        op: 0,
        s: 51,
        t: "MESSAGE_CREATE",
      }),
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("Expected Discord dispatch parse success.");
    }

    const firstTrigger = normalizeDiscordGatewayWorkTrigger(first.envelope, { botUserId: "bot-1" });
    const secondTrigger = normalizeDiscordGatewayWorkTrigger(second.envelope, {
      botUserId: "bot-1",
    });

    expect(firstTrigger?.externalThreadId).toBe(
      "guild:guild-1:channel:channel-1:message:message-1",
    );
    expect(secondTrigger?.externalThreadId).toBe(
      "guild:guild-1:channel:channel-1:message:message-2",
    );
    expect(firstTrigger?.externalThreadId).not.toBe(secondTrigger?.externalThreadId);
  });
});
