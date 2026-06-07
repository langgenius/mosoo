import { describe, expect, test } from "bun:test";

import {
  fetchViaProviderProxy,
  resolveProviderFetchProxy,
} from "../src/modules/vendor-credentials/application/provider-fetch-proxy";

function readRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function readStringBody(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") {
    throw new Error("Expected string body.");
  }

  return body;
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

describe("provider fetch proxy", () => {
  test("enables only local provider fetch proxy URLs from local web origins", () => {
    expect(
      resolveProviderFetchProxy({
        MOSOO_PROVIDER_FETCH_PROXY_TOKEN: "proxy-token",
        MOSOO_PROVIDER_FETCH_PROXY_URL: "http://127.0.0.1:3456/fetch",
        WEB_ORIGIN: "http://localhost:5173",
      }),
    ).toEqual({
      token: "proxy-token",
      url: "http://127.0.0.1:3456/fetch",
    });

    expect(
      resolveProviderFetchProxy({
        MOSOO_PROVIDER_FETCH_PROXY_TOKEN: "proxy-token",
        MOSOO_PROVIDER_FETCH_PROXY_URL: "https://proxy.example.com/fetch",
        WEB_ORIGIN: "http://localhost:5173",
      }),
    ).toBeNull();

    expect(
      resolveProviderFetchProxy({
        MOSOO_PROVIDER_FETCH_PROXY_TOKEN: "proxy-token",
        MOSOO_PROVIDER_FETCH_PROXY_URL: "http://127.0.0.1:3456/fetch",
        WEB_ORIGIN: "https://app.example.com",
      }),
    ).toBeNull();
  });

  test("sends provider auth only inside the loopback proxy envelope", async () => {
    const originalFetch = globalThis.fetch;
    const abortController = new AbortController();
    let captured: {
      init?: RequestInit;
      url: string;
    } | null = null;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        init,
        url: readRequestUrl(input),
      };
      return Response.json({
        body: '{"ok":true}',
        headers: {
          "content-type": "application/json",
          "x-provider": "accepted",
        },
        status: 201,
      });
    };

    try {
      const response = await fetchViaProviderProxy(
        "https://api.example.com/v1/chat/completions",
        {
          body: '{"model":"gpt-test"}',
          headers: {
            Authorization: "Bearer provider-key",
            "Content-Type": "application/json",
          },
          method: "POST",
        },
        12_000,
        {
          token: "proxy-token",
          url: "http://127.0.0.1:3456/fetch",
        },
        abortController.signal,
      );

      expect(captured).not.toBeNull();
      expect(captured?.url).toBe("http://127.0.0.1:3456/fetch");
      expect(captured?.init?.method).toBe("POST");
      expect(captured?.init?.signal).toBe(abortController.signal);
      expect(readHeader(captured?.init?.headers, "Authorization")).toBe("Bearer proxy-token");
      expect(readHeader(captured?.init?.headers, "Content-Type")).toBe("application/json");
      expect(JSON.stringify(captured?.init?.headers)).not.toContain("provider-key");

      const envelope = JSON.parse(readStringBody(captured?.init?.body)) as {
        body: string;
        headers: Record<string, string>;
        method: string;
        timeoutMs: number;
        url: string;
      };
      expect(envelope).toEqual({
        body: '{"model":"gpt-test"}',
        headers: {
          authorization: "Bearer provider-key",
          "content-type": "application/json",
        },
        method: "POST",
        timeoutMs: 12_000,
        url: "https://api.example.com/v1/chat/completions",
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("x-provider")).toBe("accepted");
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns a bad-gateway response for malformed successful proxy payloads", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({
        body: { ok: true },
        headers: {},
        status: 200,
      });

    try {
      const response = await fetchViaProviderProxy(
        "https://api.example.com/v1/models",
        { method: "GET" },
        5_000,
        {
          token: "proxy-token",
          url: "http://127.0.0.1:3456/fetch",
        },
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Invalid provider fetch proxy response." });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves non-ok proxy responses instead of treating them as provider success", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ error: "proxy unavailable" }, { status: 503 });

    try {
      const response = await fetchViaProviderProxy(
        "https://api.example.com/v1/models",
        { method: "GET" },
        5_000,
        {
          token: "proxy-token",
          url: "http://127.0.0.1:3456/fetch",
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "proxy unavailable" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
