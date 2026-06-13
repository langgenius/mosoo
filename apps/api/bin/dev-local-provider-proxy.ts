import type { BunRuntime, BunServer } from "../../../config/bun-script-types";

declare const Bun: BunRuntime;

const PROVIDER_FETCH_PROXY_TOKEN_ENV_KEY = "MOSOO_PROVIDER_FETCH_PROXY_TOKEN";
const PROVIDER_FETCH_PROXY_URL_ENV_KEY = "MOSOO_PROVIDER_FETCH_PROXY_URL";

interface LocalProviderFetchProxy {
  server?: BunServer;
  token: string;
  url: string;
}

interface ProviderProxyPayload {
  body: string | null;
  headers: Record<string, string>;
  method: string;
  timeoutMs: number;
  url: string;
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonResponse(status: number, payload: unknown): Response {
  return Response.json(payload, { status });
}

function parseProviderProxyPayload(payload: unknown): ProviderProxyPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const { body, headers, method, timeoutMs, url } = payload;

  if (
    typeof url !== "string" ||
    typeof method !== "string" ||
    !isRecord(headers) ||
    !(typeof timeoutMs === "number" && Number.isFinite(timeoutMs)) ||
    !(body === null || typeof body === "string")
  ) {
    return null;
  }

  const normalizedHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      return null;
    }

    normalizedHeaders[key] = value;
  }

  return {
    body,
    headers: normalizedHeaders,
    method,
    timeoutMs: Math.min(Math.max(Math.trunc(timeoutMs), 1000), 60_000),
    url,
  };
}

function validateProviderProxyUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function handleProviderProxyRequest(token: string, request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method !== "POST" || url.pathname !== "/fetch") {
    return jsonResponse(404, { error: "not_found" });
  }

  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return jsonResponse(403, { error: "forbidden" });
  }

  let requestBody: unknown;
  try {
    requestBody = request.headers.get("content-length") === "0" ? null : await request.json();
  } catch {
    return jsonResponse(400, { error: "invalid_request" });
  }

  const payload = parseProviderProxyPayload(requestBody);
  const targetUrl = payload === null ? null : validateProviderProxyUrl(payload.url);

  if (payload === null || targetUrl === null) {
    return jsonResponse(400, { error: "invalid_request" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, payload.timeoutMs);

  try {
    const upstream = await fetch(targetUrl, {
      ...(payload.body === null ? {} : { body: payload.body }),
      headers: payload.headers,
      method: payload.method,
      signal: controller.signal,
    });
    return jsonResponse(200, {
      body: await upstream.text(),
      headers: Object.fromEntries(upstream.headers.entries()),
      status: upstream.status,
    });
  } catch (error) {
    return jsonResponse(error instanceof DOMException && error.name === "AbortError" ? 504 : 502, {
      error: error instanceof Error ? error.message : "provider_fetch_failed",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function startLocalProviderFetchProxy(
  env: NodeJS.ProcessEnv,
): Promise<LocalProviderFetchProxy | null> {
  const configuredUrl = env[PROVIDER_FETCH_PROXY_URL_ENV_KEY]?.trim();
  const configuredToken = env[PROVIDER_FETCH_PROXY_TOKEN_ENV_KEY]?.trim();

  if (
    configuredUrl !== undefined &&
    configuredUrl.length > 0 &&
    configuredToken !== undefined &&
    configuredToken.length > 0
  ) {
    return { token: configuredToken, url: configuredUrl };
  }

  const token = crypto.randomUUID();
  const server = Bun.serve({
    fetch: async (request) =>
      handleProviderProxyRequest(token, request).catch((error: unknown) =>
        jsonResponse(500, {
          error: error instanceof Error ? error.message : "provider_proxy_failed",
        }),
      ),
    hostname: "127.0.0.1",
    port: 0,
  });

  const url = `http://127.0.0.1:${server.port}/fetch`;
  writeStderr(`[mosoo/api] Started local provider fetch proxy for wrangler dev: ${url}`);

  return { server, token, url };
}

export function createProviderFetchProxyVarArgs(proxy: LocalProviderFetchProxy | null): string[] {
  if (proxy === null) {
    return [];
  }

  return [
    "--var",
    `${PROVIDER_FETCH_PROXY_URL_ENV_KEY}:${proxy.url}`,
    "--var",
    `${PROVIDER_FETCH_PROXY_TOKEN_ENV_KEY}:${proxy.token}`,
  ];
}
