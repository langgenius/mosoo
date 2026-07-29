import type { SandboxNetworkConstraints } from "../../modules/runtime/domain/sandbox-network-constraints";
import { parseSandboxNetworkConstraints } from "../../modules/runtime/domain/sandbox-network-constraints";
import type { SandboxHttpsInterception } from "./sandbox-https-interception";
import { configureSandboxHttpsInterception } from "./sandbox-https-interception";

/**
 * Storage key for the constraints applied to this sandbox. The record must
 * survive container restarts and `destroy()` (which only clears SDK
 * port/tunnel keys), so a rehydrated Durable Object can re-apply
 * `enableInternet` and HTTPS interception before the next container start:
 * the SDK persists its own allowlist, but those startup settings are plain
 * instance properties.
 */
export const SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY = "mosooSandboxNetworkConstraints";

/**
 * The subset of the Cloudflare Sandbox (Container) surface used for egress
 * enforcement. `enableInternet` only takes effect at container start;
 * `setAllowedHosts` persists in DO storage and applies live via intercept-all
 * outbound HTTP/HTTPS routing.
 */
export interface SandboxNetworkDelegate extends SandboxHttpsInterception {
  enableInternet: boolean;
  setAllowedHosts(hosts: string[]): Promise<void>;
}

interface SandboxNetworkStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

/**
 * With HTTPS interception disabled (local workerd omits the ephemeral CA),
 * the allowlist can never cover HTTPS egress, so a `limited` policy would be
 * claimed but not enforced. Refuse to configure instead of running open.
 */
function createUnenforceableLimitedNetworkPolicyError(): Error {
  return new Error(
    "Environment network policy 'limited' cannot be enforced here: sandbox HTTPS " +
      "interception is disabled (local workerd omits the ephemeral CA), so the egress " +
      "allowlist would not cover HTTPS traffic. Failing closed instead of running with " +
      "an unenforced policy. Use a 'full' network policy for local development.",
  );
}

export function assertEnforceableSandboxNetworkConstraints(
  constraints: SandboxNetworkConstraints,
  options: { containerRunning: boolean; httpsInterceptionDisabled: boolean },
): void {
  if (constraints.networkPolicy === "limited" && options.httpsInterceptionDisabled) {
    throw createUnenforceableLimitedNetworkPolicyError();
  }
}

function createWarmUnclassifiedSandboxError(): Error {
  return new Error(
    "Environment network policy 'limited' cannot be applied to a warm sandbox whose prior " +
      "egress policy is unknown. Failing closed so the runtime can destroy the container; retry " +
      "the run to start a cold, policy-bound sandbox.",
  );
}

function createImmutableSandboxNetworkPolicyError(): Error {
  return new Error(
    "Sandbox network policy cannot change after the subject is admitted. Failing closed to " +
      "prevent the subject from retaining broader egress; start a new session-scoped sandbox.",
  );
}

function sandboxNetworkConstraintsEqual(
  left: SandboxNetworkConstraints | null,
  right: SandboxNetworkConstraints,
): boolean {
  return (
    left !== null &&
    left.networkPolicy === right.networkPolicy &&
    left.allowedHosts.length === right.allowedHosts.length &&
    left.allowedHosts.every((host, index) => host === right.allowedHosts[index])
  );
}

async function readStoredSandboxNetworkConstraints(
  storage: SandboxNetworkStorage,
): Promise<SandboxNetworkConstraints | null> {
  const stored = await storage.get<unknown>(SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY);

  if (stored === undefined) {
    return null;
  }

  // A corrupt record on a possibly-limited sandbox must brick the sandbox
  // rather than fall back to open internet.
  return parseSandboxNetworkConstraints(stored);
}

export async function configureSandboxNetworkConstraints(
  storage: SandboxNetworkStorage,
  delegate: SandboxNetworkDelegate,
  input: unknown,
  options: { containerRunning: boolean; httpsInterceptionDisabled: boolean },
): Promise<void> {
  const constraints = parseSandboxNetworkConstraints(input);

  assertEnforceableSandboxNetworkConstraints(constraints, options);

  const previous = await readStoredSandboxNetworkConstraints(storage);

  if (previous !== null && !sandboxNetworkConstraintsEqual(previous, constraints)) {
    throw createImmutableSandboxNetworkPolicyError();
  }

  // Before this feature deployed, a subject could already have a running
  // unrestricted container but no Mosoo policy record. Changing the instance
  // property cannot revoke raw TCP on that live container, so let the lifecycle
  // failure path destroy it and require a cold retry.
  if (previous === null && constraints.networkPolicy === "limited" && options.containerRunning) {
    throw createWarmUnclassifiedSandboxError();
  }

  if (constraints.networkPolicy === "limited") {
    delegate.enableInternet = false;

    if (previous === null) {
      await storage.put(SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY, constraints);
    }

    configureSandboxHttpsInterception(delegate, true);

    // Repeat the SDK call even for an unchanged policy. This is intentionally
    // idempotent and repairs SDK-local interception state after a partial
    // configure, DO wake, or container restart while our fail-closed record
    // keeps enableInternet=false throughout.
    await delegate.setAllowedHosts([...constraints.allowedHosts]);

    return;
  }

  configureSandboxHttpsInterception(delegate, false);
  delegate.enableInternet = true;

  if (previous === null) {
    await storage.put(SANDBOX_NETWORK_CONSTRAINTS_STORAGE_KEY, constraints);
  }
}

/**
 * Re-applies the persisted network decision when the Durable Object wakes,
 * before any container start. The SDK restores its allowlist from storage;
 * Mosoo restores the start-time internet and HTTPS interception settings.
 */
export async function restoreSandboxNetworkEnforcement(
  storage: SandboxNetworkStorage,
  delegate: SandboxNetworkDelegate,
  options: { httpsInterceptionDisabled: boolean },
): Promise<void> {
  // The persisted policy is the only authority available after a DO wake.
  // Close internet before reading it so storage or validation failures cannot
  // leave a possibly-limited sandbox on the SDK's open default.
  delegate.enableInternet = false;
  const stored = await readStoredSandboxNetworkConstraints(storage);

  if (stored?.networkPolicy === "limited") {
    assertEnforceableSandboxNetworkConstraints(stored, {
      containerRunning: false,
      httpsInterceptionDisabled: options.httpsInterceptionDisabled,
    });
    configureSandboxHttpsInterception(delegate, true);
    return;
  }

  configureSandboxHttpsInterception(delegate, false);
  delegate.enableInternet = true;
}
