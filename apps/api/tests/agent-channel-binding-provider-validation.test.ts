import { describe, expect, test } from "bun:test";

import { agentChannelBindingsTable } from "@mosoo/db";
import { count, eq } from "drizzle-orm";

import { recordAgentChannelBindingError } from "../src/modules/channels/application/agent-channel-binding-error";
import {
  createDiscordAgentChannelBinding,
  createLarkAgentChannelBinding,
  createSlackAgentChannelBinding,
  createTelegramAgentChannelBinding,
  listAgentChannelBindings,
  pollLarkAgentChannelRegistration,
  startLarkAgentChannelRegistration,
} from "../src/modules/channels/application/agent-channel-binding.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { isApiError } from "../src/platform/errors";
import {
  OWNER_VIEWER,
  SLACK_AUTH_TEST_OK_RESPONSE,
  withDiscordCurrentUserMock,
  withLarkIdentityMock,
  withLarkRegistrationMock,
  withSlackAuthTestMock,
  withTelegramGetMeMock,
} from "./agent-channel-binding-fixtures";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

describe("agent channel provider validation", () => {
  test("starts and polls Lark / Feishu app registration for scan-to-create prefill", async () => {
    await withLarkRegistrationMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;

        const started = await startLarkAgentChannelRegistration(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          domain: "feishu",
          appId: PUBLIC_API_TEST_IDS.app,
        });

        expect(started).toMatchObject({
          appId: null,
          appSecret: null,
          deviceCode: "lark-device-code",
          domain: "feishu",
          expireIn: 600,
          interval: 5,
          qrUrl:
            "https://accounts.feishu.cn/app-registration?device_code=1&from=mosoo_channel_setup&tp=ob_cli_app",
          status: "qr_pending",
          userCode: "ABCD-EFGH",
        });

        const polled = await pollLarkAgentChannelRegistration(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          deviceCode: started.deviceCode ?? "",
          domain: "feishu",
          appId: PUBLIC_API_TEST_IDS.app,
        });

        expect(polled).toMatchObject({
          appId: "cli_lark_scan",
          appSecret: "lark-scan-secret",
          domain: "lark",
          lastErrorCode: null,
          openId: "ou_lark_owner",
          status: "confirmed",
        });
      },
    });
  });
  test("returns validation error when Slack auth.test rejects credentials", async () => {
    await withSlackAuthTestMock(
      async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        let caughtError: unknown = null;

        try {
          await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            botToken: "xoxb-invalid-token",
            appId: PUBLIC_API_TEST_IDS.app,
            signingSecret: "signing-secret",
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected Slack auth.test failure to surface as ApiError.");
        }

        expect(caughtError.code).toBe("SLACK_AUTH_TEST_FAILED");
        expect(caughtError.status).toBe(400);
      },
      { error: "invalid_auth", ok: false },
    );
  });

  test("returns validation error before Slack auth.test when required credentials are blank", async () => {
    let authTestCallCount = 0;
    await withSlackAuthTestMock(
      async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        const scenarios = [
          {
            botToken: "   ",
            signingSecret: "signing-secret",
          },
          {
            botToken: "xoxb-secret-token",
            signingSecret: "   ",
          },
        ] as const;

        for (const scenario of scenarios) {
          let caughtError: unknown = null;

          try {
            await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
              agentId: PUBLIC_API_TEST_IDS.agent,
              botToken: scenario.botToken,
              appId: PUBLIC_API_TEST_IDS.app,
              signingSecret: scenario.signingSecret,
            });
          } catch (error) {
            caughtError = error;
          }

          expect(isApiError(caughtError)).toBe(true);
          if (!isApiError(caughtError)) {
            throw new Error("Expected blank Slack credential to surface as ApiError.");
          }

          expect(caughtError.code).toBe("VALIDATION_FAILED");
          expect(caughtError.status).toBe(400);
        }
      },
      SLACK_AUTH_TEST_OK_RESPONSE,
      () => {
        authTestCallCount += 1;
      },
    );

    expect(authTestCallCount).toBe(0);
  });

  test("returns validation error when Slack is already connected to the Agent", async () => {
    await withSlackAuthTestMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;

      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-secret-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "signing-secret",
      });

      let caughtError: unknown = null;

      try {
        await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          botToken: "xoxb-secret-token",
          appId: PUBLIC_API_TEST_IDS.app,
          signingSecret: "signing-secret",
        });
      } catch (error) {
        caughtError = error;
      }

      expect(isApiError(caughtError)).toBe(true);
      if (!isApiError(caughtError)) {
        throw new Error("Expected duplicate Slack binding to surface as ApiError.");
      }

      expect(caughtError.code).toBe("AGENT_CHANNEL_BINDING_ALREADY_EXISTS");
      expect(caughtError.status).toBe(400);
    });
  });

  test("returns validation error when the Slack app is already connected elsewhere", async () => {
    await withSlackAuthTestMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const nowMs = 1_778_000_000_000;

      await database
        .app()
        .insert(agentChannelBindingsTable)
        .values({
          agentId: "other-agent",
          createdAt: nowMs,
          displayMetadataJson: "{}",
          encryptedCredsSecretId: "existing-secret",
          externalBotId: "U-BOT",
          externalTenantId: "T123",
          id: "existing-binding",
          lastErrorCode: null,
          appId: PUBLIC_API_TEST_IDS.app,
          provider: "slack",
          status: "active",
          updatedAt: nowMs,
        })
        .run();

      let caughtError: unknown = null;

      try {
        await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          botToken: "xoxb-secret-token",
          appId: PUBLIC_API_TEST_IDS.app,
          signingSecret: "signing-secret",
        });
      } catch (error) {
        caughtError = error;
      }

      expect(isApiError(caughtError)).toBe(true);
      if (!isApiError(caughtError)) {
        throw new Error("Expected duplicate Slack app binding to surface as ApiError.");
      }

      expect(caughtError.code).toBe("SLACK_APP_BOUND");
      expect(caughtError.status).toBe(400);
    });
  });

  test("moves Slack bindings to error status", async () => {
    await withSlackAuthTestMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-secret-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "signing-secret",
      });

      await recordAgentChannelBindingError(database, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        bindingId: binding.id,
        errorCode: "invalid_auth",
        appId: PUBLIC_API_TEST_IDS.app,
      });

      await expect(
        listAgentChannelBindings(database, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          id: binding.id,
          lastErrorCode: "invalid_auth",
          status: "error",
        }),
      ]);
    });
  });

  test("returns validation error when Lark identity validation rejects credentials", async () => {
    await withLarkIdentityMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        let caughtError: unknown = null;

        try {
          await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            larkAppId: "cli-invalid",
            appSecret: "invalid-secret",
            connectionMode: "webhook",
            domain: "feishu",
            encryptKey: "lark-encrypt-key",
            appId: PUBLIC_API_TEST_IDS.app,
            verificationToken: "lark-verification-token",
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected Lark auth failure to surface as ApiError.");
        }

        expect(caughtError.code).toBe("LARK_AUTH_TEST_FAILED");
        expect(caughtError.status).toBe(400);
      },
      tenantAccessTokenBody: {
        code: 99991663,
        msg: "invalid app_secret",
      },
    });
  });

  test("rejects new Lark WebSocket bindings while the sidecar path is disabled", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    let caughtError: unknown = null;

    try {
      await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        larkAppId: "cli_a",
        appSecret: "app-secret",
        connectionMode: "websocket",
        domain: "feishu",
        encryptKey: null,
        appId: PUBLIC_API_TEST_IDS.app,
        verificationToken: null,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(isApiError(caughtError)).toBe(true);
    if (!isApiError(caughtError)) {
      throw new Error("Expected Lark WebSocket mode to surface as ApiError.");
    }

    expect(caughtError.code).toBe("LARK_CONNECTION_MODE_INVALID");
    expect(caughtError.status).toBe(400);
  });

  test("returns validation error when Telegram getMe rejects credentials", async () => {
    await withTelegramGetMeMock(
      async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        let caughtError: unknown = null;

        try {
          await createTelegramAgentChannelBinding(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            botToken: "telegram-token",
            appId: PUBLIC_API_TEST_IDS.app,
            webhookSecret: "telegram-webhook-secret",
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected Telegram auth failure to surface as ApiError.");
        }

        expect(caughtError.code).toBe("TELEGRAM_AUTH_TEST_FAILED");
        expect(caughtError.status).toBe(400);
      },
      {
        description: "Unauthorized",
        ok: false,
      },
    );
  });

  test("returns validation error when Discord credentials do not resolve to a bot user", async () => {
    await withDiscordCurrentUserMock(
      async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        let caughtError: unknown = null;

        try {
          await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            applicationId: "discord-app-1",
            botToken: "discord-user-token",
            appId: PUBLIC_API_TEST_IDS.app,
            relaySecret: "relay-secret",
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected Discord non-bot credentials to surface as ApiError.");
        }

        expect(caughtError.code).toBe("DISCORD_AUTH_TEST_NOT_BOT");
        expect(caughtError.status).toBe(400);
      },
      {
        bot: false,
        id: "discord-user-1",
        username: "human",
      },
    );
  });
});
