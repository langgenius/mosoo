import type { BuildSession } from "@cf-vibesdk/sdk";
import { VibeClient, withTimeout } from "@cf-vibesdk/sdk";

import { API_ERROR_CODE, createApiError } from "../../../platform/errors";

export interface VibeAppSnapshot {
  previewUrl: string | null;
  productionUrl: string | null;
  status: "generating" | "ready";
  title: string | null;
  updatedAt: string | null;
}

export interface VibeAppCloneUrl {
  cloneUrl: string;
  expiresAt: string;
}

export interface VibesdkGateway {
  createApp(prompt: string): Promise<string>;
  createCloneUrl(vibeAppId: string): Promise<VibeAppCloneUrl>;
  deleteApp(vibeAppId: string): Promise<void>;
  getApp(vibeAppId: string): Promise<VibeAppSnapshot>;
  publish(vibeAppId: string): Promise<void>;
  refreshPreview(vibeAppId: string): Promise<void>;
  sendPrompt(vibeAppId: string, prompt: string): Promise<void>;
}

export interface VibesdkGatewayBindings {
  VIBESDK_API_KEY?: string;
  VIBESDK_BASE_URL?: string;
  VIBESDK_BEHAVIOR_TYPE?: string;
}

export interface VibesdkGatewayTimeouts {
  commandAckMs: number;
  createMs: number;
  generationStartedMs: number;
}

// The create budget must stay under Cloudflare's ~100s request ceiling: the
// SDK's build() drains the blueprint stream before returning.
const DEFAULT_TIMEOUTS: VibesdkGatewayTimeouts = {
  commandAckMs: 10_000,
  createMs: 75_000,
  generationStartedMs: 15_000,
};
const HTTP_RETRY = { enabled: true, initialDelayMs: 250, maxDelayMs: 1_000, maxRetries: 1 };
const WS_CONNECT_OPTIONS = {
  autoRequestConversationState: false,
  retry: { enabled: false },
} as const;

const VIBE_BEHAVIOR_TYPES = ["phasic", "agentic"] as const;
type VibeBehaviorType = (typeof VIBE_BEHAVIOR_TYPES)[number];

function unavailableError(action: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return createApiError(API_ERROR_CODE.vibeAppUnavailable, `VibeSDK ${action} failed: ${detail}`);
}

function isHttpNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("HTTP 404 ");
}

function readNullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseSnapshot(data: unknown): VibeAppSnapshot {
  if (typeof data !== "object" || data === null) {
    throw new Error("VibeSDK app response has no data.");
  }

  const record = data as Record<string, unknown>;
  const status = record["status"];

  if (status !== "generating" && status !== "completed") {
    throw new Error(`VibeSDK app status is unrecognized: ${String(status)}.`);
  }

  return {
    previewUrl: readNullableString(record, "previewUrl"),
    productionUrl: readNullableString(record, "cloudflareUrl"),
    status: status === "completed" ? "ready" : "generating",
    title: readNullableString(record, "title"),
    updatedAt: readNullableString(record, "updatedAt"),
  };
}

function parseBehaviorType(value: string | undefined): VibeBehaviorType {
  if (value === undefined || value.trim().length === 0) {
    return "phasic";
  }

  if ((VIBE_BEHAVIOR_TYPES as readonly string[]).includes(value)) {
    return value as VibeBehaviorType;
  }

  throw createApiError(
    API_ERROR_CODE.vibeAppUnconfigured,
    `VIBESDK_BEHAVIOR_TYPE must be one of ${VIBE_BEHAVIOR_TYPES.join(", ")}.`,
  );
}

class SdkVibesdkGateway implements VibesdkGateway {
  private readonly client: VibeClient;
  private readonly behaviorType: VibeBehaviorType;
  private readonly timeouts: VibesdkGatewayTimeouts;

  constructor(
    baseUrl: string,
    apiKey: string,
    behaviorType: VibeBehaviorType,
    timeouts: VibesdkGatewayTimeouts,
  ) {
    this.behaviorType = behaviorType;
    this.client = new VibeClient({ apiKey, baseUrl, retry: HTTP_RETRY });
    this.timeouts = timeouts;
  }

  async createApp(prompt: string): Promise<string> {
    const sessionRef: { current: BuildSession | null } = { current: null };

    try {
      return await withTimeout(
        (async () => {
          const session = await this.client.build(prompt, {
            autoConnect: false,
            behaviorType: this.behaviorType,
          });
          sessionRef.current = session;
          await session.connect(WS_CONNECT_OPTIONS);
          session.startGeneration();
          await session.wait.generationStarted({ timeoutMs: this.timeouts.generationStartedMs });
          return session.agentId;
        })(),
        this.timeouts.createMs,
        "VibeSDK build timed out before generation started.",
      );
    } catch (error) {
      const created = sessionRef.current;

      if (created !== null) {
        await this.client.apps.delete(created.agentId).catch(() => undefined);
      }

      throw unavailableError("create", error);
    } finally {
      sessionRef.current?.close();
    }
  }

  async getApp(vibeAppId: string): Promise<VibeAppSnapshot> {
    try {
      const response = await this.client.apps.get(vibeAppId);

      if (!response.success) {
        throw new Error(response.error?.message ?? "VibeSDK app read was rejected.");
      }

      return parseSnapshot(response.data);
    } catch (error) {
      throw unavailableError("status read", error);
    }
  }

  async deleteApp(vibeAppId: string): Promise<void> {
    try {
      const response = await this.client.apps.delete(vibeAppId);

      if (!response.success) {
        throw new Error(response.error?.message ?? "VibeSDK app delete was rejected.");
      }
    } catch (error) {
      if (isHttpNotFound(error)) {
        return;
      }

      throw unavailableError("delete", error);
    }
  }

  async createCloneUrl(vibeAppId: string): Promise<VibeAppCloneUrl> {
    try {
      const response = await this.client.apps.getGitCloneToken(vibeAppId);

      if (!response.success || !response.data) {
        throw new Error(response.error?.message ?? "VibeSDK clone token was rejected.");
      }

      return { cloneUrl: response.data.cloneUrl, expiresAt: response.data.expiresAt };
    } catch (error) {
      throw unavailableError("clone token", error);
    }
  }

  async sendPrompt(vibeAppId: string, prompt: string): Promise<void> {
    await this.sendCommand(vibeAppId, "prompt", (session) => {
      session.followUp(prompt);
    });
  }

  async publish(vibeAppId: string): Promise<void> {
    await this.sendCommand(vibeAppId, "publish", (session) => {
      session.deployCloudflare();
    });
  }

  async refreshPreview(vibeAppId: string): Promise<void> {
    await this.sendCommand(vibeAppId, "preview refresh", (session) => {
      session.deployPreview();
    });
  }

  // Sends one command over a short-lived WebSocket. The trailing
  // get_conversation_state acts as a delivery barrier: the agent processes
  // messages in order, so its conversation_state reply proves the command
  // was consumed before we disconnect.
  private async sendCommand(
    vibeAppId: string,
    action: string,
    send: (session: BuildSession) => void,
  ): Promise<void> {
    let session: BuildSession | null = null;

    try {
      session = await this.client.connect(vibeAppId);
      await session.connect(WS_CONNECT_OPTIONS);
      send(session);
      session.requestConversationState();
      await session.waitForMessageType("conversation_state", this.timeouts.commandAckMs);
    } catch (error) {
      throw unavailableError(action, error);
    } finally {
      session?.close();
    }
  }
}

export function createVibesdkGateway(
  bindings: VibesdkGatewayBindings,
  timeouts: VibesdkGatewayTimeouts = DEFAULT_TIMEOUTS,
): VibesdkGateway | null {
  const baseUrl = bindings.VIBESDK_BASE_URL?.trim() ?? "";
  const apiKey = bindings.VIBESDK_API_KEY?.trim() ?? "";

  if (baseUrl === "" && apiKey === "") {
    return null;
  }

  if (baseUrl === "" || apiKey === "") {
    throw createApiError(
      API_ERROR_CODE.vibeAppUnconfigured,
      "VIBESDK_BASE_URL and VIBESDK_API_KEY must both be configured.",
    );
  }

  return new SdkVibesdkGateway(
    baseUrl,
    apiKey,
    parseBehaviorType(bindings.VIBESDK_BEHAVIOR_TYPE),
    timeouts,
  );
}

export function requireVibesdkGateway(gateway: VibesdkGateway | null): VibesdkGateway {
  if (gateway === null) {
    throw createApiError(
      API_ERROR_CODE.vibeAppUnconfigured,
      "The VibeSDK backend is not configured on this deployment.",
    );
  }

  return gateway;
}
