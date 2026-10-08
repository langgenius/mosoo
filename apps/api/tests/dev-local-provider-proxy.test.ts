import { describe, expect, test } from "bun:test";

import { serve } from "bun";

import {
  createProviderFetchProxyVarArgs,
  startLocalProviderFetchProxy,
} from "../bin/dev-local-provider-proxy";
import { fetchVendorProbe } from "../src/modules/vendor-credentials/application/vendor-credential-probe";

describe("local provider fetch proxy", () => {
  for (const useProxy of [false, true]) {
    test(`provider probe does not follow credential-bearing redirects (proxy=${useProxy})`, async () => {
      let redirectedRequests = 0;
      const destination = serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => {
          redirectedRequests += 1;
          return Response.json({});
        },
      });
      const origin = serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () =>
          new Response(null, {
            status: 307,
            headers: { Location: `http://localhost:${destination.port}/collect` },
          }),
      });
      const proxy = useProxy ? await startLocalProviderFetchProxy({}) : null;
      try {
        const response = await fetchVendorProbe(
          `http://127.0.0.1:${origin.port}/model`,
          {
            method: "POST",
            body: "{}",
            headers: { "x-api-key": "fixture-secret", "x-goog-api-key": "fixture-secret" },
          },
          2000,
          proxy,
        );
        expect(response.status).toBe(307);
        expect(redirectedRequests).toBe(0);
      } finally {
        proxy?.server?.stop(true);
        origin.stop(true);
        destination.stop(true);
      }
    });
  }
  test("starts a loopback proxy even when the host has no proxy env", async () => {
    const proxy = await startLocalProviderFetchProxy({});

    try {
      expect(proxy).not.toBeNull();
      if (proxy === null) {
        throw new Error("Expected local provider fetch proxy.");
      }

      expect(proxy.url).toStartWith("http://127.0.0.1:");
      expect(createProviderFetchProxyVarArgs(proxy)).toEqual([
        "--var",
        `MOSOO_PROVIDER_FETCH_PROXY_URL:${proxy.url}`,
        "--var",
        `MOSOO_PROVIDER_FETCH_PROXY_TOKEN:${proxy.token}`,
      ]);
    } finally {
      proxy?.server?.stop(true);
    }
  });

  test("uses explicitly configured proxy credentials without starting a server", async () => {
    const proxy = await startLocalProviderFetchProxy({
      MOSOO_PROVIDER_FETCH_PROXY_TOKEN: "configured-token",
      MOSOO_PROVIDER_FETCH_PROXY_URL: "http://127.0.0.1:8989/fetch",
    });

    expect(proxy).toEqual({
      token: "configured-token",
      url: "http://127.0.0.1:8989/fetch",
    });
  });
});
