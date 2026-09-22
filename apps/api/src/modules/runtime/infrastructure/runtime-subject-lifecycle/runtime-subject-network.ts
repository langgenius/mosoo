import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { DriverNetworkProfile } from "../../domain/driver-snapshot";
import type { SandboxNetworkConstraints } from "../../domain/sandbox-network-constraints";
import {
  resolveSandboxNetworkConstraints,
  toSandboxSystemHostsFromUrls,
} from "../../domain/sandbox-network-constraints";
import { toContainerReachableOrigin } from "../runtime-sandbox-provisioning/runtime-sandbox-provisioning.paths";

/**
 * Computes the egress constraints for a runtime subject sandbox. `full` keeps
 * the sandbox defaults. `limited` merges the environment's allowlist with the
 * hosts the platform itself needs from inside the container: the control
 * origin (driver heartbeat, MCP proxy, and model-provider proxy) and the R2
 * backup endpoint (artifact restores curl presigned URLs container-side).
 * The exclusive Session binding is verified before activation; network policy
 * cannot be skipped or shared because of historical type metadata.
 */
export function resolveRuntimeSubjectNetworkConstraints(
  bindings: ApiBindings,
  input: {
    envVars: Readonly<Record<string, string>>;
    network: DriverNetworkProfile;
    requestUrl: string;
  },
): SandboxNetworkConstraints {
  if (input.network.networkPolicy === "full") {
    return { allowedHosts: [], networkPolicy: "full" };
  }

  assertNoLimitedRuntimeProxyEnv(input.envVars);

  const explicitControlOrigin = bindings.MOSOO_RUNTIME_CONTROL_ORIGIN?.trim() || undefined;

  return resolveSandboxNetworkConstraints({
    environmentAllowedHosts: input.network.environmentAllowedHosts,
    networkPolicy: "limited",
    systemHosts: toSandboxSystemHostsFromUrls([
      toContainerReachableOrigin(input.requestUrl, explicitControlOrigin),
      resolveSandboxBackupEndpointUrl(bindings),
    ]),
  });
}

function assertNoLimitedRuntimeProxyEnv(envVars: Readonly<Record<string, string>>): void {
  const proxyNames = Object.keys(envVars).filter((name) =>
    ["all_proxy", "http_proxy", "https_proxy"].includes(name.toLowerCase()),
  );

  if (proxyNames.length === 0) {
    return;
  }

  throw new Error(
    `Limited network cannot run with proxy environment variables (${proxyNames.toSorted().join(", ")}). ` +
      "These proxies are not session-scoped and could bypass the sandbox allowlist; remove them " +
      "or select Full network.",
  );
}

/**
 * Mirrors the endpoint resolution of @cloudflare/sandbox backups:
 * BACKUP_BUCKET_ENDPOINT wins, then the account-scoped R2 origin derived from
 * CLOUDFLARE_R2_ACCOUNT_ID / CLOUDFLARE_ACCOUNT_ID.
 */
function resolveSandboxBackupEndpointUrl(bindings: ApiBindings): string | null {
  const explicitEndpoint = bindings.BACKUP_BUCKET_ENDPOINT?.trim();

  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const accountId =
    bindings.CLOUDFLARE_R2_ACCOUNT_ID?.trim() || bindings.CLOUDFLARE_ACCOUNT_ID?.trim();

  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null;
}
