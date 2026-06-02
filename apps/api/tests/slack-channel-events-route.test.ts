import { describe, expect, test } from "bun:test";

import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";
import { agentsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { registerSlackEventsRoute } from "../src/adapters/http/routes/slack-events-route";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createSlackAgentChannelBinding } from "../src/modules/channels/application/agent-channel-binding.service";
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
const SLACK_EVENTS_URL = buildAgentChannelWebhookUrl({
  origin: "https://api.example.com",
  provider: "slack",
});

function createSlackRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();
  registerSlackEventsRoute(publicApi);
  app.route("/api", publicApi);
  return app;
}

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

async function withSlackAuthTestMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (readFetchUrl(url) === "https://slack.com/api/auth.test") {
      return Response.json({
        ok: true,
        team: "Growth HQ",
        team_id: "T123",
        user: "mosoobot",
        user_id: "U-BOT",
      });
    }

    return originalFetch(url);
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("Slack channel events route", () => {
  test("mounts url verification at /api/v1/channels/slack/events", async () => {
    const app = createSlackRouteTestApp();
    const database = await createPublicHttpContractDatabase();
    const response = await app.request(
      new Request(SLACK_EVENTS_URL, {
        body: JSON.stringify({ challenge: "challenge-ok", type: "url_verification" }),
        method: "POST",
      }),
      undefined,
      createPublicHttpTestBindings(database),
      createTestExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-ok");
  });

  test("verifies event_callback with the per-binding signing secret", async () => {
    await withSlackAuthTestMock(async () => {
      const app = createSlackRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "xoxb-secret-token",
        signingSecret: "signing-secret",
      });
      const body = JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "C123",
          text: "<@U-BOT> review this",
          ts: "1700000000.000100",
          type: "app_mention",
          user: "U-ALICE",
        },
        event_id: "Ev-route",
        team_id: "T123",
        type: "event_callback",
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await app.request(
        new Request(SLACK_EVENTS_URL, {
          body,
          headers: {
            "x-slack-request-timestamp": timestamp,
            "x-slack-signature": await signSlackBody({
              body,
              signingSecret: "wrong-secret",
              timestamp,
            }),
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

  test("acks malformed Slack retries with missing event_id", async () => {
    const app = createSlackRouteTestApp();
    const database = await createPublicHttpContractDatabase();
    const response = await app.request(
      new Request(SLACK_EVENTS_URL, {
        body: JSON.stringify({
          authorizations: [{ user_id: "U-BOT" }],
          event: {
            channel: "C123",
            text: "<@U-BOT> review this",
            ts: "1700000000.000100",
            type: "app_mention",
            user: "U-ALICE",
          },
          team_id: "T123",
          type: "event_callback",
        }),
        method: "POST",
      }),
      undefined,
      createPublicHttpTestBindings(database),
      createTestExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ignored: true,
      ok: true,
    });
  });

  test("acks unsupported Slack outer events", async () => {
    const app = createSlackRouteTestApp();
    const database = await createPublicHttpContractDatabase();
    const response = await app.request(
      new Request(SLACK_EVENTS_URL, {
        body: JSON.stringify({
          minute_rate_limited: 1,
          team_id: "T123",
          type: "app_rate_limited",
        }),
        method: "POST",
      }),
      undefined,
      createPublicHttpTestBindings(database),
      createTestExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ignored: true,
      ok: true,
    });
  });

  test("acks and drops signed events when the bound agent is no longer published", async () => {
    await withSlackAuthTestMock(async () => {
      const app = createSlackRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "xoxb-secret-token",
        signingSecret: "signing-secret",
      });
      await database
        .app()
        .update(agentsTable)
        .set({ status: "draft" })
        .where(eq(agentsTable.id, "01J00000000000000000000009"))
        .run();
      const body = JSON.stringify({
        authorizations: [{ user_id: "U-BOT" }],
        event: {
          channel: "C123",
          text: "<@U-BOT> review this",
          ts: "1700000000.000100",
          type: "app_mention",
          user: "U-ALICE",
        },
        event_id: "Ev-unpublished",
        team_id: "T123",
        type: "event_callback",
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await app.request(
        new Request(SLACK_EVENTS_URL, {
          body,
          headers: {
            "x-slack-request-timestamp": timestamp,
            "x-slack-signature": await signSlackBody({
              body,
              signingSecret: "signing-secret",
              timestamp,
            }),
          },
          method: "POST",
        }),
        undefined,
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ignored: true,
        ok: true,
      });
    });
  });
});
