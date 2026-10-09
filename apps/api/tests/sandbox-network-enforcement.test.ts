import { describe, expect, test } from "bun:test";

import {
  SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY,
  configureSandboxNetworkConstraints,
  restoreSandboxNetworkEnforcement,
} from "../src/adapters/durable-objects/sandbox-network-enforcement";

function createStorage(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));

  return {
    values,
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    put: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

function createDelegate() {
  const allowedHostsCalls: string[][] = [];

  return {
    allowedHostsCalls,
    enableInternet: true,
    envVars: {},
    interceptHttps: false,
    setAllowedHosts: (hosts: string[]) => {
      allowedHostsCalls.push(hosts);
      return Promise.resolve();
    },
  };
}

const ENFORCEABLE = { httpsInterceptionDisabled: false };

describe("sandbox network enforcement", () => {
  test("limited constraints disable internet, persist, and install the allowlist", async () => {
    const storage = createStorage();
    const delegate = createDelegate();
    const constraints = {
      allowedHosts: ["api.anthropic.com", "api.example.com"],
      networkPolicy: "limited",
    };

    await configureSandboxNetworkConstraints(storage, delegate, constraints, ENFORCEABLE);

    expect(delegate.enableInternet).toBe(false);
    expect(delegate.interceptHttps).toBe(true);
    expect(delegate.envVars).toEqual({
      SANDBOX_INTERCEPT_HTTPS: "1",
      NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
    });
    expect(delegate.allowedHostsCalls).toEqual([["api.anthropic.com", "api.example.com"]]);
    expect(storage.values.get(SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY)).toEqual(constraints);
  });

  test("limited policy fails closed when HTTPS interception is disabled", async () => {
    const storage = createStorage();
    const delegate = createDelegate();

    await expect(
      configureSandboxNetworkConstraints(
        storage,
        delegate,
        { allowedHosts: [], networkPolicy: "limited" },
        { httpsInterceptionDisabled: true },
      ),
    ).rejects.toThrow("cannot be enforced");

    expect(delegate.enableInternet).toBe(true);
    expect(delegate.interceptHttps).toBe(false);
    expect(delegate.envVars).toEqual({});
    expect(delegate.allowedHostsCalls).toEqual([]);
    expect(storage.values.has(SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY)).toBe(false);
  });

  test("full policy works regardless of HTTPS interception and keeps internet on", async () => {
    const storage = createStorage();
    const delegate = createDelegate();

    await configureSandboxNetworkConstraints(
      storage,
      delegate,
      { allowedHosts: [], networkPolicy: "full" },
      { httpsInterceptionDisabled: true },
    );

    expect(delegate.enableInternet).toBe(true);
    expect(delegate.interceptHttps).toBe(false);
    expect(delegate.envVars).toEqual({});
    expect(delegate.allowedHostsCalls).toEqual([]);
  });

  test("unchanged limited constraints re-assert the idempotent SDK allowlist", async () => {
    const storage = createStorage();
    const delegate = createDelegate();
    const constraints = { allowedHosts: ["api.example.com"], networkPolicy: "limited" };

    await configureSandboxNetworkConstraints(storage, delegate, constraints, ENFORCEABLE);
    await configureSandboxNetworkConstraints(storage, delegate, constraints, ENFORCEABLE);

    expect(delegate.allowedHostsCalls).toEqual([["api.example.com"], ["api.example.com"]]);
    expect(delegate.enableInternet).toBe(false);
  });

  test("persists fail-closed intent before asking the SDK to install the allowlist", async () => {
    const storage = createStorage();
    let persistedAtSdkCall = false;
    const delegate = {
      enableInternet: true,
      envVars: {},
      interceptHttps: false,
      setAllowedHosts: () => {
        persistedAtSdkCall = storage.values.has(SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY);
        return Promise.reject(new Error("SDK interception failed"));
      },
    };

    await expect(
      configureSandboxNetworkConstraints(
        storage,
        delegate,
        { allowedHosts: ["api.example.com"], networkPolicy: "limited" },
        ENFORCEABLE,
      ),
    ).rejects.toThrow("SDK interception failed");

    expect(persistedAtSdkCall).toBe(true);
    expect(delegate.enableInternet).toBe(false);

    const retryDelegate = createDelegate();
    await configureSandboxNetworkConstraints(
      storage,
      retryDelegate,
      { allowedHosts: ["api.example.com"], networkPolicy: "limited" },
      ENFORCEABLE,
    );
    expect(retryDelegate.enableInternet).toBe(false);
    expect(retryDelegate.allowedHostsCalls).toEqual([["api.example.com"]]);
  });

  test("rejects policy changes for an admitted subject", async () => {
    const storage = createStorage();
    const delegate = createDelegate();

    await configureSandboxNetworkConstraints(
      storage,
      delegate,
      { allowedHosts: ["api.example.com"], networkPolicy: "limited" },
      ENFORCEABLE,
    );
    await expect(
      configureSandboxNetworkConstraints(
        storage,
        delegate,
        { allowedHosts: [], networkPolicy: "full" },
        ENFORCEABLE,
      ),
    ).rejects.toThrow("cannot change");

    expect(delegate.enableInternet).toBe(false);
    expect(delegate.allowedHostsCalls).toEqual([["api.example.com"]]);
    expect(storage.values.get(SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY)).toEqual({
      allowedHosts: ["api.example.com"],
      networkPolicy: "limited",
    });
  });

  test("restore re-asserts the persisted internet switch on wake", async () => {
    const limited = createDelegate();

    await restoreSandboxNetworkEnforcement(
      createStorage({
        [SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY]: {
          allowedHosts: ["api.example.com"],
          networkPolicy: "limited",
        },
      }),
      limited,
    );
    expect(limited.enableInternet).toBe(false);
    expect(limited.interceptHttps).toBe(true);
    expect(limited.envVars).toEqual({
      SANDBOX_INTERCEPT_HTTPS: "1",
      NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
    });
    // The SDK restores its own persisted allowlist; restore only re-applies
    // the start-time properties.
    expect(limited.allowedHostsCalls).toEqual([]);

    const untouched = createDelegate();

    await restoreSandboxNetworkEnforcement(createStorage(), untouched);
    expect(untouched.enableInternet).toBe(true);
    expect(untouched.interceptHttps).toBe(false);
    expect(untouched.envVars).toEqual({});
  });
});
