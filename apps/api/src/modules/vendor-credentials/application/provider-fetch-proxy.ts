import type { ApiBindings } from "../../../platform/cloudflare/worker-types";

export interface ProviderFetchProxyConfig {
  token: string;
  url: string;
}

export function resolveProviderFetchProxy(
  bindings: Pick<
    ApiBindings,
    "MOSOO_PROVIDER_FETCH_PROXY_TOKEN" | "MOSOO_PROVIDER_FETCH_PROXY_URL" | "WEB_ORIGIN"
  >,
): ProviderFetchProxyConfig | null {
  if (!isLocalWebOrigin(bindings.WEB_ORIGIN)) {
    return null;
  }

  const url = bindings.MOSOO_PROVIDER_FETCH_PROXY_URL?.trim() ?? "";
  const token = bindings.MOSOO_PROVIDER_FETCH_PROXY_TOKEN?.trim() ?? "";

  if (url.length === 0 || token.length === 0) {
    return null;
  }

  return { token, url };
}

export async function fetchViaProviderProxy(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchProxy: ProviderFetchProxyConfig,
  signal?: AbortSignal,
): Promise<Response> {
  const proxyResponse = await fetch(fetchProxy.url, {
    body: JSON.stringify({
      body: serializeBody(init.body),
      headers: serializeHeaders(init.headers),
      method: init.method ?? "GET",
      timeoutMs,
      url,
    }),
    headers: {
      Authorization: `Bearer ${fetchProxy.token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    ...(signal === undefined ? {} : { signal }),
  });

  if (!proxyResponse.ok) {
    return proxyResponse;
  }

  const payload: unknown = await proxyResponse.json();

  if (!isRecord(payload)) {
    return Response.json({ error: "Invalid provider fetch proxy response." }, { status: 502 });
  }

  const body = payload["body"];
  const headers = payload["headers"];
  const status = payload["status"];

  if (typeof body !== "string" || typeof status !== "number" || !isRecord(headers)) {
    return Response.json({ error: "Invalid provider fetch proxy response." }, { status: 502 });
  }

  return new Response(body, {
    headers: Object.fromEntries(
      Object.entries(headers).filter((entry): entry is [string, string] => {
        const [key, value] = entry;
        return typeof key === "string" && typeof value === "string";
      }),
    ),
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLocalWebOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function serializeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const serialized: Record<string, string> = {};
  const normalized = new Headers(headers);

  for (const [key, value] of normalized.entries()) {
    serialized[key] = value;
  }

  return serialized;
}

function serializeBody(body: BodyInit | null | undefined): string | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (typeof body === "string") {
    return body;
  }

  throw new Error("Provider fetch proxy only supports string request bodies.");
}
