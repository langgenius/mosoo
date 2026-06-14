import { describe, expect, test } from "bun:test";

import {
  agentChannelBindingsTable,
  vaultSecretsTable,
  wechatChannelAccountsTable,
  wechatChannelPairingsTable,
  wechatContextTokensTable,
} from "@mosoo/db";
import { count, eq } from "drizzle-orm";

import {
  deleteAgentChannelBinding,
  listAgentChannelBindings,
  pollWeChatAgentChannelPairing,
  startWeChatAgentChannelPairing,
} from "../src/modules/channels/application/agent-channel-binding.service";
import { createWeChatContextTokenStoreKey } from "../src/modules/channels/wechat/wechat-runtime";
import {
  createWeChatPollingOwnerDatabaseStore,
  persistConfirmedWeChatQrPairing,
  readWeChatChannelAccountWithCredentials,
  readWeChatContextTokenForPeer,
} from "../src/modules/channels/wechat/wechat-runtime-store";
import { readSecretOutcome, storeSecret } from "../src/modules/mcp/application/mcp-secret-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { isApiError } from "../src/platform/errors";
import {
  OWNER_VIEWER,
  WECHAT_QR_WAIT_RESPONSE,
  insertSecondLiveAgent,
  withWeChatQrMock,
} from "./agent-channel-binding-fixtures";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

describe("agent channel WeChat bindings", () => {
  test("starts and confirms Personal WeChat QR pairing into a channel binding", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;

        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });

        expect(started).toEqual({
          binding: null,
          lastErrorCode: null,
          qrCodeImageSrc: "data:image/png;base64,wechat-qr",
          qrToken: "wechat-qr-token",
          status: "qr_pending",
        });

        const confirmed = await pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          qrToken: "wechat-qr-token",
        });

        expect(JSON.stringify(confirmed)).not.toContain("wechat-bot-secret");
        expect(confirmed).toMatchObject({
          lastErrorCode: null,
          qrCodeImageSrc: null,
          qrToken: "wechat-qr-token",
          status: "confirmed",
        });
        expect(confirmed.binding).toMatchObject({
          agentId: "01J00000000000000000000009",
          displayMetadata: {
            ilink_bot_id: "wechat-bot-1",
            ilink_user_id: "wechat-account-1",
          },
          externalBotId: "wechat-bot-1",
          externalTenantId: "wechat-account-1",
          provider: "wechat",
          status: "active",
        });
        expect(JSON.stringify(confirmed.binding?.displayMetadata)).not.toContain(
          "01J00000000000000000000001",
        );

        const bindingId = confirmed.binding?.id ?? "";
        const account = await database
          .app()
          .select()
          .from(wechatChannelAccountsTable)
          .where(eq(wechatChannelAccountsTable.id, bindingId))
          .get();
        expect(account).toMatchObject({
          agentId: "01J00000000000000000000009",
          externalAccountId: "wechat-account-1",
          externalBotId: "wechat-bot-1",
          ownerAccountId: "01J00000000000000000000001",
          status: "idle",
        });

        const bindingRow = await database
          .app()
          .select()
          .from(agentChannelBindingsTable)
          .where(eq(agentChannelBindingsTable.id, bindingId))
          .get();
        expect(JSON.stringify(bindingRow)).not.toContain("wechat-bot-secret");
        expect(JSON.stringify(account)).not.toContain("wechat-bot-secret");

        const pairingRow = await database.app().select().from(wechatChannelPairingsTable).get();
        expect(pairingRow).toMatchObject({
          agentId: "01J00000000000000000000009",
          consumedAt: expect.any(Number),
          createdByAccountId: "01J00000000000000000000001",
        });
        expect(pairingRow?.qrTokenHash).not.toBe("wechat-qr-token");

        if (!bindingId) {
          throw new Error("Expected confirmed WeChat QR pairing to create a binding.");
        }

        const accountWithCredentials = await readWeChatChannelAccountWithCredentials(bindings, {
          accountId: bindingId,
        });
        expect(accountWithCredentials?.credentials).toEqual({
          baseUrl: "https://ilinkai.weixin.qq.com",
          botToken: "wechat-bot-secret",
          ilinkBotId: "wechat-bot-1",
          ilinkUserId: "wechat-account-1",
        });

        await expect(
          listAgentChannelBindings(database, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            appId: PUBLIC_API_TEST_IDS.app,
          }),
        ).resolves.toMatchObject([
          {
            externalBotId: "wechat-bot-1",
            externalTenantId: "wechat-account-1",
            provider: "wechat",
            status: "active",
          },
        ]);
      },
    });
  });

  test("reads WeChat context tokens only through the owning account and peer", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });
        const confirmed = await pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          qrToken: started.qrToken ?? "",
        });
        const bindingId = confirmed.binding?.id;

        if (!bindingId) {
          throw new Error("Expected confirmed WeChat QR pairing to create a binding.");
        }

        const store = createWeChatPollingOwnerDatabaseStore(bindings);
        const contextTokenKey = createWeChatContextTokenStoreKey({
          accountId: "wechat-account-1",
          bindingId,
          peerId: "peer-1",
        });
        await store.writeContextToken({
          accountId: "wechat-account-1",
          bindingId,
          contextTokenKey,
          contextTokenValue: "wechat-context-secret",
          peerId: "peer-1",
          toUserId: "peer-to-user-1",
          updatedAtMs: 1779646500000,
        });

        await expect(
          readWeChatContextTokenForPeer(bindings, {
            accountId: bindingId,
            peerId: "peer-1",
          }),
        ).resolves.toMatchObject({
          contextToken: "wechat-context-secret",
        });
        const contextTokenRow = await database
          .app()
          .select({
            secretId: wechatContextTokensTable.encryptedContextTokenSecretId,
          })
          .from(wechatContextTokensTable)
          .where(eq(wechatContextTokensTable.accountId, bindingId))
          .get();

        if (!contextTokenRow) {
          throw new Error("Expected WeChat context token row.");
        }

        const unrelatedSecretId = await storeSecret(database, bindings, {
          kind: "test_unrelated_context_token",
          value: "wrong-peer-secret",
        });
        await database
          .app()
          .update(wechatContextTokensTable)
          .set({ encryptedContextTokenSecretId: unrelatedSecretId })
          .where(eq(wechatContextTokensTable.accountId, bindingId))
          .run();

        await expect(
          readWeChatContextTokenForPeer(bindings, {
            accountId: bindingId,
            peerId: "peer-1",
          }),
        ).rejects.toThrow();

        await database
          .app()
          .update(wechatContextTokensTable)
          .set({ encryptedContextTokenSecretId: contextTokenRow.secretId })
          .where(eq(wechatContextTokensTable.accountId, bindingId))
          .run();
        await database
          .app()
          .delete(vaultSecretsTable)
          .where(eq(vaultSecretsTable.id, contextTokenRow.secretId))
          .run();

        await expect(
          readWeChatContextTokenForPeer(bindings, {
            accountId: bindingId,
            peerId: "peer-1",
          }),
        ).rejects.toThrow();
      },
    });
  });

  test("cleans up replaced Personal WeChat credential secrets", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });
        const confirmed = await pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          qrToken: started.qrToken ?? "",
        });
        const bindingId = confirmed.binding?.id;

        if (!bindingId) {
          throw new Error("Expected confirmed WeChat QR pairing to create a binding.");
        }

        const oldBindingRow = await database
          .app()
          .select()
          .from(agentChannelBindingsTable)
          .where(eq(agentChannelBindingsTable.id, bindingId))
          .get();

        if (!oldBindingRow) {
          throw new Error("Expected WeChat binding row.");
        }

        await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          snapshot: {
            accountId: null,
            baseUrl: "https://ilinkai.weixin.qq.com",
            botToken: "wechat-bot-secret-2",
            expiresAtMs: null,
            ilinkBotId: "wechat-bot-1",
            ilinkUserId: "wechat-account-1",
            lastErrorCode: null,
            qrCodeImageSrc: null,
            qrToken: "wechat-qr-token-2",
            status: "confirmed",
          },
        });

        const newBindingRow = await database
          .app()
          .select()
          .from(agentChannelBindingsTable)
          .where(eq(agentChannelBindingsTable.id, bindingId))
          .get();

        if (!newBindingRow) {
          throw new Error("Expected updated WeChat binding row.");
        }

        expect(newBindingRow.encryptedCredsSecretId).not.toBe(oldBindingRow.encryptedCredsSecretId);
        await expect(
          readWeChatChannelAccountWithCredentials(bindings, { accountId: bindingId }),
        ).resolves.toMatchObject({
          credentials: {
            botToken: "wechat-bot-secret-2",
          },
        });

        await expect(
          readSecretOutcome(database, bindings, oldBindingRow.encryptedCredsSecretId),
        ).resolves.toMatchObject({ status: "missing" });
        await expect(
          readSecretOutcome(database, bindings, newBindingRow.encryptedCredsSecretId),
        ).resolves.toMatchObject({ status: "found" });
      },
    });
  });

  test("rejects a new Personal WeChat QR setup when the Agent already has a binding", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });

        await pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          qrToken: started.qrToken ?? "",
        });

        let caughtError: unknown = null;

        try {
          await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            appId: PUBLIC_API_TEST_IDS.app,
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected duplicate WeChat binding to surface as ApiError.");
        }

        expect(caughtError.code).toBe("AGENT_CHANNEL_BINDING_ALREADY_EXISTS");
        expect(caughtError.status).toBe(400);
      },
    });
  });

  test("rejects Personal WeChat QR polling when the token was started for another Agent", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        await insertSecondLiveAgent(database);

        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });
        let caughtError: unknown = null;

        try {
          await pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
            agentId: "01J00000000000000000000068",
            appId: PUBLIC_API_TEST_IDS.app,
            qrToken: started.qrToken ?? "",
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected cross-Agent WeChat QR poll to surface as ApiError.");
        }

        expect(caughtError.code).toBe("WECHAT_QR_PAIRING_NOT_FOUND");
        expect(caughtError.status).toBe(400);

        const bindingCount = await database
          .app()
          .select({ count: count() })
          .from(agentChannelBindingsTable)
          .where(eq(agentChannelBindingsTable.provider, "wechat"))
          .get();
        expect(bindingCount?.count).toBe(0);
      },
    });
  });

  test("maps Personal WeChat iLink HTTP failures as upstream setup failures", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        let caughtError: unknown = null;

        try {
          await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            appId: PUBLIC_API_TEST_IDS.app,
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected WeChat iLink HTTP failure to surface as ApiError.");
        }

        expect(caughtError.code).toBe("WECHAT_QR_START_FAILED");
        expect(caughtError.status).toBe(502);
      },
      qrBody: { error: "temporarily unavailable" },
      qrResponseInit: { status: 503, statusText: "Service Unavailable" },
    });
  });

  test("redacts Personal WeChat QR token from upstream status failures", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });
        let caughtError: unknown = null;

        try {
          await pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            appId: PUBLIC_API_TEST_IDS.app,
            qrToken: started.qrToken ?? "",
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected WeChat iLink status failure to surface as ApiError.");
        }

        expect(caughtError.code).toBe("WECHAT_QR_STATUS_FAILED");
        expect(caughtError.status).toBe(502);
        expect(caughtError.message).not.toContain(started.qrToken ?? "");
      },
      qrStatusBody: { error: "temporarily unavailable" },
      qrStatusResponseInit: { status: 503, statusText: "Service Unavailable" },
    });
  });

  test("maps Personal WeChat iLink timeouts as upstream setup failures", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        let caughtError: unknown = null;

        try {
          await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            appId: PUBLIC_API_TEST_IDS.app,
          });
        } catch (error) {
          caughtError = error;
        }

        expect(isApiError(caughtError)).toBe(true);
        if (!isApiError(caughtError)) {
          throw new Error("Expected WeChat iLink timeout to surface as ApiError.");
        }

        expect(caughtError.code).toBe("WECHAT_QR_START_FAILED");
        expect(caughtError.status).toBe(502);
      },
      qrError: new DOMException("The operation timed out.", "TimeoutError"),
    });
  });

  test("does not persist Personal WeChat credentials while QR pairing is still pending", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });

        const pending = await pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          qrToken: started.qrToken ?? "",
        });

        expect(pending).toEqual({
          binding: null,
          lastErrorCode: null,
          qrCodeImageSrc: null,
          qrToken: "wechat-qr-token",
          status: "qr_pending",
        });

        const bindingCount = await database
          .app()
          .select({ count: count() })
          .from(agentChannelBindingsTable)
          .where(eq(agentChannelBindingsTable.provider, "wechat"))
          .get();

        expect(bindingCount?.count).toBe(0);

        const pairingRow = await database.app().select().from(wechatChannelPairingsTable).get();
        expect(pairingRow).toMatchObject({
          agentId: "01J00000000000000000000009",
          consumedAt: null,
          createdByAccountId: "01J00000000000000000000001",
        });
        expect(pairingRow?.qrTokenHash).not.toBe(started.qrToken);
      },
      qrStatusBody: WECHAT_QR_WAIT_RESPONSE,
    });
  });

  test("consumes Personal WeChat QR pairing when the QR code expires", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });

        await expect(
          pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
            agentId: PUBLIC_API_TEST_IDS.agent,
            appId: PUBLIC_API_TEST_IDS.app,
            qrToken: started.qrToken ?? "",
          }),
        ).resolves.toMatchObject({
          binding: null,
          lastErrorCode: "qr_expired",
          qrToken: "wechat-qr-token",
          status: "expired",
        });

        const pairingRow = await database.app().select().from(wechatChannelPairingsTable).get();
        expect(pairingRow).toMatchObject({
          agentId: "01J00000000000000000000009",
          consumedAt: expect.any(Number),
          createdByAccountId: "01J00000000000000000000001",
        });
      },
      qrStatusBody: { status: "expired" },
    });
  });

  test("deletes Personal WeChat runtime rows with the binding", async () => {
    await withWeChatQrMock({
      operation: async () => {
        const database = await createPublicHttpContractDatabase();
        const bindings = createPublicHttpTestBindings(database) as ApiBindings;
        const started = await startWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        });
        const confirmed = await pollWeChatAgentChannelPairing(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          qrToken: started.qrToken ?? "",
        });
        const bindingId = confirmed.binding?.id;

        if (!bindingId) {
          throw new Error("Expected confirmed WeChat QR pairing to create a binding.");
        }

        const store = createWeChatPollingOwnerDatabaseStore(bindings);
        await store.writeContextToken({
          accountId: "wechat-account-1",
          bindingId,
          contextTokenKey: createWeChatContextTokenStoreKey({
            accountId: "wechat-account-1",
            bindingId,
            peerId: "peer-1",
          }),
          contextTokenValue: "wechat-context-secret",
          peerId: "peer-1",
          toUserId: "peer-to-user-1",
          updatedAtMs: 1779646500000,
        });

        const contextRowsBefore = await database
          .app()
          .select({ count: count() })
          .from(wechatContextTokensTable)
          .where(eq(wechatContextTokensTable.accountId, bindingId))
          .get();
        expect(contextRowsBefore?.count).toBe(1);

        await deleteAgentChannelBinding(bindings, OWNER_VIEWER, {
          bindingId,
          appId: PUBLIC_API_TEST_IDS.app,
        });

        const bindingCount = await database
          .app()
          .select({ count: count() })
          .from(agentChannelBindingsTable)
          .where(eq(agentChannelBindingsTable.id, bindingId))
          .get();
        const accountCount = await database
          .app()
          .select({ count: count() })
          .from(wechatChannelAccountsTable)
          .where(eq(wechatChannelAccountsTable.id, bindingId))
          .get();
        const contextTokenCount = await database
          .app()
          .select({ count: count() })
          .from(wechatContextTokensTable)
          .where(eq(wechatContextTokensTable.accountId, bindingId))
          .get();

        expect(bindingCount?.count).toBe(0);
        expect(accountCount?.count).toBe(0);
        expect(contextTokenCount?.count).toBe(0);
      },
    });
  });
});
