import { describe, expect, test } from "bun:test";

import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";
import { apiCommandsTable, channelThreadSessionsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { registerDiscordEventsRoute } from "../src/adapters/http/routes/discord-events-route";
import type { ApiCommandMessage } from "../src/modules/api-command/application/api-command-message";
import { processApiCommandMessage } from "../src/modules/api-command/application/api-command-processor";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createDiscordAgentChannelBinding } from "../src/modules/channels/application/agent-channel-binding.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import type { ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import { readFetchUrl } from "./helpers/fetch-request-url";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createRecordedQueueMessage,
  createTestExecutionContext,
} from "./helpers/published-agent-http-test-fixture";
import type { ApiCommandQueueStub } from "./helpers/published-agent-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

function createDiscordRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();
  registerDiscordEventsRoute(publicApi);
  app.route("/api", publicApi);
  return app;
}

function createDiscordEventsUrl(bindingId: string): string {
  return buildAgentChannelWebhookUrl({
    bindingId,
    origin: "https://api.example.com",
    provider: "discord",
  });
}

function readApiCommandQueue(bindings: ApiBindings): ApiCommandQueueStub {
  return bindings.API_COMMAND_QUEUE as ApiCommandQueueStub;
}

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

async function withDiscordFetchMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (readFetchUrl(url) === "https://discord.com/api/v10/users/@me") {
      return Response.json({
        bot: true,
        id: "bot-1",
        username: "mosoobot",
      });
    }

    if (init?.method === "POST") {
      return Response.json({ id: "working-message-1" });
    }

    return Response.json({});
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withFailingDiscordMessageFetch<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalReportError = globalThis.reportError;
  globalThis.fetch = async (url, init) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://discord.com/api/v10/users/@me") {
      return Response.json({
        bot: true,
        id: "bot-1",
        username: "mosoobot",
      });
    }

    if (
      init?.method === "POST" &&
      requestUrl === "https://discord.com/api/v10/channels/dm-1/messages"
    ) {
      return Response.json({ code: 50001, message: "Missing Access" }, { status: 403 });
    }

    if (init?.method === "POST") {
      return Response.json({ id: "working-message-1" });
    }

    return Response.json({ data: [{ id: "gpt-5.4" }] });
  };
  globalThis.reportError = () => {};

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.reportError = originalReportError;
  }
}

describe("Discord channel events route", () => {
  test("rejects Discord relay dispatches when the per-binding signature mismatches", async () => {
    await withDiscordFetchMock(async () => {
      const app = createDiscordRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        applicationId: "app-1",
        botToken: "discord-token",
        relaySecret: "discord-relay-secret",
      });
      const body = JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          content: "review this",
          id: "message-1",
          relay_channel_type: 1,
        },
        op: 0,
        s: 1,
        t: "MESSAGE_CREATE",
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await app.request(
        new Request(createDiscordEventsUrl(binding.id), {
          body,
          headers: {
            "x-mosoo-discord-relay-signature": await signDiscordRelayBody({
              body,
              relaySecret: "wrong-secret",
              timestamp,
            }),
            "x-mosoo-discord-relay-timestamp": timestamp,
          },
          method: "POST",
        }),
        undefined,
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "signature_mismatch",
        ok: false,
      });
    });
  });

  test("accepts signed Discord DM MESSAGE_CREATE dispatches for a published Agent binding", async () => {
    await withDiscordFetchMock(async () => {
      const app = createDiscordRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        applicationId: "app-1",
        botToken: "discord-token",
        relaySecret: "discord-relay-secret",
      });
      const body = JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          content: "review this",
          id: "message-1",
          relay_channel_type: 1,
        },
        op: 0,
        s: 2,
        t: "MESSAGE_CREATE",
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await app.request(
        new Request(createDiscordEventsUrl(binding.id), {
          body,
          headers: {
            "x-mosoo-discord-relay-signature": await signDiscordRelayBody({
              body,
              relaySecret: "discord-relay-secret",
              timestamp,
            }),
            "x-mosoo-discord-relay-timestamp": timestamp,
          },
          method: "POST",
        }),
        undefined,
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        accepted: true,
        adapter: "discord",
        ok: true,
      });
    });
  });

  test("creates separate sessions for multiple Discord messages in the same guild channel", async () => {
    await withDiscordFetchMock(async () => {
      const app = createDiscordRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        applicationId: "app-1",
        botToken: "discord-token",
        relaySecret: "discord-relay-secret",
      });

      for (const messageId of ["message-1", "message-2"]) {
        const body = JSON.stringify({
          d: {
            author: { bot: false, id: "user-1", username: "Ada" },
            channel_id: "channel-1",
            content: `<@bot-1> review ${messageId}`,
            guild_id: "guild-1",
            id: messageId,
            relay_channel_type: 0,
          },
          op: 0,
          s: messageId === "message-1" ? 10 : 11,
          t: "MESSAGE_CREATE",
        });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const response = await app.request(
          new Request(createDiscordEventsUrl(binding.id), {
            body,
            headers: {
              "x-mosoo-discord-relay-signature": await signDiscordRelayBody({
                body,
                relaySecret: "discord-relay-secret",
                timestamp,
              }),
              "x-mosoo-discord-relay-timestamp": timestamp,
            },
            method: "POST",
          }),
          undefined,
          bindings,
          createTestExecutionContext(),
        );

        expect(response.status).toBe(200);
      }

      const channelCommandMessages = [...readApiCommandQueue(bindings).sent];
      expect(channelCommandMessages).toHaveLength(2);

      for (const entry of channelCommandMessages) {
        const recorded = createRecordedQueueMessage<ApiCommandMessage>({ body: entry.body });
        await processApiCommandMessage(bindings, recorded.message);
        expect(recorded.recorded).toEqual([{ type: "ack" }]);
      }

      const rows = await database
        .app()
        .select({
          externalThreadId: channelThreadSessionsTable.externalThreadId,
          sessionId: channelThreadSessionsTable.sessionId,
        })
        .from(channelThreadSessionsTable)
        .where(eq(channelThreadSessionsTable.bindingId, binding.id))
        .orderBy(channelThreadSessionsTable.externalThreadId)
        .all();

      expect(rows).toEqual([
        {
          externalThreadId: "guild:guild-1:channel:channel-1:message:message-1",
          sessionId: expect.any(String),
        },
        {
          externalThreadId: "guild:guild-1:channel:channel-1:message:message-2",
          sessionId: expect.any(String),
        },
      ]);
      expect(rows[0]?.sessionId).not.toBe(rows[1]?.sessionId);
    });
  });

  test("accepts Discord relay work before retrying failed trigger processing", async () => {
    await withFailingDiscordMessageFetch(async () => {
      const app = createDiscordRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        applicationId: "app-1",
        botToken: "discord-token",
        relaySecret: "discord-relay-secret",
      });
      const body = JSON.stringify({
        d: {
          author: { bot: false, id: "user-1", username: "Ada" },
          channel_id: "dm-1",
          content: "review this",
          id: "message-1",
          relay_channel_type: 1,
        },
        op: 0,
        s: 4,
        t: "MESSAGE_CREATE",
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await app.request(
        new Request(createDiscordEventsUrl(binding.id), {
          body,
          headers: {
            "x-mosoo-discord-relay-signature": await signDiscordRelayBody({
              body,
              relaySecret: "discord-relay-secret",
              timestamp,
            }),
            "x-mosoo-discord-relay-timestamp": timestamp,
          },
          method: "POST",
        }),
        undefined,
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        accepted: true,
        adapter: "discord",
        ok: true,
      });

      const queued = readApiCommandQueue(bindings).sent[0]?.body;
      if (!queued) {
        throw new Error("Expected Discord trigger command to be queued.");
      }

      const recorded = createRecordedQueueMessage<ApiCommandMessage>({ body: queued });
      await processApiCommandMessage(bindings, recorded.message);
      expect(recorded.recorded).toEqual([{ delaySeconds: 30, type: "retry" }]);

      const row = await database
        .app()
        .select({
          lastErrorCode: apiCommandsTable.lastErrorCode,
          status: apiCommandsTable.status,
        })
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, queued.commandId))
        .get();

      expect(row).toEqual({
        lastErrorCode: "discord_work_trigger_failed",
        status: "queued",
      });
    });
  });

  test("acknowledges unsupported Discord dispatches without retrying", async () => {
    await withDiscordFetchMock(async () => {
      const app = createDiscordRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        applicationId: "app-1",
        botToken: "discord-token",
        relaySecret: "discord-relay-secret",
      });
      const body = JSON.stringify({
        d: {},
        op: 0,
        s: 3,
        t: "TYPING_START",
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await app.request(
        new Request(createDiscordEventsUrl(binding.id), {
          body,
          headers: {
            "x-mosoo-discord-relay-signature": await signDiscordRelayBody({
              body,
              relaySecret: "discord-relay-secret",
              timestamp,
            }),
            "x-mosoo-discord-relay-timestamp": timestamp,
          },
          method: "POST",
        }),
        undefined,
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ignored: true, ok: true });
    });
  });
});
