#!/usr/bin/env bun
// Local-only bridge for Lark long-connection mode. The official SDK is
// Node-only, so this process owns WSClient and forwards decoded events to the
// worker over authenticated loopback HTTP.

import * as lark from "@larksuiteoapi/node-sdk";

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const WORKER_URL = process.env.MOSOO_API_BASE_URL?.trim();
const SECRET = process.env.MOSOO_LARK_SIDECAR_SECRET?.trim();

if (!WORKER_URL || !SECRET) {
  process.stderr.write(
    "[lark-ws-sidecar] missing MOSOO_API_BASE_URL or MOSOO_LARK_SIDECAR_SECRET; exiting\n",
  );
  process.exit(1);
}

const workerUrl: string = WORKER_URL;
const secret: string = SECRET;
const pollIntervalMs = readPollIntervalMs(process.env.MOSOO_LARK_SIDECAR_POLL_MS);

interface BindingDescriptor {
  appId: string;
  appSecret: string;
  bindingId: string;
  domain: "feishu" | "lark";
}

interface Session {
  client: lark.WSClient;
  descriptor: BindingDescriptor;
}

function log(message: string): void {
  process.stdout.write(`[lark-ws-sidecar] ${message}\n`);
}

function readPollIntervalMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= MIN_POLL_INTERVAL_MS
    ? parsed
    : DEFAULT_POLL_INTERVAL_MS;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (error === undefined || error === null) {
    return "";
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "<unstringifiable error>";
  }
}

function logError(message: string, error?: unknown): void {
  const detail = describeError(error);
  process.stderr.write(`[lark-ws-sidecar] ${message}${detail ? ` - ${detail}` : ""}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Lark sidecar binding ${field} is required.`);
  }

  return value;
}

function readDomain(record: Record<string, unknown>): BindingDescriptor["domain"] {
  const value = record["domain"];

  if (value === "feishu" || value === "lark") {
    return value;
  }

  throw new Error("Lark sidecar binding domain must be feishu or lark.");
}

function readDescriptor(value: unknown): BindingDescriptor {
  if (!isRecord(value)) {
    throw new Error("Lark sidecar binding must be an object.");
  }

  return {
    appId: readString(value, "appId"),
    appSecret: readString(value, "appSecret"),
    bindingId: readString(value, "bindingId"),
    domain: readDomain(value),
  };
}

function readDescriptorList(value: unknown): BindingDescriptor[] {
  if (!isRecord(value) || !Array.isArray(value["bindings"])) {
    throw new Error("Lark sidecar bindings response must contain a bindings array.");
  }

  return value["bindings"].map(readDescriptor);
}

// The SDK's EventDispatcher flattens envelopes for typed handlers. The worker
// owns canonical decoding, so this dispatcher forwards the raw parsed envelope.
class ForwardingDispatcher extends lark.EventDispatcher {
  readonly #bindingId: string;

  constructor(bindingId: string) {
    super({});
    this.#bindingId = bindingId;
  }

  async invoke(envelope: unknown, _params?: { needCheck?: boolean }): Promise<unknown> {
    try {
      const response = await fetch(
        `${workerUrl}/api/v1/internal/lark-gateway/event/${this.#bindingId}`,
        {
          body: JSON.stringify({ envelope }),
          headers: {
            "content-type": "application/json",
            "x-sidecar-auth": secret,
          },
          method: "POST",
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "<no body>");
        logError(
          `forward to worker failed (binding ${this.#bindingId}, HTTP ${response.status}): ${text.slice(0, 200)}`,
        );
      }
    } catch (error) {
      logError(`forward to worker threw (binding ${this.#bindingId})`, error);
    }

    return undefined;
  }
}

const sessions = new Map<string, Session>();
let shuttingDown = false;

function resolveSdkDomain(domain: "feishu" | "lark"): lark.Domain {
  return domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
}

async function fetchDescriptors(): Promise<BindingDescriptor[]> {
  const response = await fetch(`${workerUrl}/api/v1/internal/lark-gateway/bindings`, {
    headers: { "x-sidecar-auth": secret },
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return readDescriptorList(await response.json());
}

function startSession(descriptor: BindingDescriptor): Session {
  log(
    `starting WS for binding ${descriptor.bindingId} (app ${descriptor.appId}, domain ${descriptor.domain})`,
  );

  const dispatcher = new ForwardingDispatcher(descriptor.bindingId);
  const client = new lark.WSClient({
    appId: descriptor.appId,
    appSecret: descriptor.appSecret,
    autoReconnect: true,
    domain: resolveSdkDomain(descriptor.domain),
    loggerLevel: lark.LoggerLevel.warn,
    onError: (error: unknown) => {
      logError(`WS error for binding ${descriptor.bindingId}`, error);
    },
    onReady: () => {
      log(`WS ready for binding ${descriptor.bindingId}`);
    },
    onReconnecting: () => {
      log(`WS reconnecting for binding ${descriptor.bindingId}`);
    },
  });

  void client.start({ eventDispatcher: dispatcher });

  return { client, descriptor };
}

function stopSession(bindingId: string, session: Session): void {
  log(`stopping WS for binding ${bindingId}`);
  try {
    session.client.close({ force: true });
  } catch (error) {
    logError(`close threw for binding ${bindingId}`, error);
  }
}

async function reconcile(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  let descriptors: BindingDescriptor[];
  try {
    descriptors = await fetchDescriptors();
  } catch (error) {
    logError("fetchDescriptors failed", error);
    return;
  }

  const wanted = new Map(descriptors.map((d) => [d.bindingId, d]));

  for (const [bindingId, session] of sessions.entries()) {
    const next = wanted.get(bindingId);
    if (!next) {
      stopSession(bindingId, session);
      sessions.delete(bindingId);
      continue;
    }
    if (
      next.appId !== session.descriptor.appId ||
      next.appSecret !== session.descriptor.appSecret ||
      next.domain !== session.descriptor.domain
    ) {
      log(`credentials changed for binding ${bindingId}; recycling session`);
      stopSession(bindingId, session);
      sessions.delete(bindingId);
    }
  }

  for (const descriptor of descriptors) {
    if (sessions.has(descriptor.bindingId)) {
      continue;
    }
    try {
      const session = startSession(descriptor);
      sessions.set(descriptor.bindingId, session);
    } catch (error) {
      logError(`startSession failed for ${descriptor.bindingId}`, error);
    }
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log(`received ${signal}, closing ${sessions.size} session(s)`);
    for (const [bindingId, session] of sessions.entries()) {
      stopSession(bindingId, session);
    }
    sessions.clear();
    process.exit(0);
  });
}

log(`starting (worker=${workerUrl}, poll=${pollIntervalMs}ms)`);

void reconcile();
setInterval(() => void reconcile(), pollIntervalMs);
