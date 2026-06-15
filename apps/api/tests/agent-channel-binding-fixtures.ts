import { expect } from "bun:test";

import { agentDeploymentVersionsTable, agentsTable } from "@mosoo/db";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { readFetchUrl } from "./helpers/fetch-request-url";
import type { createPublicHttpContractDatabase } from "./helpers/public-api-http-test-fixture";
import { PUBLIC_API_TEST_IDS } from "./helpers/public-api-http-test-fixture";
import { nowMsForTest } from "./helpers/public-api-http-test-fixture";

export const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

export const EXTERNAL_VIEWER: AuthenticatedViewer = {
  email: "external@example.com",
  emailVerified: true,
  id: "01J00000000000000000000003",
  imageUrl: null,
  name: "External Viewer",
};

export const SLACK_AUTH_TEST_OK_RESPONSE = {
  ok: true,
  team: "Growth HQ",
  team_id: "T123",
  user: "mosoobot",
  user_id: "U-BOT",
} as const;

const DISCORD_CURRENT_BOT_USER_OK_RESPONSE = {
  bot: true,
  id: "discord-bot-1",
  username: "mosoobot",
} as const;

const LARK_TENANT_ACCESS_TOKEN_OK_RESPONSE = {
  code: 0,
  data: { tenant_access_token: "tenant-token" },
  msg: "ok",
} as const;

const LARK_BOT_INFO_OK_RESPONSE = {
  code: 0,
  data: {
    bot: {
      app_name: "Mosoo Bot",
      open_id: "lark-bot-open-id",
    },
  },
  msg: "ok",
} as const;

const LARK_APP_REGISTRATION_BEGIN_OK_RESPONSE = {
  device_code: "lark-device-code",
  expire_in: 600,
  interval: 5,
  user_code: "ABCD-EFGH",
  verification_uri_complete: "https://accounts.feishu.cn/app-registration?device_code=1",
} as const;

const LARK_APP_REGISTRATION_INIT_OK_RESPONSE = {
  nonce: "nonce-1",
  supported_auth_methods: ["client_secret"],
} as const;

const LARK_APP_REGISTRATION_POLL_OK_RESPONSE = {
  client_id: "cli_lark_scan",
  client_secret: "lark-scan-secret",
  user_info: {
    open_id: "ou_lark_owner",
    tenant_brand: "lark",
  },
} as const;

const TELEGRAM_GET_ME_OK_RESPONSE = {
  ok: true,
  result: {
    first_name: "Mosoo",
    id: 12345,
    username: "mosoo_bot",
  },
} as const;

const WECHAT_QR_OK_RESPONSE = {
  qrcode: "wechat-qr-token",
  qrcode_img_content: "data:image/png;base64,wechat-qr",
} as const;

export const WECHAT_QR_WAIT_RESPONSE = {
  status: "wait",
} as const;

const WECHAT_QR_CONFIRMED_RESPONSE = {
  baseurl: "https://ilinkai.weixin.qq.com/",
  bot_token: "wechat-bot-secret",
  ilink_bot_id: "wechat-bot-1",
  ilink_user_id: "wechat-account-1",
  status: "confirmed",
} as const;

export async function withSlackAuthTestMock<T>(
  operation: () => Promise<T>,
  responseBody: unknown = SLACK_AUTH_TEST_OK_RESPONSE,
  onAuthTest?: () => void,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (readFetchUrl(url) === "https://slack.com/api/auth.test") {
      onAuthTest?.();
      return Response.json(responseBody);
    }

    return originalFetch(url);
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function withLarkIdentityMock<T>(input: {
  botInfoBody?: unknown;
  operation: () => Promise<T>;
  tenantAccessTokenBody?: unknown;
}): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = readFetchUrl(url);

    if (
      requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" ||
      requestUrl === "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
    ) {
      return Response.json(input.tenantAccessTokenBody ?? LARK_TENANT_ACCESS_TOKEN_OK_RESPONSE);
    }

    if (
      requestUrl === "https://open.feishu.cn/open-apis/bot/v3/info" ||
      requestUrl === "https://open.larksuite.com/open-apis/bot/v3/info"
    ) {
      return Response.json(input.botInfoBody ?? LARK_BOT_INFO_OK_RESPONSE);
    }

    return originalFetch(url);
  };

  try {
    return await input.operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function withLarkRegistrationMock<T>(input: {
  beginBody?: unknown;
  initBody?: unknown;
  operation: () => Promise<T>;
  pollBody?: unknown;
}): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const requestUrl = readFetchUrl(url);

    if (
      requestUrl === "https://accounts.feishu.cn/oauth/v1/app/registration" ||
      requestUrl === "https://accounts.larksuite.com/oauth/v1/app/registration"
    ) {
      const body = typeof init?.body === "string" ? init.body : "";
      const action = new URLSearchParams(body).get("action");

      if (action === "init") {
        return Response.json(input.initBody ?? LARK_APP_REGISTRATION_INIT_OK_RESPONSE);
      }

      if (action === "begin") {
        return Response.json(input.beginBody ?? LARK_APP_REGISTRATION_BEGIN_OK_RESPONSE);
      }

      if (action === "poll") {
        return Response.json(input.pollBody ?? LARK_APP_REGISTRATION_POLL_OK_RESPONSE);
      }
    }

    return originalFetch(url);
  };

  try {
    return await input.operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function withTelegramGetMeMock<T>(
  operation: () => Promise<T>,
  responseBody: unknown = TELEGRAM_GET_ME_OK_RESPONSE,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (readFetchUrl(url) === "https://api.telegram.org/bottelegram-token/getMe") {
      return Response.json(responseBody, {
        status: isTelegramOkResponse(responseBody) ? 200 : 401,
        statusText: isTelegramOkResponse(responseBody) ? "OK" : "Unauthorized",
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

export async function withDiscordCurrentUserMock<T>(
  operation: () => Promise<T>,
  responseBody: unknown = DISCORD_CURRENT_BOT_USER_OK_RESPONSE,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (readFetchUrl(url) === "https://discord.com/api/v10/users/@me") {
      return Response.json(responseBody);
    }

    return originalFetch(url);
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function withWeChatQrMock<T>(input: {
  onQr?: () => void;
  onQrStatus?: () => void;
  operation: () => Promise<T>;
  qrBody?: unknown;
  qrError?: unknown;
  qrResponseInit?: ResponseInit;
  qrStatusBody?: unknown;
  qrStatusError?: unknown;
  qrStatusResponseInit?: ResponseInit;
}): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3") {
      input.onQr?.();

      if (input.qrError) {
        throw input.qrError;
      }

      return Response.json(input.qrBody ?? WECHAT_QR_OK_RESPONSE, input.qrResponseInit);
    }

    if (
      requestUrl ===
      "https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=wechat-qr-token"
    ) {
      input.onQrStatus?.();

      if (input.qrStatusError) {
        throw input.qrStatusError;
      }

      return Response.json(
        input.qrStatusBody ?? WECHAT_QR_CONFIRMED_RESPONSE,
        input.qrStatusResponseInit,
      );
    }

    return originalFetch(url);
  };

  try {
    return await input.operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function insertSecondLiveAgent(
  database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>,
): Promise<void> {
  const nowMs = nowMsForTest();
  const configJson = JSON.stringify({
    packageMcpServers: [],
    packageResolution: null,
    packageSkills: [],
  });
  const appDatabase = database.app();

  await appDatabase
    .insert(agentsTable)
    .values({
      configJson,
      createdAt: nowMs,
      description: null,
      environmentId: "01J00000000000000000000007",
      id: "01J00000000000000000000068",
      kind: "pet",
      liveDeploymentVersionId: "01J00000000000000000000069",
      model: "gpt-5.4",
      name: "Second Live Agent",
      ownerId: "01J00000000000000000000001",
      prompt: "Help again.",
      provider: "openai",
      appId: PUBLIC_API_TEST_IDS.app,
      runtimeId: "openai-runtime",
      status: "published",
      updatedAt: nowMs,
      visibility: "private",
    })
    .run();

  await appDatabase
    .insert(agentDeploymentVersionsTable)
    .values({
      agentId: "01J00000000000000000000068",
      configJson,
      createdAt: nowMs,
      createdByAccountId: "01J00000000000000000000001",
      environmentId: "01J00000000000000000000007",
      id: "01J00000000000000000000069",
      kind: "pet",
      mcpBindingsJson: "[]",
      model: "gpt-5.4",
      prompt: "Help again.",
      provider: "openai",
      runtimeId: "openai-runtime",
      skillsJson: "[]",
      spaceBindingsJson: "[]",
      summary: "Second published test version",
      versionNumber: 1,
    })
    .run();
}

export function createChannelConnectionNamespaceForDeleteTest(
  onStop: (bindingId: string) => Promise<void>,
) {
  return {
    get: () => ({
      stop: async (provider: string, bindingId: string) => {
        expect(provider).toBe("discord");
        await onStop(bindingId);
        return { bindingId, status: "stopped" as const };
      },
    }),
    idFromName: (name: string) => name,
  };
}

function isTelegramOkResponse(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "ok" in value &&
    value.ok === true
  );
}
