#!/usr/bin/env bun
const DEFAULT_PORT = 5189;
const DEFAULT_LONGPOLL_MS = 1_500;
const PORT = readIntegerEnv(process.env.WECHAT_ILINK_MOCK_PORT, {
  defaultValue: DEFAULT_PORT,
  max: 65_535,
  min: 1,
});

const MOCK_QR_TOKEN = "mock-wechat-qr-token";
const MOCK_QR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="#ffffff"/>
  <g fill="#111827">
    <rect x="10" y="10" width="50" height="50"/>
    <rect x="20" y="20" width="30" height="30" fill="#ffffff"/>
    <rect x="28" y="28" width="14" height="14"/>
    <rect x="140" y="10" width="50" height="50"/>
    <rect x="150" y="20" width="30" height="30" fill="#ffffff"/>
    <rect x="158" y="28" width="14" height="14"/>
    <rect x="10" y="140" width="50" height="50"/>
    <rect x="20" y="150" width="30" height="30" fill="#ffffff"/>
    <rect x="28" y="158" width="14" height="14"/>
    <rect x="80" y="80" width="40" height="40"/>
    <rect x="90" y="90" width="20" height="20" fill="#ffffff"/>
    <rect x="70" y="30" width="10" height="10"/>
    <rect x="90" y="30" width="10" height="10"/>
    <rect x="110" y="30" width="10" height="10"/>
    <rect x="80" y="50" width="10" height="10"/>
    <rect x="100" y="50" width="10" height="10"/>
    <rect x="120" y="50" width="10" height="10"/>
    <rect x="80" y="70" width="10" height="10"/>
    <rect x="130" y="70" width="10" height="10"/>
    <rect x="70" y="130" width="10" height="10"/>
    <rect x="90" y="130" width="10" height="10"/>
    <rect x="110" y="130" width="10" height="10"/>
    <rect x="130" y="130" width="10" height="10"/>
    <rect x="80" y="150" width="10" height="10"/>
    <rect x="100" y="150" width="10" height="10"/>
    <rect x="120" y="150" width="10" height="10"/>
    <rect x="140" y="80" width="10" height="10"/>
    <rect x="160" y="80" width="10" height="10"/>
    <rect x="180" y="80" width="10" height="10"/>
    <rect x="150" y="100" width="10" height="10"/>
    <rect x="170" y="100" width="10" height="10"/>
    <rect x="140" y="120" width="10" height="10"/>
    <rect x="160" y="120" width="10" height="10"/>
    <rect x="180" y="120" width="10" height="10"/>
    <rect x="140" y="140" width="10" height="10"/>
    <rect x="160" y="140" width="10" height="10"/>
    <rect x="180" y="140" width="10" height="10"/>
    <rect x="150" y="160" width="10" height="10"/>
    <rect x="170" y="160" width="10" height="10"/>
    <rect x="150" y="180" width="10" height="10"/>
    <rect x="170" y="180" width="10" height="10"/>
  </g>
  <text x="100" y="115" font-family="ui-monospace, Menlo, monospace" font-size="11" text-anchor="middle" fill="#ffffff">MOCK</text>
</svg>`;
const MOCK_QR_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(MOCK_QR_SVG).toString("base64")}`;

type StatusPhase = "wait" | "scaned" | "confirmed";

const STATUS_SEQUENCE: ReadonlyArray<StatusPhase> = ["wait", "wait", "scaned", "confirmed"];
const pollCounts = new Map<string, number>();
const MOCK_ILINK_USER_ID = "mock-user-id";
const MOCK_ILINK_BOT_ID = "mock-bot-id";
const MOCK_PEER_ID = "mock-peer-id";
const MOCK_LONGPOLL_MS = readIntegerEnv(process.env.WECHAT_ILINK_MOCK_LONGPOLL_MS, {
  defaultValue: DEFAULT_LONGPOLL_MS,
  min: 0,
});

interface PendingMockMessage {
  context_token: string;
  from_user_id: string;
  item_list: Array<{ text_item: { text: string }; type: number }>;
  message_id: string;
  message_state: number;
  message_type: number;
  to_user_id: string;
}

const pendingMessages: PendingMockMessage[] = [];

function readIntegerEnv(
  raw: string | undefined,
  options: { defaultValue: number; max?: number; min: number },
): number {
  if (raw === undefined || raw.trim().length === 0) {
    return options.defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < options.min) {
    return options.defaultValue;
  }

  return options.max === undefined ? parsed : Math.min(parsed, options.max);
}

function createQrBody(): { qrcode_img_content: string; qrcode: string } {
  return {
    qrcode: MOCK_QR_TOKEN,
    qrcode_img_content: MOCK_QR_DATA_URL,
  };
}

function nextStatus(token: string): StatusPhase {
  const current = pollCounts.get(token) ?? 0;
  const phase = STATUS_SEQUENCE[Math.min(current, STATUS_SEQUENCE.length - 1)] ?? "wait";
  pollCounts.set(token, current + 1);
  return phase;
}

function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseInjectPayload(payload: unknown): { peerId: string; text: string } | null {
  if (!isRecord(payload)) {
    return null;
  }

  const text = readTrimmedString(payload, "text");

  if (text === null) {
    return null;
  }

  return {
    peerId: readTrimmedString(payload, "peerId") ?? MOCK_PEER_ID,
    text,
  };
}

function readGetUpdatesCursor(payload: unknown): string {
  if (isRecord(payload)) {
    const candidate = payload["get_updates_buf"];
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return "";
}

function nextGetUpdatesCursor(cursor: string): string {
  const match = /^mock-cursor-(\d+)$/u.exec(cursor);
  if (match) {
    const next = Number.parseInt(match[1] ?? "0", 10) + 1;
    return `mock-cursor-${next}`;
  }
  return "mock-cursor-1";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/_mock/inject") {
      const payload = parseInjectPayload(await readJson(request));
      if (payload === null) {
        return Response.json({ error: "missing_text" }, { status: 400 });
      }
      pendingMessages.push({
        context_token: `mock-ctx-${Date.now()}`,
        from_user_id: payload.peerId,
        item_list: [{ text_item: { text: payload.text }, type: 1 }],
        message_id: `${Date.now()}`,
        message_state: 2,
        message_type: 1,
        to_user_id: MOCK_ILINK_BOT_ID,
      });
      return Response.json({ ok: true, pending: pendingMessages.length });
    }

    if (request.method === "GET" && path === "/ilink/bot/get_bot_qrcode") {
      pollCounts.delete(MOCK_QR_TOKEN);
      return Response.json(createQrBody());
    }

    if (request.method === "GET" && path === "/ilink/bot/get_qrcode_status") {
      const qrcode = url.searchParams.get("qrcode") ?? "";
      const phase = nextStatus(qrcode);

      if (phase === "confirmed") {
        return Response.json({
          base_info: { channel_version: "2.2.0" },
          baseurl: `http://localhost:${PORT}`,
          bot_token: "mock-bot-token",
          ilink_bot_id: MOCK_ILINK_BOT_ID,
          ilink_user_id: MOCK_ILINK_USER_ID,
          status: "confirmed",
        });
      }

      return Response.json({ status: phase });
    }

    if (request.method === "POST" && path === "/ilink/bot/sendmessage") {
      return Response.json({ errcode: 0, errmsg: "ok", ret: 0 });
    }

    if (request.method === "POST" && path === "/ilink/bot/getupdates") {
      const cursor = readGetUpdatesCursor(await readJson(request));
      const drained = pendingMessages.splice(0, pendingMessages.length);
      if (drained.length === 0 && MOCK_LONGPOLL_MS > 0) {
        await delay(MOCK_LONGPOLL_MS);
      }
      return Response.json({
        errcode: 0,
        errmsg: "",
        get_updates_buf: nextGetUpdatesCursor(cursor),
        longpolling_timeout_ms: MOCK_LONGPOLL_MS,
        msgs: drained,
        ret: 0,
      });
    }

    return new Response(`Not found: ${request.method} ${path}`, { status: 404 });
  },
});

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

log(`WeChat iLink mock listening on http://localhost:${server.port}`);
log(`  set WECHAT_ILINK_BASE_URL=http://localhost:${server.port} in apps/api/.dev.vars`);
log(`  QR token: ${MOCK_QR_TOKEN}`);
log(`  ilink_user_id: ${MOCK_ILINK_USER_ID}`);
log(`  status sequence: ${STATUS_SEQUENCE.join(" -> ")}`);
log(`  getupdates long-poll: ${MOCK_LONGPOLL_MS}ms (override with WECHAT_ILINK_MOCK_LONGPOLL_MS)`);
log(
  `  inject a DM: curl -X POST http://localhost:${server.port}/_mock/inject -d '{"peerId":"...","text":"..."}' -H 'content-type: application/json'`,
);
