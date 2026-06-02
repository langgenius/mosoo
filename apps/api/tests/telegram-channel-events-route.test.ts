import { describe, expect, test } from "bun:test";

import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";
import { Hono } from "hono";

import { registerTelegramEventsRoute } from "../src/adapters/http/routes/telegram-events-route";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createTelegramAgentChannelBinding } from "../src/modules/channels/application/agent-channel-binding.service";
import type { ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { readFetchUrl } from "./helpers/fetch-request-url";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
} from "./helpers/published-agent-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

function createTelegramRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();
  registerTelegramEventsRoute(publicApi);
  app.route("/api", publicApi);
  return app;
}

function createTelegramEventsUrl(bindingId: string): string {
  return buildAgentChannelWebhookUrl({
    bindingId,
    origin: "https://api.example.com",
    provider: "telegram",
  });
}

async function withTelegramFetchMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (readFetchUrl(url) === "https://api.telegram.org/bottelegram-token/getMe") {
      return Response.json({
        ok: true,
        result: {
          first_name: "Mosoo Telegram",
          id: 9001,
          is_bot: true,
          username: "mosoo_telegram_bot",
        },
      });
    }

    return Response.json({ ok: true, result: { message_id: 1 } });
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("Telegram channel events route", () => {
  test("rejects signed Telegram updates when the secret token mismatches", async () => {
    await withTelegramFetchMock(async () => {
      const app = createTelegramRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createTelegramAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "telegram-token",
        webhookSecret: "telegram-webhook-secret",
      });
      const response = await app.request(
        new Request(createTelegramEventsUrl(binding.id), {
          body: JSON.stringify({
            message: {
              chat: { id: 42, type: "private" },
              from: { first_name: "Ada", id: 42, is_bot: false },
              message_id: 77,
              text: "review this",
            },
            update_id: 1,
          }),
          headers: {
            "x-telegram-bot-api-secret-token": "wrong-secret",
          },
          method: "POST",
        }),
        undefined,
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "secret_mismatch",
        ok: false,
      });
    });
  });

  test("accepts signed Telegram message updates for a published Agent binding", async () => {
    await withTelegramFetchMock(async () => {
      const app = createTelegramRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createTelegramAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "telegram-token",
        webhookSecret: "telegram-webhook-secret",
      });
      const response = await app.request(
        new Request(createTelegramEventsUrl(binding.id), {
          body: JSON.stringify({
            message: {
              chat: { id: 42, type: "private" },
              from: { first_name: "Ada", id: 42, is_bot: false },
              message_id: 77,
              text: "review this",
            },
            update_id: 2,
          }),
          headers: {
            "x-telegram-bot-api-secret-token": "telegram-webhook-secret",
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
        adapter: "telegram",
        ok: true,
      });
    });
  });

  test("acknowledges unsupported Telegram update shapes without retrying", async () => {
    await withTelegramFetchMock(async () => {
      const app = createTelegramRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createTelegramAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "telegram-token",
        webhookSecret: "telegram-webhook-secret",
      });
      const response = await app.request(
        new Request(createTelegramEventsUrl(binding.id), {
          body: JSON.stringify({
            callback_query: {
              id: "callback-1",
            },
            update_id: 3,
          }),
          headers: {
            "x-telegram-bot-api-secret-token": "telegram-webhook-secret",
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
