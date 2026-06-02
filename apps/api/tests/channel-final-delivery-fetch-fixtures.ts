import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ChannelFinalDeliveryMessage } from "../src/modules/channels/application/channel-final-delivery-message";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { readFetchUrl } from "./helpers/fetch-request-url";
import type { ChannelFinalDeliveryQueueStub } from "./helpers/published-agent-http-test-fixture";
import {
  createChannelFinalDeliveryQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/published-agent-http-test-fixture";

export const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

export type PublicHttpContractDatabase = Awaited<
  ReturnType<typeof createPublicHttpContractDatabase>
>;

interface TestEnvironment {
  bindings: ApiBindings;
  database: PublicHttpContractDatabase;
  queue: ChannelFinalDeliveryQueueStub;
}

function readJsonObjectBody(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body);

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed;
  }

  throw new Error("Expected provider request body to be a JSON object.");
}

export async function createTestEnvironment(): Promise<TestEnvironment> {
  const database = await createPublicHttpContractDatabase();
  const queue = createChannelFinalDeliveryQueueStub();
  const bindings = createPublicHttpTestBindings(database, { queue }) as ApiBindings;

  return { bindings, database, queue };
}

export function takeQueuedMessageBody(
  queue: ChannelFinalDeliveryQueueStub,
  jobId: string,
): ChannelFinalDeliveryMessage {
  const match = queue.sent.find((entry) => entry.body.jobId === jobId);

  if (!match) {
    throw new Error(`Expected queued message for ${jobId}.`);
  }

  return match.body;
}

export function installTelegramFetch(
  telegramBodies: unknown[],
  input: {
    onSendMessage?: () => Promise<void>;
  } = {},
): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://api.telegram.org/bottelegram-token/getMe") {
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

    if (requestUrl === "https://api.telegram.org/bottelegram-token/sendMessage") {
      if (typeof init?.body === "string") {
        telegramBodies.push(readJsonObjectBody(init.body));
      }
      await input.onSendMessage?.();

      return Response.json({
        ok: true,
        result: { chat: { id: 42 }, message_id: telegramBodies.length },
      });
    }

    return Response.json({
      data: [{ id: "gpt-5.4" }],
    });
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

export function installDiscordFetch(discordRequests: { body: unknown; url: string }[]): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://discord.com/api/v10/users/@me") {
      return Response.json({
        bot: true,
        id: "discord-bot-1",
        username: "mosoobot",
      });
    }

    if (requestUrl.startsWith("https://discord.com/api/v10/channels/discord-channel-1/messages/")) {
      if (typeof init?.body === "string") {
        discordRequests.push({
          body: readJsonObjectBody(init.body),
          url: requestUrl,
        });
      }

      return Response.json({ id: requestUrl.split("/").at(-1) ?? "working-message" });
    }

    return Response.json({
      data: [{ id: "gpt-5.4" }],
    });
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

export function installLarkFetch(input: {
  readonly replyResponse?: unknown;
  readonly replyRequests?: unknown[];
}): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
      return Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      });
    }

    if (requestUrl === "https://open.feishu.cn/open-apis/bot/v3/info") {
      return Response.json({
        bot: {
          app_name: "Mosoo Lark",
          open_id: "ou_bot",
        },
        code: 0,
      });
    }

    if (requestUrl.startsWith("https://open.feishu.cn/open-apis/im/v1/messages/")) {
      if (typeof init?.body === "string") {
        input.replyRequests?.push(readJsonObjectBody(init.body));
      }

      return Response.json(input.replyResponse ?? { code: 0, data: {} });
    }

    return Response.json({
      data: [{ id: "gpt-5.4" }],
    });
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}
