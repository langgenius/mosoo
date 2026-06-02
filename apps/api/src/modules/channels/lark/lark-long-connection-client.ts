// Lark Long Connection protocol client.
//
// Scope (PRD §4): handshake → frame decode → ping/pong primitives → close
// signaling. The client owns wire-level concerns only. It does NOT own
// reconnect, lease, heartbeat scheduling, or persistence — those belong to
// ChannelConnection drives `sendPing()` from a Durable Object
// `alarm()` so the connection survives DO hibernation (PRD §3 architecture
// note: never use interval-based timers inside a DO host).
//
// Protocol field names live in LARK_LC_PROTOCOL below — single truth source
// for wire strings; the receive-message event type comes from lark-events.ts
// so the manifest and the webhook parser agree on the same literal. If the
// L-005 live spike reveals different names, update LARK_LC_PROTOCOL in one
// place.

import {
  decodeLarkEventCallbackEnvelope,
  LARK_EVENT_TYPE_RECEIVE_MESSAGE,
  normalizeLarkWorkTrigger,
} from "./lark-events";
import type { LarkEventCallbackEnvelope, LarkWorkTrigger } from "./lark-events";

export const LARK_LC_CONNECT_URL_PATH = "/open-apis/im/v1/long-connection/connect_url" as const;

const LARK_LC_PROTOCOL = {
  connectPath: LARK_LC_CONNECT_URL_PATH,
  eventTypeField: "event_type",
  frameTypeField: "type",
  frameTypes: {
    event: "event",
    hello: "hello",
    pong: "pong",
    reconnect: "reconnect",
  },
  heartbeatIntervalField: "heartbeat_interval",
  outboundPing: { type: "ping" },
  payloadField: "payload",
  reconnectUrlField: "url",
} as const;

const LARK_LC_AUTH_FAILED_CLOSE_RANGE = { max: 4999, min: 4000 } as const;
export const LARK_LC_DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const LARK_LC_MIN_HEARTBEAT_INTERVAL_MS = 1_000;

export interface LarkLongConnectionSocket {
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "message", listener: (event: { data: string }) => void): void;
  addEventListener(type: "open", listener: () => void): void;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export type LarkLongConnectionSocketFactory = (url: string) => LarkLongConnectionSocket;

export type LarkLongConnectionState = "closed" | "connected" | "handshake_pending" | "idle";

export type LarkLongConnectionCloseKind =
  | "auth_failed"
  | "client_initiated"
  | "protocol_violation"
  | "server_reconnect"
  | "transient";

export interface LarkLongConnectionCloseInfo {
  code: number;
  errorDetail: string | null;
  kind: LarkLongConnectionCloseKind;
  reason: string;
  serverReconnectUrl: string | null;
}

export interface LarkLongConnectionClientOptions {
  readonly defaultHeartbeatIntervalMs?: number;
  readonly nowMs?: () => number;
  readonly socketFactory: LarkLongConnectionSocketFactory;
}

export interface LarkLongConnectionRuntimeSnapshot {
  heartbeatIntervalMs: number;
  lastPongAtMs: number | null;
  state: LarkLongConnectionState;
}

export interface LarkLongConnectionTriggerHandler {
  (input: { envelope: LarkEventCallbackEnvelope; trigger: LarkWorkTrigger }): Promise<void> | void;
}

export interface LarkLongConnectionCloseHandler {
  (info: LarkLongConnectionCloseInfo): void;
}

export type LarkLongConnectionProtocolErrorCode =
  | "connect_reentry"
  | "decode_failed"
  | "envelope_invalid"
  | "frame_invalid_json"
  | "send_failed"
  | "socket_error"
  | "trigger_handler_failed"
  | "unsupported_frame_type";

export interface LarkLongConnectionProtocolErrorHandler {
  (input: { code: LarkLongConnectionProtocolErrorCode; detail: string }): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: Record<string, unknown>, field: string): number | null {
  const candidate = value[field];
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

function readString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value["message"] === "string") {
    return value["message"];
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "<unserializable>";
  }
}

function classifyCloseKind(input: { code: number }): LarkLongConnectionCloseKind {
  if (
    input.code >= LARK_LC_AUTH_FAILED_CLOSE_RANGE.min &&
    input.code <= LARK_LC_AUTH_FAILED_CLOSE_RANGE.max
  ) {
    return "auth_failed";
  }

  return "transient";
}

export class LarkLongConnectionClient {
  readonly #socketFactory: LarkLongConnectionSocketFactory;
  readonly #defaultHeartbeatIntervalMs: number;
  readonly #nowMs: () => number;

  #closeHandler: LarkLongConnectionCloseHandler | null = null;
  #heartbeatIntervalMs: number;
  #lastPongAtMs: number | null = null;
  #protocolErrorHandler: LarkLongConnectionProtocolErrorHandler | null = null;
  #socket: LarkLongConnectionSocket | null = null;
  #state: LarkLongConnectionState = "idle";
  #triggerHandler: LarkLongConnectionTriggerHandler | null = null;

  constructor(options: LarkLongConnectionClientOptions) {
    this.#socketFactory = options.socketFactory;
    this.#defaultHeartbeatIntervalMs =
      options.defaultHeartbeatIntervalMs ?? LARK_LC_DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.#heartbeatIntervalMs = this.#defaultHeartbeatIntervalMs;
    this.#nowMs = options.nowMs ?? (() => Date.now());
  }

  snapshot(): LarkLongConnectionRuntimeSnapshot {
    return {
      heartbeatIntervalMs: this.#heartbeatIntervalMs,
      lastPongAtMs: this.#lastPongAtMs,
      state: this.#state,
    };
  }

  onTrigger(handler: LarkLongConnectionTriggerHandler): void {
    this.#triggerHandler = handler;
  }

  onClose(handler: LarkLongConnectionCloseHandler): void {
    this.#closeHandler = handler;
  }

  onProtocolError(handler: LarkLongConnectionProtocolErrorHandler): void {
    this.#protocolErrorHandler = handler;
  }

  connect(url: string): void {
    if (this.#state !== "idle" && this.#state !== "closed") {
      this.#protocolErrorHandler?.({
        code: "connect_reentry",
        detail: `connect() called while client is in state '${this.#state}'.`,
      });
      return;
    }

    this.#state = "handshake_pending";
    this.#lastPongAtMs = null;
    this.#heartbeatIntervalMs = this.#defaultHeartbeatIntervalMs;

    const socket = this.#socketFactory(url);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      // Wait for hello frame to confirm handshake; nothing to send yet.
    });

    socket.addEventListener("message", (event) => {
      this.#onMessage(event.data);
    });

    socket.addEventListener("close", (event) => {
      this.#onSocketClose({ code: event.code, reason: event.reason });
    });

    socket.addEventListener("error", (event) => {
      const detail = describeUnknown(event);
      this.#protocolErrorHandler?.({ code: "socket_error", detail });
      this.#emitClose({
        code: 1006,
        errorDetail: detail,
        kind: "transient",
        reason: "socket error",
        serverReconnectUrl: null,
      });
    });
  }

  close(code = 1000, reason = "client_initiated"): void {
    if (this.#state === "closed" || this.#state === "idle") {
      return;
    }

    const socket = this.#socket;
    this.#emitClose({
      code,
      errorDetail: null,
      kind: "client_initiated",
      reason,
      serverReconnectUrl: null,
    });

    if (socket) {
      socket.close(code, reason);
    }
  }

  /**
   * Send one ping frame. The caller drives scheduling
   * from a Durable Object alarm so the heartbeat survives DO hibernation.
   * No-op when not in `connected` state or when no socket exists.
   */
  sendPing(): void {
    const socket = this.#socket;

    if (!socket || this.#state !== "connected") {
      return;
    }

    try {
      socket.send(JSON.stringify(LARK_LC_PROTOCOL.outboundPing));
    } catch (error) {
      this.#protocolErrorHandler?.({
        code: "send_failed",
        detail: describeUnknown(error),
      });
    }
  }

  #onMessage(raw: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#protocolErrorHandler?.({
        code: "frame_invalid_json",
        detail: "Lark long-connection frame must be valid JSON.",
      });
      return;
    }

    if (!isRecord(parsed)) {
      this.#protocolErrorHandler?.({
        code: "frame_invalid_json",
        detail: "Lark long-connection frame must be a JSON object.",
      });
      return;
    }

    const frameType = readString(parsed, LARK_LC_PROTOCOL.frameTypeField);

    if (frameType === LARK_LC_PROTOCOL.frameTypes.hello) {
      this.#onHello(parsed);
      return;
    }

    if (frameType === LARK_LC_PROTOCOL.frameTypes.pong) {
      this.#onPong();
      return;
    }

    if (frameType === LARK_LC_PROTOCOL.frameTypes.event) {
      this.#onEvent(parsed);
      return;
    }

    if (frameType === LARK_LC_PROTOCOL.frameTypes.reconnect) {
      this.#onReconnect(parsed);
      return;
    }

    this.#protocolErrorHandler?.({
      code: "unsupported_frame_type",
      detail: `Unknown Lark long-connection frame type: ${frameType ?? "<missing>"}.`,
    });
  }

  #onHello(parsed: Record<string, unknown>): void {
    const interval = readNumber(parsed, LARK_LC_PROTOCOL.heartbeatIntervalField);

    if (interval === null || interval < LARK_LC_MIN_HEARTBEAT_INTERVAL_MS) {
      const socket = this.#socket;
      this.#emitClose({
        code: 1002,
        errorDetail: `Lark hello frame missing or invalid ${LARK_LC_PROTOCOL.heartbeatIntervalField}.`,
        kind: "protocol_violation",
        reason: "invalid hello frame",
        serverReconnectUrl: null,
      });

      if (socket) {
        socket.close(1002, "invalid hello frame");
      }

      return;
    }

    this.#heartbeatIntervalMs = interval;
    this.#state = "connected";
    this.#lastPongAtMs = this.#nowMs();
  }

  #onPong(): void {
    this.#lastPongAtMs = this.#nowMs();
  }

  #onEvent(parsed: Record<string, unknown>): void {
    const eventType = readString(parsed, LARK_LC_PROTOCOL.eventTypeField);

    if (eventType !== LARK_EVENT_TYPE_RECEIVE_MESSAGE) {
      this.#protocolErrorHandler?.({
        code: "envelope_invalid",
        detail: `Unsupported event_type for trigger: ${eventType ?? "<missing>"}.`,
      });
      return;
    }

    const payload = parsed[LARK_LC_PROTOCOL.payloadField];
    const decoded = decodeLarkEventCallbackEnvelope(payload);

    if (!decoded.ok) {
      this.#protocolErrorHandler?.({
        code: "decode_failed",
        detail: `Lark long-connection event payload could not be decoded: ${decoded.code}.`,
      });
      return;
    }

    const trigger = normalizeLarkWorkTrigger(decoded.envelope);
    const handler = this.#triggerHandler;

    if (!handler) {
      return;
    }

    Promise.resolve(handler({ envelope: decoded.envelope, trigger })).catch((error: unknown) => {
      this.#protocolErrorHandler?.({
        code: "trigger_handler_failed",
        detail: describeUnknown(error),
      });
    });
  }

  #onReconnect(parsed: Record<string, unknown>): void {
    const reconnectUrl = readString(parsed, LARK_LC_PROTOCOL.reconnectUrlField);
    const socket = this.#socket;
    this.#emitClose({
      code: 1000,
      errorDetail: null,
      kind: "server_reconnect",
      reason: "server requested reconnect",
      serverReconnectUrl: reconnectUrl,
    });

    if (socket) {
      socket.close(1000, "server reconnect");
    }
  }

  #onSocketClose(input: { code: number; reason: string }): void {
    if (this.#state === "closed") {
      return;
    }

    this.#emitClose({
      code: input.code,
      errorDetail: null,
      kind: classifyCloseKind(input),
      reason: input.reason,
      serverReconnectUrl: null,
    });
  }

  #emitClose(info: LarkLongConnectionCloseInfo): void {
    if (this.#state === "closed") {
      return;
    }

    this.#state = "closed";
    this.#socket = null;
    this.#closeHandler?.(info);
  }
}
