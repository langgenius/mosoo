import { describe, expect, test } from "bun:test";

import {
  SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY,
  configureSandboxNetworkConstraints,
  restoreSandboxNetworkEnforcement,
} from "../src/adapters/durable-objects/sandbox-network-enforcement";
import { waitForSandboxNetworkRestore } from "../src/adapters/durable-objects/sandbox-network-restore-gate";
import { SANDBOX_RPC_FORWARD_METHODS } from "../src/adapters/durable-objects/sandbox-rpc-methods";

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
    setAllowedHosts: (hosts: string[]) => {
      allowedHostsCalls.push(hosts);
      return Promise.resolve();
    },
  };
}

const ENFORCEABLE = { containerRunning: false, httpsInterceptionDisabled: false };

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
        { containerRunning: false, httpsInterceptionDisabled: true },
      ),
    ).rejects.toThrow("cannot be enforced");

    expect(delegate.enableInternet).toBe(true);
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
      { containerRunning: false, httpsInterceptionDisabled: true },
    );

    expect(delegate.enableInternet).toBe(true);
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

  test("rejects first-time Limited admission on a warm unclassified container", async () => {
    const storage = createStorage();
    const delegate = createDelegate();

    await expect(
      configureSandboxNetworkConstraints(
        storage,
        delegate,
        { allowedHosts: ["api.example.com"], networkPolicy: "limited" },
        { containerRunning: true, httpsInterceptionDisabled: false },
      ),
    ).rejects.toThrow("warm sandbox");

    expect(delegate.enableInternet).toBe(true);
    expect(delegate.allowedHostsCalls).toEqual([]);
    expect(storage.values.size).toBe(0);
  });

  test("invalid RPC payloads are rejected before touching state", async () => {
    const storage = createStorage();
    const delegate = createDelegate();

    await expect(
      configureSandboxNetworkConstraints(
        storage,
        delegate,
        { allowedHosts: "nope", networkPolicy: "limited" },
        ENFORCEABLE,
      ),
    ).rejects.toThrow("array of strings");

    expect(storage.values.size).toBe(0);
    expect(delegate.allowedHostsCalls).toEqual([]);
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
    // The SDK restores its own persisted allowlist; restore only re-applies
    // the start-time internet switch.
    expect(limited.allowedHostsCalls).toEqual([]);

    const untouched = createDelegate();

    await restoreSandboxNetworkEnforcement(createStorage(), untouched);
    expect(untouched.enableInternet).toBe(true);
  });

  test("restore fails closed on a corrupt persisted record", async () => {
    const delegate = createDelegate();

    await expect(
      restoreSandboxNetworkEnforcement(
        createStorage({ [SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY]: { networkPolicy: "open" } }),
        delegate,
      ),
    ).rejects.toThrow("unknown network policy");
    expect(delegate.enableInternet).toBe(false);
  });

  test("rejected restore permits teardown only and blocks every access RPC", async () => {
    const restoreError = new Error("corrupt stored network policy");
    const rejectedRestore = Promise.reject(restoreError);

    await expect(
      waitForSandboxNetworkRestore(rejectedRestore, "destroy", []),
    ).resolves.toBeUndefined();
    await expect(
      waitForSandboxNetworkRestore(rejectedRestore, "setKeepAlive", [false]),
    ).resolves.toBeUndefined();
    await expect(
      waitForSandboxNetworkRestore(rejectedRestore, "setKeepAlive", [true]),
    ).rejects.toBe(restoreError);

    for (const method of SANDBOX_RPC_FORWARD_METHODS) {
      if (method === "destroy" || method === "setKeepAlive") {
        continue;
      }

      await expect(waitForSandboxNetworkRestore(rejectedRestore, method, [])).rejects.toBe(
        restoreError,
      );
    }
  });
});
