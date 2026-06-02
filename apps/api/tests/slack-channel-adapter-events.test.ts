import { describe, expect, test } from "bun:test";

import {
  normalizeSlackWorkTrigger,
  parseSlackEventsEnvelope,
} from "../src/modules/channels/slack/slack-events";
import { verifySlackSignature } from "../src/modules/channels/slack/slack-signing";

async function signSlackBody(input: {
  body: string;
  signingSecret: string;
  timestamp: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.signingSecret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`v0:${input.timestamp}:${input.body}`),
  );

  return `v0=${[...new Uint8Array(signature)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function buildSignedSlackHeaders(input: {
  body: string;
  signingSecret: string;
  timestamp: string;
}): Promise<Headers> {
  return new Headers({
    "x-slack-request-timestamp": input.timestamp,
    "x-slack-signature": await signSlackBody(input),
  });
}

function requireEventCallback(body: string) {
  const parsed = parseSlackEventsEnvelope(body);
  expect(parsed.ok).toBe(true);

  if (!parsed.ok || parsed.envelope.type !== "event_callback") {
    throw new Error("Expected Slack event_callback envelope.");
  }

  return parsed.envelope;
}

describe("Slack channel events", () => {
  test("verifies signatures against the raw request body", async () => {
    const body = JSON.stringify({ challenge: "ok", type: "url_verification" });
    const timestamp = "1779646500";
    const signingSecret = "slack-signing-secret";
    const headers = await buildSignedSlackHeaders({ body, signingSecret, timestamp });

    await expect(
      verifySlackSignature({
        body,
        headers,
        nowSeconds: Number(timestamp),
        signingSecret,
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      verifySlackSignature({
        body,
        headers,
        nowSeconds: Number(timestamp),
        signingSecret: "wrong-secret",
      }),
    ).resolves.toMatchObject({ code: "signature_mismatch", ok: false, status: 401 });
  });

  test("normalizes app_mention and strips leading bot mentions", () => {
    const envelope = requireEventCallback(
      JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "C123",
          text: "<@U-BOT> <@U-OTHER> summarize this",
          ts: "1700000000.000100",
          type: "app_mention",
          user: "U-ALICE",
        },
        event_id: "Ev1",
        team_id: "T123",
        type: "event_callback",
      }),
    );

    expect(normalizeSlackWorkTrigger(envelope)).toEqual({
      botUserId: "U-BOT",
      channelId: "C123",
      enterpriseId: null,
      eventId: "Ev1",
      isEnterpriseInstall: false,
      messageTs: "1700000000.000100",
      requiresExistingSession: false,
      teamId: "T123",
      text: "summarize this",
      threadTs: "1700000000.000100",
      triggerType: "app_mention",
      userId: "U-ALICE",
    });
  });

  test("normalizes direct messages as channel thread anchors", () => {
    const envelope = requireEventCallback(
      JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "D123",
          channel_type: "im",
          text: "help me",
          thread_ts: "1700000000.000050",
          ts: "1700000000.000100",
          type: "message",
          user: "U-ALICE",
        },
        event_id: "Ev2",
        team_id: "T123",
        type: "event_callback",
      }),
    );

    expect(normalizeSlackWorkTrigger(envelope)).toMatchObject({
      botUserId: "U-BOT",
      channelId: "D123",
      enterpriseId: null,
      eventId: "Ev2",
      isEnterpriseInstall: false,
      requiresExistingSession: false,
      text: "help me",
      threadTs: "1700000000.000050",
      triggerType: "dm_message",
      userId: "U-ALICE",
    });
  });

  test("normalizes supported events without text so the adapter can write fallback copy", () => {
    const appMentionEnvelope = requireEventCallback(
      JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "C123",
          text: "",
          ts: "1700000000.000100",
          type: "app_mention",
          user: "U-ALICE",
        },
        event_id: "Ev3",
        team_id: "T123",
        type: "event_callback",
      }),
    );
    const dmEnvelope = requireEventCallback(
      JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "D123",
          channel_type: "im",
          ts: "1700000000.000200",
          type: "message",
          user: "U-ALICE",
        },
        event_id: "Ev4",
        team_id: "T123",
        type: "event_callback",
      }),
    );

    expect(normalizeSlackWorkTrigger(appMentionEnvelope)).toMatchObject({
      eventId: "Ev3",
      requiresExistingSession: false,
      text: "",
      triggerType: "app_mention",
    });
    expect(normalizeSlackWorkTrigger(dmEnvelope)).toMatchObject({
      eventId: "Ev4",
      requiresExistingSession: false,
      text: "",
      triggerType: "dm_message",
    });
  });

  test("normalizes channel thread replies as existing-session-only triggers", () => {
    const envelope = requireEventCallback(
      JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "C123",
          channel_type: "channel",
          text: "yes, continue",
          thread_ts: "1700000000.000100",
          ts: "1700000000.000200",
          type: "message",
          user: "U-ALICE",
        },
        event_id: "Ev-thread-reply",
        team_id: "T123",
        type: "event_callback",
      }),
    );

    expect(normalizeSlackWorkTrigger(envelope)).toMatchObject({
      channelId: "C123",
      eventId: "Ev-thread-reply",
      requiresExistingSession: true,
      text: "yes, continue",
      threadTs: "1700000000.000100",
      triggerType: "channel_thread_message",
      userId: "U-ALICE",
    });
  });

  test("ignores channel thread message copies when the bot is explicitly mentioned", () => {
    const envelope = requireEventCallback(
      JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "C123",
          channel_type: "channel",
          text: "<@U-BOT> yes, continue",
          thread_ts: "1700000000.000100",
          ts: "1700000000.000200",
          type: "message",
          user: "U-ALICE",
        },
        event_id: "Ev-thread-reply-message-copy",
        team_id: "T123",
        type: "event_callback",
      }),
    );

    expect(normalizeSlackWorkTrigger(envelope)).toBeNull();
  });

  test("ignores top-level channel messages without mentions", () => {
    const envelope = requireEventCallback(
      JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "C123",
          channel_type: "channel",
          text: "ambient channel chatter",
          ts: "1700000000.000300",
          type: "message",
          user: "U-ALICE",
        },
        event_id: "Ev-top-level-channel-message",
        team_id: "T123",
        type: "event_callback",
      }),
    );

    expect(normalizeSlackWorkTrigger(envelope)).toBeNull();
  });
});
