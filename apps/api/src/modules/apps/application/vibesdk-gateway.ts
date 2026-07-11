import type { BuildSession } from "@cf-vibesdk/sdk";
import { VibeClient, withTimeout } from "@cf-vibesdk/sdk";
import type { AppVibeAppCloneUrl } from "@mosoo/contracts/app";

import { API_ERROR_CODE, createApiError } from "../../../platform/errors";

export interface VibeAppSnapshot {
  lastPublishedAt: string | null;
  previewUrl: string | null;
  productionUrl: string | null;
  status: "generating" | "ready";
  title: string | null;
  updatedAt: string | null;
}

export interface VibesdkGateway {
  createApp(prompt: string): Promise<string>;
  createCloneUrl(vibeAppId: string): Promise<AppVibeAppCloneUrl>;
  deleteApp(vibeAppId: string): Promise<void>;
  getApp(vibeAppId: string): Promise<VibeAppSnapshot>;
  publish(vibeAppId: string): Promise<void>;
  refreshPreview(vibeAppId: string): Promise<void>;
  sendPrompt(vibeAppId: string, prompt: string): Promise<void>;
}

export interface VibesdkGatewayBindings {
  VIBESDK_API_KEY?: string;
  VIBESDK_BASE_URL?: string;
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
// No SDK-level HTTP retry: POST /api/agent is not idempotent (a retry can
// double-create), and reads are naturally retried by the console's poll.
const HTTP_RETRY = { enabled: false };
const WS_CONNECT_OPTIONS = {
  autoRequestConversationState: false,
  retry: { enabled: false },
} as const;

// The stable released VibeSDK generation mode.
const VIBE_BEHAVIOR_TYPE = "phasic";

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
    lastPublishedAt: readNullableString(record, "lastDeployedAt"),
    previewUrl: readNullableString(record, "previewUrl"),
    productionUrl: readNullableString(record, "cloudflareUrl"),
    status: status === "completed" ? "ready" : "generating",
    title: readNullableString(record, "title"),
    updatedAt: readNullableString(record, "updatedAt"),
  };
}

class SdkVibesdkGateway implements VibesdkGateway {
  private readonly client: VibeClient;
  private readonly timeouts: VibesdkGatewayTimeouts;

  constructor(baseUrl: string, apiKey: string, timeouts: VibesdkGatewayTimeouts) {
    this.client = new VibeClient({ apiKey, baseUrl, retry: HTTP_RETRY });
    this.timeouts = timeouts;
  }

  async createApp(prompt: string): Promise<string> {
    // A ref object, not a plain `let`: the assignment happens inside the
    // withTimeout closure, and TypeScript narrows a captured `let` back to
    // null in the catch block.
    const sessionRef: { current: BuildSession | null } = { current: null };
    const buildPromise = (async () => {
      const session = await this.client.build(prompt, {
        autoConnect: false,
        behaviorType: VIBE_BEHAVIOR_TYPE,
      });
      sessionRef.current = session;
      await session.connect(WS_CONNECT_OPTIONS);
      session.startGeneration();
      await session.wait.generationStarted({ timeoutMs: this.timeouts.generationStartedMs });
      return session.agentId;
    })();

    try {
      return await withTimeout(
        buildPromise,
        this.timeouts.createMs,
        "VibeSDK build timed out before generation started.",
      );
    } catch (error) {
      const created = sessionRef.current;

      if (created !== null) {
        await this.client.apps.delete(created.agentId).catch(() => undefined);
      } else {
        // The blueprint drain has not returned yet, so the remote app id is
        // unknown. Compensate when (if) the detached build resolves; if the
        // isolate dies first the orphan is left for platform-side cleanup.
        void buildPromise
          .then(async (agentId) => {
            sessionRef.current?.close();
            await this.client.apps.delete(agentId);
          })
          .catch(() => undefined);
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

  async createCloneUrl(vibeAppId: string): Promise<AppVibeAppCloneUrl> {
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

// Isolate-lifetime cache so repeated resolver calls reuse one SDK client and
// its short-lived access token instead of re-exchanging the API key per poll.
const gatewayCache = new Map<string, VibesdkGateway>();

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

  const cacheKey = `${baseUrl}\n${apiKey}\n${timeouts.commandAckMs}\n${timeouts.createMs}\n${timeouts.generationStartedMs}`;
  const cached = gatewayCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const gateway = new SdkVibesdkGateway(baseUrl, apiKey, timeouts);
  gatewayCache.set(cacheKey, gateway);
  return gateway;
}

// Read paths tolerate misconfiguration: a broken/partial config reads as "no
// gateway" so dormant Apps keep rendering, while command paths still fail loud
// through the strict factory.
export function createVibesdkGatewayForRead(
  bindings: VibesdkGatewayBindings,
): VibesdkGateway | null {
  try {
    return createVibesdkGateway(bindings);
  } catch {
    return null;
  }
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
