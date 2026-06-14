import { expect } from "bun:test";

import type { ChannelConnection } from "../src/adapters/durable-objects/channel-connection.do";
import type { ChannelConnectionProvider } from "../src/adapters/durable-objects/channel-connection.do";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createDiscordAgentChannelBinding } from "../src/modules/channels/application/agent-channel-binding.service";
import type { DiscordGatewayRuntimeSnapshot } from "../src/modules/channels/discord/discord-gateway-health";
import type { DiscordGatewaySocket } from "../src/modules/channels/discord/discord-gateway-socket";
import type {
  DiscordGatewayDurableObjectState,
  DiscordGatewayStartResult,
} from "../src/modules/channels/discord/discord-gateway.do";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { readFetchUrl } from "./helpers/fetch-request-url";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

export const STARTED_SNAPSHOT: DiscordGatewayRuntimeSnapshot = {
  connectedAtMs: null,
  heartbeatIntervalMs: null,
  lastCloseCode: null,
  lastDispatchAtMs: null,
  lastErrorCode: null,
  lastHeartbeatAckAtMs: null,
  lastHeartbeatSentAtMs: null,
  resumeGatewayUrl: null,
  sequence: null,
  sessionId: null,
  status: "connecting",
  statusChangedAtMs: 1_000,
};

type FakeDurableObjectStorageContract = DiscordGatewayDurableObjectState["storage"];

export class FakeDurableObjectStorage implements FakeDurableObjectStorageContract {
  readonly values = new Map<string, unknown>();
  alarmTime: number | null = null;

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async deleteAlarm(): Promise<void> {
    this.alarmTime = null;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async setAlarm(scheduledTime: Date | number): Promise<void> {
    this.alarmTime = typeof scheduledTime === "number" ? scheduledTime : scheduledTime.getTime();
  }
}

export class FakeGatewaySocket implements DiscordGatewaySocket {
  readonly closeListeners: Array<(event: { code: number }) => void> = [];
  readonly errorListeners: Array<(event: Event) => void> = [];
  readonly messageListeners: Array<(event: { data: ArrayBuffer | string }) => void> = [];
  readonly sentFrames: string[] = [];
  closeCode: number | null = null;
  closeReason: string | null = null;

  onClose(listener: (event: { code: number }) => void): void {
    this.closeListeners.push(listener);
  }

  onError(listener: (event: Event) => void): void {
    this.errorListeners.push(listener);
  }

  onMessage(listener: (event: { data: ArrayBuffer | string }) => void): void {
    this.messageListeners.push(listener);
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code ?? null;
    this.closeReason = reason ?? null;
  }

  emitClose(code: number): void {
    for (const listener of this.closeListeners) {
      listener({ code });
    }
  }

  emitMessage(data: string): void {
    for (const listener of this.messageListeners) {
      listener({ data });
    }
  }

  send(data: string): void {
    this.sentFrames.push(data);
  }
}

export function installDiscordFetch(): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://discord.com/api/v10/users/@me") {
      return Response.json({
        bot: true,
        id: "discord-bot-1",
        username: "mosoobot",
      });
    }

    if (requestUrl === "https://discord.com/api/v10/channels/dm-1") {
      return Response.json({
        id: "dm-1",
        type: 1,
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

export async function createDiscordBindingFixture(): Promise<{
  bindingId: string;
  bindings: ApiBindings;
  database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>;
}> {
  const database = await createPublicHttpContractDatabase();
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const restoreFetch = installDiscordFetch();

  try {
    const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      applicationId: "discord-app-1",
      botToken: "discord-token",
      appId: PUBLIC_API_TEST_IDS.app,
      relaySecret: "discord-relay-secret",
    });

    return {
      bindingId: binding.id,
      bindings,
      database,
    };
  } finally {
    restoreFetch();
  }
}

export function createMessageCreateFrame(sequence: number): string {
  return JSON.stringify({
    d: {
      author: { bot: false, id: "user-1", username: "Ada" },
      channel_id: "dm-1",
      content: "review this",
      id: "message-1",
    },
    op: 0,
    s: sequence,
    t: "MESSAGE_CREATE",
  });
}

export async function settleGatewayEvent(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

export function readSentFrame(socket: FakeGatewaySocket, index: number): Record<string, unknown> {
  const frame = socket.sentFrames.at(index);

  if (!frame) {
    throw new Error(`Expected sent frame at index ${index}.`);
  }

  const parsed: unknown = JSON.parse(frame);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected sent frame to be a JSON object.");
  }

  return parsed;
}

function createFakeDurableObjectId(name: string): DurableObjectId {
  return {
    equals(other) {
      return other.toString() === this.toString();
    },
    name,
    toString() {
      return `fake-channel-connection:${name}`;
    },
  };
}

export function createFakeChannelConnectionNamespace(
  startedBindingIds: string[],
): DurableObjectNamespace<ChannelConnection> {
  const namespace = {
    get(id: DurableObjectId) {
      return {
        async fetch() {
          return Response.json({ ok: false }, { status: 501 });
        },
        id,
        name: id.name,
        async snapshot(provider: ChannelConnectionProvider, bindingId: string) {
          expect(provider).toBe("discord");
          return {
            active: startedBindingIds.includes(bindingId),
            bindingId,
            snapshot: STARTED_SNAPSHOT,
          };
        },
        async start(
          provider: ChannelConnectionProvider,
          bindingId: string,
        ): Promise<DiscordGatewayStartResult> {
          expect(provider).toBe("discord");
          startedBindingIds.push(bindingId);
          return {
            bindingId,
            snapshot: STARTED_SNAPSHOT,
            status: "started",
          };
        },
        async stop(provider: ChannelConnectionProvider, bindingId: string) {
          expect(provider).toBe("discord");
          return {
            bindingId,
            status: "stopped",
          } as const;
        },
      } as DurableObjectStub<ChannelConnection>;
    },
    getByName(name: string) {
      return namespace.get(namespace.idFromName(name));
    },
    idFromName(name: string) {
      return createFakeDurableObjectId(name);
    },
    idFromString(id: string) {
      return createFakeDurableObjectId(id);
    },
    jurisdiction() {
      return namespace;
    },
    newUniqueId() {
      return createFakeDurableObjectId("unique");
    },
  } as DurableObjectNamespace<ChannelConnection>;

  return namespace;
}
