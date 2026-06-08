import { describe, expect, test } from "bun:test";

import {
  createProviderFetchProxyVarArgs,
  startLocalProviderFetchProxy,
} from "../bin/dev-local-provider-proxy";

describe("local provider fetch proxy", () => {
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
