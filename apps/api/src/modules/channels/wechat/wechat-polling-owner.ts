import type { ChannelBindingId } from "@mosoo/id";

import type {
  ChannelConnectionKey,
  ChannelConnectionOwnerSnapshot,
  ChannelConnectionOwnerStatus,
} from "../application/channel-connection-health";
import {
  normalizeWeChatIlinkWorkTrigger,
  parseWeChatIlinkPollEnvelope,
  summarizeWeChatPollRuntime,
} from "./wechat-events";
import type {
  WeChatIlinkRawMessage,
  WeChatIlinkWorkTrigger,
  WeChatPollRuntimeSummary,
} from "./wechat-events";
import { WeChatIlinkApiError, WeChatIlinkHttpError } from "./wechat-ilink-client";
import type { WeChatIlinkClient } from "./wechat-ilink-client";
import type { WeChatReplyRoute } from "./wechat-runtime";

const DEFAULT_WECHAT_POLL_TIMEOUT_MS = 35_000;

export interface WeChatPollingOwnerStore {
  readCursor(input: WeChatPollingOwnerStorageKey): Promise<string | null>;
  writeContextToken(input: WeChatPollingOwnerContextTokenRecord): Promise<void>;
  writeCursor(input: WeChatPollingOwnerCursorRecord): Promise<void>;
  writeRuntimeState?(input: WeChatPollingOwnerRuntimeStateRecord): Promise<void>;
}

export interface WeChatPollingOwnerStorageKey {
  accountId: string;
  bindingId: ChannelBindingId;
}

export interface WeChatPollingOwnerCursorRecord extends WeChatPollingOwnerStorageKey {
  cursor: string;
  updatedAtMs: number;
}

export interface WeChatPollingOwnerContextTokenRecord extends WeChatPollingOwnerStorageKey {
  contextTokenKey: string;
  contextTokenValue: string;
  peerId: string;
  toUserId: string;
  updatedAtMs: number;
}

export interface WeChatPollingOwnerRuntimeState {
  lastProcessedMessageId: string | null;
  nextCursor: string | null;
  pollTimeoutMs: number;
}

export interface WeChatPollingOwnerRuntimeStateRecord extends WeChatPollingOwnerStorageKey {
  runtimeState: WeChatPollingOwnerRuntimeState;
  runtimeStateJson: string;
  snapshot: ChannelConnectionOwnerSnapshot;
}

export interface WeChatPollingRuntimeOwnerOptions {
  accountId: string;
  bindingId: ChannelBindingId;
  botId: string;
  client: Pick<WeChatIlinkClient, "getUpdates">;
  initialCursor?: string | null;
  nowMs?: () => number;
  onTrigger: (trigger: WeChatIlinkWorkTrigger) => Promise<void>;
  pollTimeoutMs?: number;
  store: WeChatPollingOwnerStore;
}

export interface WeChatPollingOwnerPollResult {
  droppedMessageCount: number;
  nextCursor: string | null;
  processedMessageCount: number;
  runtimeSummary: WeChatPollRuntimeSummary | null;
  status: ChannelConnectionOwnerStatus;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}

function createRuntimeKey(input: WeChatPollingOwnerStorageKey): ChannelConnectionKey {
  return {
    accountId: input.accountId,
    bindingId: input.bindingId,
    provider: "wechat",
  };
}

function createRuntimeStateJson(state: WeChatPollingOwnerRuntimeState): string {
  return JSON.stringify(state);
}

function errorCodeFromUnknown(error: unknown, fallback: string): string {
  if (error instanceof WeChatIlinkApiError) {
    return error.code;
  }

  if (error instanceof WeChatIlinkHttpError) {
    return `http_${error.status}`;
  }

  if (error instanceof Error && error.name && error.name !== "Error") {
    return error.name;
  }

  return fallback;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function classifyPollingError(error: unknown): {
  code: string;
  status: ChannelConnectionOwnerStatus;
} {
  if (error instanceof WeChatIlinkApiError) {
    if (error.code === "missing_bot_token" || error.code === "ilink_-14") {
      return { code: error.code, status: "relogin_required" };
    }

    return { code: error.code, status: "failed" };
  }

  if (error instanceof WeChatIlinkHttpError) {
    const code = `http_${error.status}`;

    if (error.status === 401 || error.status === 403) {
      return { code, status: "relogin_required" };
    }

    if (isTransientHttpStatus(error.status)) {
      return { code, status: "reconnecting" };
    }

    return { code, status: "failed" };
  }

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { code: "timeout", status: "reconnecting" };
  }

  if (error instanceof TypeError) {
    return { code: "network_error", status: "reconnecting" };
  }

  return { code: errorCodeFromUnknown(error, "poll_failed"), status: "failed" };
}

export class WeChatPollingRuntimeOwner {
  readonly #accountId: string;
  readonly #bindingId: ChannelBindingId;
  readonly #botId: string;
  readonly #client: Pick<WeChatIlinkClient, "getUpdates">;
  readonly #initialCursor: string | null;
  readonly #nowMs: () => number;
  readonly #onTrigger: (trigger: WeChatIlinkWorkTrigger) => Promise<void>;
  readonly #pollTimeoutMs: number;
  readonly #store: WeChatPollingOwnerStore;
  #lastProcessedMessageId: string | null = null;
  #nextCursor: string | null = null;
  #snapshot: ChannelConnectionOwnerSnapshot;

  constructor(options: WeChatPollingRuntimeOwnerOptions) {
    assertNonEmpty(options.accountId, "WeChat account id");
    assertNonEmpty(options.bindingId, "WeChat binding id");
    assertNonEmpty(options.botId, "WeChat bot id");

    const nowMs = options.nowMs ?? Date.now;
    const timestampMs = nowMs();

    this.#accountId = options.accountId;
    this.#bindingId = options.bindingId;
    this.#botId = options.botId;
    this.#client = options.client;
    this.#initialCursor = options.initialCursor?.trim() || null;
    this.#nowMs = nowMs;
    this.#onTrigger = options.onTrigger;
    this.#pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_WECHAT_POLL_TIMEOUT_MS;
    this.#store = options.store;
    this.#snapshot = {
      key: createRuntimeKey(options),
      lastErrorCode: null,
      lastHeartbeatAtMs: null,
      lastInboundAtMs: null,
      lastPollAtMs: null,
      leaseExpiresAtMs: null,
      leaseOwnerId: null,
      status: "idle",
      statusChangedAtMs: timestampMs,
    };
  }

  getSnapshot(): ChannelConnectionOwnerSnapshot {
    return this.#snapshot;
  }

  getRuntimeState(): WeChatPollingOwnerRuntimeState {
    return this.#runtimeState();
  }

  async pollOnce(): Promise<WeChatPollingOwnerPollResult> {
    const cursor = (await this.#store.readCursor(this.#storageKey())) ?? this.#initialCursor ?? "";
    this.#nextCursor = cursor || null;
    await this.#persist("running", null);

    let body: string;

    try {
      body = await this.#client.getUpdates({
        cursor,
        timeoutMs: this.#pollTimeoutMs,
      });
    } catch (error) {
      const failure = classifyPollingError(error);
      this.#nextCursor = failure.status === "relogin_required" ? null : cursor || null;
      await this.#persist(failure.status, failure.code);
      return {
        droppedMessageCount: 0,
        nextCursor: this.#nextCursor,
        processedMessageCount: 0,
        runtimeSummary: null,
        status: failure.status,
      };
    }

    const parsed = parseWeChatIlinkPollEnvelope(body);
    const polledAtMs = this.#nowMs();

    if (!parsed.ok) {
      await this.#persist("failed", parsed.code, { lastPollAtMs: polledAtMs });
      return {
        droppedMessageCount: 0,
        nextCursor: cursor || null,
        processedMessageCount: 0,
        runtimeSummary: null,
        status: "failed",
      };
    }

    const runtimeSummary = summarizeWeChatPollRuntime(parsed.envelope);

    if (runtimeSummary.status === "relogin_required") {
      this.#nextCursor = null;
      await this.#persist("relogin_required", runtimeSummary.reason, { lastPollAtMs: polledAtMs });
      return {
        droppedMessageCount: 0,
        nextCursor: null,
        processedMessageCount: 0,
        runtimeSummary,
        status: "relogin_required",
      };
    }

    if (runtimeSummary.status === "provider_error") {
      await this.#persist("reconnecting", runtimeSummary.reason, { lastPollAtMs: polledAtMs });
      return {
        droppedMessageCount: 0,
        nextCursor: cursor || null,
        processedMessageCount: 0,
        runtimeSummary,
        status: "reconnecting",
      };
    }

    return this.#processMessages(parsed.envelope.messages, {
      nextCursor: parsed.envelope.nextCursor,
      polledAtMs,
      runtimeSummary,
    });
  }

  async #processMessages(
    messages: WeChatIlinkRawMessage[],
    input: {
      nextCursor: string;
      polledAtMs: number;
      runtimeSummary: WeChatPollRuntimeSummary;
    },
  ): Promise<WeChatPollingOwnerPollResult> {
    let droppedMessageCount = 0;
    let processedMessageCount = 0;
    let lastInboundAtMs: number | null = null;

    try {
      for (const message of messages) {
        const trigger = normalizeWeChatIlinkWorkTrigger(message, {
          accountId: this.#accountId,
          bindingId: this.#bindingId,
          botId: this.#botId,
        });

        if (!trigger) {
          droppedMessageCount += 1;
          continue;
        }

        await this.#store.writeContextToken(
          this.#contextTokenRecord(trigger.peerId, trigger.replyRoute),
        );
        await this.#onTrigger(trigger);
        this.#lastProcessedMessageId = trigger.messageId;
        processedMessageCount += 1;
        lastInboundAtMs = this.#nowMs();
      }

      await this.#store.writeCursor({
        ...this.#storageKey(),
        cursor: input.nextCursor,
        updatedAtMs: this.#nowMs(),
      });
      this.#nextCursor = input.nextCursor;
      await this.#persist("running", null, {
        lastHeartbeatAtMs: input.polledAtMs,
        lastInboundAtMs,
        lastPollAtMs: input.polledAtMs,
      });

      return {
        droppedMessageCount,
        nextCursor: input.nextCursor,
        processedMessageCount,
        runtimeSummary: input.runtimeSummary,
        status: "running",
      };
    } catch (error) {
      await this.#persist("failed", errorCodeFromUnknown(error, "trigger_dispatch_failed"), {
        lastInboundAtMs,
        lastPollAtMs: input.polledAtMs,
      });
      throw error;
    }
  }

  async #persist(
    status: ChannelConnectionOwnerStatus,
    lastErrorCode: string | null,
    input: {
      lastHeartbeatAtMs?: number | null;
      lastInboundAtMs?: number | null;
      lastPollAtMs?: number | null;
    } = {},
  ): Promise<void> {
    this.#transition(status, lastErrorCode, input);

    const runtimeState = this.#runtimeState();

    await this.#store.writeRuntimeState?.({
      ...this.#storageKey(),
      runtimeState,
      runtimeStateJson: createRuntimeStateJson(runtimeState),
      snapshot: this.#snapshot,
    });
  }

  #transition(
    status: ChannelConnectionOwnerStatus,
    lastErrorCode: string | null,
    input: {
      lastHeartbeatAtMs?: number | null;
      lastInboundAtMs?: number | null;
      lastPollAtMs?: number | null;
    } = {},
  ): void {
    const nowMs = this.#nowMs();
    const statusChangedAtMs =
      this.#snapshot.status === status ? this.#snapshot.statusChangedAtMs : nowMs;

    this.#snapshot = {
      ...this.#snapshot,
      lastErrorCode,
      lastHeartbeatAtMs:
        input.lastHeartbeatAtMs === undefined
          ? this.#snapshot.lastHeartbeatAtMs
          : input.lastHeartbeatAtMs,
      lastInboundAtMs:
        input.lastInboundAtMs === undefined
          ? this.#snapshot.lastInboundAtMs
          : input.lastInboundAtMs,
      lastPollAtMs:
        input.lastPollAtMs === undefined ? this.#snapshot.lastPollAtMs : input.lastPollAtMs,
      status,
      statusChangedAtMs,
    };
  }

  #runtimeState(): WeChatPollingOwnerRuntimeState {
    return {
      lastProcessedMessageId: this.#lastProcessedMessageId,
      nextCursor: this.#nextCursor,
      pollTimeoutMs: this.#pollTimeoutMs,
    };
  }

  #storageKey(): WeChatPollingOwnerStorageKey {
    return {
      accountId: this.#accountId,
      bindingId: this.#bindingId,
    };
  }

  #contextTokenRecord(
    peerId: string,
    route: WeChatReplyRoute,
  ): WeChatPollingOwnerContextTokenRecord {
    return {
      ...this.#storageKey(),
      contextTokenKey: route.contextTokenKey,
      contextTokenValue: route.contextTokenValue,
      peerId,
      toUserId: route.toUserId,
      updatedAtMs: this.#nowMs(),
    };
  }
}
