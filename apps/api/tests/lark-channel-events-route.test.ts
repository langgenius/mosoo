import { describe, expect, test } from "bun:test";

import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";
import { agentChannelBindingsTable } from "@mosoo/db";
import { Hono } from "hono";

import { registerLarkEventsRoute } from "../src/adapters/http/routes/lark-events-route";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createLarkAgentChannelBinding } from "../src/modules/channels/application/agent-channel-binding.service";
import { storeAgentChannelBindingCredentialSecret } from "../src/modules/channels/application/channel-credential-secret-resolution";
import { serializeLarkCredentials } from "../src/modules/channels/lark/lark-credentials";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import type { ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
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

function createLarkRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();
  registerLarkEventsRoute(publicApi);
  app.route("/api", publicApi);
  return app;
}

function createLarkEventsUrl(bindingId: string): string {
  return buildAgentChannelWebhookUrl({
    bindingId,
    origin: "https://api.example.com",
    provider: "lark",
  });
}

async function signLarkBody(input: {
  body: string;
  encryptKey: string;
  nonce: string;
  timestamp: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input.timestamp + input.nonce + input.encryptKey + input.body);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function currentLarkTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function encryptLarkBody(input: { body: string; encryptKey: string }): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(input.encryptKey));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
    "encrypt",
  ]);
  const iv = new Uint8Array(16);
  iv.set([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3]);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ iv, name: "AES-CBC" }, key, encoder.encode(input.body)),
  );
  const output = new Uint8Array(iv.length + encrypted.length);
  output.set(iv, 0);
  output.set(encrypted, iv.length);

  return bytesToBase64(output);
}

async function withLarkFetchMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
      return Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      });
    }

    if (requestUrl === "https://open.feishu.cn/open-apis/bot/v3/info") {
      return Response.json({
        code: 0,
        bot: {
          app_name: "Mosoo Feishu",
          open_id: "ou_bot",
        },
      });
    }

    return Response.json({ code: 0, data: {} });
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("Lark channel events route", () => {
  test("answers signed Lark url_verification challenges for a binding", async () => {
    await withLarkFetchMock(async () => {
      const app = createLarkRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        appId: "cli_a",
        appSecret: "app-secret",
        connectionMode: "webhook",
        domain: "feishu",
        encryptKey: "encrypt-key",
        verificationToken: "verification-token",
      });
      const body = JSON.stringify({
        challenge: "challenge-ok",
        token: "verification-token",
        type: "url_verification",
      });
      const timestamp = currentLarkTimestamp();
      const nonce = "nonce-1";
      const response = await app.request(
        new Request(createLarkEventsUrl(binding.id), {
          body,
          headers: {
            "x-lark-request-nonce": nonce,
            "x-lark-request-timestamp": timestamp,
            "x-lark-signature": await signLarkBody({
              body,
              encryptKey: "encrypt-key",
              nonce,
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
      expect(await response.json()).toEqual({ challenge: "challenge-ok" });
    });
  });

  test("decrypts encrypted Lark url_verification callbacks before token validation", async () => {
    await withLarkFetchMock(async () => {
      const app = createLarkRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        appId: "cli_a",
        appSecret: "app-secret",
        connectionMode: "webhook",
        domain: "feishu",
        encryptKey: "encrypt-key",
        verificationToken: "verification-token",
      });
      const encrypted = await encryptLarkBody({
        body: JSON.stringify({
          challenge: "encrypted-challenge-ok",
          token: "verification-token",
          type: "url_verification",
        }),
        encryptKey: "encrypt-key",
      });
      const body = JSON.stringify({ encrypt: encrypted });
      const timestamp = currentLarkTimestamp();
      const nonce = "nonce-1";
      const response = await app.request(
        new Request(createLarkEventsUrl(binding.id), {
          body,
          headers: {
            "x-lark-request-nonce": nonce,
            "x-lark-request-timestamp": timestamp,
            "x-lark-signature": await signLarkBody({
              body,
              encryptKey: "encrypt-key",
              nonce,
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
      expect(await response.json()).toEqual({ challenge: "encrypted-challenge-ok" });
    });
  });

  test("rejects Lark callbacks when the per-binding signature mismatches", async () => {
    await withLarkFetchMock(async () => {
      const app = createLarkRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        appId: "cli_a",
        appSecret: "app-secret",
        connectionMode: "webhook",
        domain: "feishu",
        encryptKey: "encrypt-key",
        verificationToken: "verification-token",
      });
      const body = JSON.stringify({
        challenge: "challenge-ok",
        token: "verification-token",
        type: "url_verification",
      });
      const timestamp = currentLarkTimestamp();
      const nonce = "nonce-1";
      const response = await app.request(
        new Request(createLarkEventsUrl(binding.id), {
          body,
          headers: {
            "x-lark-request-nonce": nonce,
            "x-lark-request-timestamp": timestamp,
            "x-lark-signature": await signLarkBody({
              body,
              encryptKey: "wrong-key",
              nonce,
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

  test("rejects Lark callbacks with incomplete signature headers", async () => {
    await withLarkFetchMock(async () => {
      const app = createLarkRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        appId: "cli_a",
        appSecret: "app-secret",
        connectionMode: "webhook",
        domain: "feishu",
        encryptKey: "encrypt-key",
        verificationToken: "verification-token",
      });
      const body = JSON.stringify({
        challenge: "challenge-ok",
        token: "verification-token",
        type: "url_verification",
      });
      const response = await app.request(
        new Request(createLarkEventsUrl(binding.id), {
          body,
          headers: {
            "x-lark-signature": "partial-signature",
          },
          method: "POST",
        }),
        undefined,
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "missing_header",
        ok: false,
      });
    });
  });

  test("rejects Lark callbacks without signature headers", async () => {
    await withLarkFetchMock(async () => {
      const app = createLarkRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        appId: "cli_a",
        appSecret: "app-secret",
        connectionMode: "webhook",
        domain: "feishu",
        encryptKey: "encrypt-key",
        verificationToken: "verification-token",
      });
      const body = JSON.stringify({
        challenge: "challenge-ok",
        token: "verification-token",
        type: "url_verification",
      });
      const response = await app.request(
        new Request(createLarkEventsUrl(binding.id), {
          body,
          method: "POST",
        }),
        undefined,
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "missing_header",
        ok: false,
      });
    });
  });

  test("rejects Lark callbacks with stale signature timestamps", async () => {
    await withLarkFetchMock(async () => {
      const app = createLarkRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        appId: "cli_a",
        appSecret: "app-secret",
        connectionMode: "webhook",
        domain: "feishu",
        encryptKey: "encrypt-key",
        verificationToken: "verification-token",
      });
      const body = JSON.stringify({
        challenge: "challenge-ok",
        token: "verification-token",
        type: "url_verification",
      });
      const timestamp = "1";
      const nonce = "nonce-1";
      const response = await app.request(
        new Request(createLarkEventsUrl(binding.id), {
          body,
          headers: {
            "x-lark-request-nonce": nonce,
            "x-lark-request-timestamp": timestamp,
            "x-lark-signature": await signLarkBody({
              body,
              encryptKey: "encrypt-key",
              nonce,
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
        code: "stale_timestamp",
        ok: false,
      });
    });
  });

  test("acknowledges webhook callbacks for legacy websocket-mode bindings", async () => {
    await withLarkFetchMock(async () => {
      const app = createLarkRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const bindingId = "01J00000000000000000000100";
      const secretId = await storeAgentChannelBindingCredentialSecret(bindings, {
        agentId: "01J00000000000000000000009",
        credentialsJson: serializeLarkCredentials({
          appId: "cli_a",
          appSecret: "app-secret",
          connectionMode: "websocket",
          domain: "feishu",
          encryptKey: null,
          verificationToken: null,
        }),
        organizationId: "01J00000000000000000000006",
        provider: "lark",
        purpose: "channel_binding_create",
      });
      await database
        .app()
        .insert(agentChannelBindingsTable)
        .values({
          agentId: "01J00000000000000000000009",
          createdAt: Date.now(),
          displayMetadataJson: "{}",
          encryptedCredsSecretId: secretId,
          externalBotId: "ou_bot",
          externalTenantId: "feishu:cli_a",
          id: bindingId,
          lastErrorCode: null,
          provider: "lark",
          status: "active",
          updatedAt: Date.now(),
        })
        .run();
      const response = await app.request(
        new Request(createLarkEventsUrl(bindingId), {
          body: JSON.stringify({ ignored: "unsigned-webhook-body" }),
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

  test("acknowledges unsupported signed Lark event types without retrying", async () => {
    await withLarkFetchMock(async () => {
      const app = createLarkRouteTestApp();
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        appId: "cli_a",
        appSecret: "app-secret",
        connectionMode: "webhook",
        domain: "feishu",
        encryptKey: "encrypt-key",
        verificationToken: "verification-token",
      });
      const body = JSON.stringify({
        event: {},
        header: {
          event_id: "unsupported-event",
          event_type: "contact.user.created_v3",
          tenant_key: "tenant-key",
          token: "verification-token",
        },
      });
      const timestamp = currentLarkTimestamp();
      const nonce = "nonce-1";
      const response = await app.request(
        new Request(createLarkEventsUrl(binding.id), {
          body,
          headers: {
            "x-lark-request-nonce": nonce,
            "x-lark-request-timestamp": timestamp,
            "x-lark-signature": await signLarkBody({
              body,
              encryptKey: "encrypt-key",
              nonce,
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
      expect(await response.json()).toEqual({ ignored: true, ok: true });
    });
  });
});
