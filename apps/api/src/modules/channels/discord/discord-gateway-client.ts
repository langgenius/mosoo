import type { DiscordGatewayDispatchEnvelope } from "./discord-events";
import { parseDiscordGatewayDispatchEnvelope } from "./discord-events";
import type {
  DiscordGatewayRuntimeSnapshot,
  DiscordGatewayRuntimeStatus,
} from "./discord-gateway-health";

const DISCORD_GATEWAY_OP_DISPATCH = 0;
const DISCORD_GATEWAY_OP_HEARTBEAT = 1;
const DISCORD_GATEWAY_OP_IDENTIFY = 2;
const DISCORD_GATEWAY_OP_RESUME = 6;
const DISCORD_GATEWAY_OP_RECONNECT = 7;
const DISCORD_GATEWAY_OP_INVALID_SESSION = 9;
const DISCORD_GATEWAY_OP_HELLO = 10;
const DISCORD_GATEWAY_OP_HEARTBEAT_ACK = 11;

const DISCORD_GATEWAY_CLOSE_RECONNECT = 4000;

export const DISCORD_GATEWAY_DEFAULT_INTENTS =
  (1 << 0) /* Guilds */ |
  (1 << 9) /* Guild messages */ |
  (1 << 12) /* Direct messages */ |
  (1 << 15); /* Message content */

export interface DiscordGatewayWritableSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export interface DiscordGatewayResumeState {
  resumeGatewayUrl: string | null;
  sequence: number | null;
  sessionId: string;
}

interface CompleteDiscordGatewayResumeState {
  resumeGatewayUrl: string;
  sequence: number;
  sessionId: string;
}

export interface DiscordGatewayClientOptions {
  intents?: number;
  nowMs: () => number;
  onDispatch: (dispatch: DiscordGatewayDispatchEnvelope) => void;
  resumeState?: DiscordGatewayResumeState | null;
  socket: DiscordGatewayWritableSocket;
  token: string;
}

export type DiscordGatewayClientAction =
  | "dispatch"
  | "heartbeat_ack"
  | "heartbeat_requested"
  | "identified"
  | "ignored"
  | "invalid_session"
  | "protocol_error"
  | "reconnect_requested"
  | "resumed";

interface DiscordGatewayPayload {
  data: unknown;
  op: number;
  sequence: number | null;
  type: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function readNumber(value: unknown, field: string): number | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[field];
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

function parseGatewayPayload(rawMessage: string): DiscordGatewayPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    throw new Error("Discord gateway message must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Discord gateway message must be a JSON object.");
  }

  const op = readNumber(parsed, "op");

  if (op === null) {
    throw new Error("Discord gateway message op is required.");
  }

  return {
    data: parsed["d"],
    op,
    sequence: readNumber(parsed, "s"),
    type: readString(parsed, "t"),
  };
}

function readHeartbeatIntervalMs(data: unknown): number {
  const interval = readNumber(data, "heartbeat_interval");

  if (interval === null || interval <= 0) {
    throw new Error("Discord gateway HELLO is missing heartbeat_interval.");
  }

  return interval;
}

function buildIdentifyFrame(input: { intents: number; token: string }): string {
  return JSON.stringify({
    d: {
      intents: input.intents,
      properties: {
        browser: "mosoo",
        device: "mosoo",
        os: "cloudflare",
      },
      token: input.token,
    },
    op: DISCORD_GATEWAY_OP_IDENTIFY,
  });
}

function buildResumeFrame(input: { sequence: number; sessionId: string; token: string }): string {
  return JSON.stringify({
    d: {
      seq: input.sequence,
      session_id: input.sessionId,
      token: input.token,
    },
    op: DISCORD_GATEWAY_OP_RESUME,
  });
}

function buildHeartbeatFrame(sequence: number | null): string {
  return JSON.stringify({
    d: sequence,
    op: DISCORD_GATEWAY_OP_HEARTBEAT,
  });
}

export class DiscordGatewayClient {
  readonly #intents: number;
  readonly #nowMs: () => number;
  readonly #onDispatch: (dispatch: DiscordGatewayDispatchEnvelope) => void;
  readonly #socket: DiscordGatewayWritableSocket;
  readonly #token: string;
  #snapshot: DiscordGatewayRuntimeSnapshot;

  constructor(options: DiscordGatewayClientOptions) {
    this.#intents = options.intents ?? DISCORD_GATEWAY_DEFAULT_INTENTS;
    this.#nowMs = options.nowMs;
    this.#onDispatch = options.onDispatch;
    this.#socket = options.socket;
    this.#token = options.token;
    const nowMs = options.nowMs();
    this.#snapshot = {
      connectedAtMs: null,
      heartbeatIntervalMs: null,
      lastCloseCode: null,
      lastDispatchAtMs: null,
      lastErrorCode: null,
      lastHeartbeatAckAtMs: null,
      lastHeartbeatSentAtMs: null,
      resumeGatewayUrl: options.resumeState?.resumeGatewayUrl ?? null,
      sequence: options.resumeState?.sequence ?? null,
      sessionId: options.resumeState?.sessionId ?? null,
      status: "connecting",
      statusChangedAtMs: nowMs,
    };
  }

  getSnapshot(): DiscordGatewayRuntimeSnapshot {
    return { ...this.#snapshot };
  }

  handleMessage(rawMessage: string): DiscordGatewayClientAction {
    const payload = parseGatewayPayload(rawMessage);

    switch (payload.op) {
      case DISCORD_GATEWAY_OP_HELLO: {
        const nowMs = this.#nowMs();
        this.#snapshot = {
          ...this.#snapshot,
          connectedAtMs: nowMs,
          heartbeatIntervalMs: readHeartbeatIntervalMs(payload.data),
          status: "connected",
          statusChangedAtMs: nowMs,
        };

        const resumeState = this.#getCompleteResumeState();

        if (resumeState) {
          this.#socket.send(
            buildResumeFrame({
              sequence: resumeState.sequence,
              sessionId: resumeState.sessionId,
              token: this.#token,
            }),
          );
          return "resumed";
        }

        this.#clearResumeState();
        this.#socket.send(
          buildIdentifyFrame({
            intents: this.#intents,
            token: this.#token,
          }),
        );
        return "identified";
      }
      case DISCORD_GATEWAY_OP_HEARTBEAT: {
        this.sendHeartbeat();
        return "heartbeat_requested";
      }
      case DISCORD_GATEWAY_OP_HEARTBEAT_ACK: {
        this.#snapshot = {
          ...this.#snapshot,
          lastHeartbeatAckAtMs: this.#nowMs(),
        };
        return "heartbeat_ack";
      }
      case DISCORD_GATEWAY_OP_RECONNECT: {
        this.#markClosing("reconnecting", DISCORD_GATEWAY_CLOSE_RECONNECT, null);
        this.#socket.close(DISCORD_GATEWAY_CLOSE_RECONNECT, "Discord gateway requested reconnect.");
        return "reconnect_requested";
      }
      case DISCORD_GATEWAY_OP_INVALID_SESSION: {
        const canResume = payload.data === true && this.#getCompleteResumeState() !== null;
        this.#snapshot = {
          ...this.#snapshot,
          lastErrorCode: "invalid_session",
          resumeGatewayUrl: canResume ? this.#snapshot.resumeGatewayUrl : null,
          sequence: canResume ? this.#snapshot.sequence : null,
          sessionId: canResume ? this.#snapshot.sessionId : null,
          status: "reconnecting",
          statusChangedAtMs: this.#nowMs(),
        };
        this.#socket.close(DISCORD_GATEWAY_CLOSE_RECONNECT, "Discord gateway invalid session.");
        return "invalid_session";
      }
      case DISCORD_GATEWAY_OP_DISPATCH: {
        if (payload.sequence === null) {
          this.#snapshot = {
            ...this.#snapshot,
            lastErrorCode: "missing_dispatch_sequence",
            status: "reconnecting",
            statusChangedAtMs: this.#nowMs(),
          };
          this.#socket.close(
            DISCORD_GATEWAY_CLOSE_RECONNECT,
            "Discord gateway dispatch is missing a sequence.",
          );
          return "protocol_error";
        }

        this.#snapshot = {
          ...this.#snapshot,
          lastDispatchAtMs: this.#nowMs(),
          sequence: payload.sequence,
        };
        this.#recordReady(payload);
        return this.#dispatchMessageCreate(rawMessage) ? "dispatch" : "ignored";
      }
      default: {
        return "ignored";
      }
    }
  }

  sendHeartbeat(): void {
    this.#socket.send(buildHeartbeatFrame(this.#snapshot.sequence));
    this.#snapshot = {
      ...this.#snapshot,
      lastHeartbeatSentAtMs: this.#nowMs(),
    };
  }

  handleClose(code: number): void {
    if (this.#snapshot.status === "reconnecting" && code === DISCORD_GATEWAY_CLOSE_RECONNECT) {
      this.#snapshot = {
        ...this.#snapshot,
        lastCloseCode: code,
      };
      return;
    }

    this.#markClosing("stopped", code, null);
  }

  handleError(errorCode: string): void {
    this.#snapshot = {
      ...this.#snapshot,
      lastErrorCode: errorCode,
      status: "reconnecting",
      statusChangedAtMs: this.#nowMs(),
    };
  }

  recordRecoverableError(errorCode: string): void {
    this.#snapshot = {
      ...this.#snapshot,
      lastErrorCode: errorCode,
    };
  }

  #dispatchMessageCreate(rawMessage: string): boolean {
    const parsed = parseDiscordGatewayDispatchEnvelope(rawMessage);

    if (!parsed.ok) {
      return false;
    }

    this.#onDispatch(parsed.envelope);
    return true;
  }

  #getCompleteResumeState(): CompleteDiscordGatewayResumeState | null {
    if (
      this.#snapshot.resumeGatewayUrl === null ||
      this.#snapshot.sequence === null ||
      this.#snapshot.sessionId === null
    ) {
      return null;
    }

    return {
      resumeGatewayUrl: this.#snapshot.resumeGatewayUrl,
      sequence: this.#snapshot.sequence,
      sessionId: this.#snapshot.sessionId,
    };
  }

  #clearResumeState(): void {
    this.#snapshot = {
      ...this.#snapshot,
      resumeGatewayUrl: null,
      sequence: null,
      sessionId: null,
    };
  }

  #markClosing(
    status: DiscordGatewayRuntimeStatus,
    closeCode: number,
    errorCode: string | null,
  ): void {
    this.#snapshot = {
      ...this.#snapshot,
      lastCloseCode: closeCode,
      lastErrorCode: errorCode,
      status,
      statusChangedAtMs: this.#nowMs(),
    };
  }

  #recordReady(payload: DiscordGatewayPayload): void {
    if (payload.type !== "READY") {
      return;
    }

    const sessionId = readString(payload.data, "session_id");

    if (!sessionId) {
      return;
    }

    this.#snapshot = {
      ...this.#snapshot,
      resumeGatewayUrl: readString(payload.data, "resume_gateway_url"),
      sessionId,
    };
  }
}
