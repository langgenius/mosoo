import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";

/**
 * Egress constraints applied to one sandbox container.
 *
 * `full` keeps the Cloudflare Sandbox defaults (direct internet, no outbound
 * interception changes). `limited` disables direct container internet and
 * installs a deny-by-default allowlist evaluated at the platform's outbound
 * HTTP/HTTPS interception boundary, so `allowedHosts` is only meaningful for
 * `limited`. The record is JSON-serializable: it crosses the Durable Object
 * RPC boundary and is persisted in DO storage.
 */
export interface SandboxNetworkConstraints {
  readonly allowedHosts: readonly string[];
  readonly networkPolicy: EnvironmentNetworkPolicy;
}

export function normalizeSandboxNetworkHost(host: string): string {
  const normalized = host.trim().toLowerCase().replace(/\.$/u, "");

  if (normalized.length === 0) {
    throw new Error("Sandbox network host cannot be empty.");
  }

  if (normalized.startsWith("[") || normalized.endsWith("]")) {
    const ipv6 = normalizeBracketedIpv6(normalized);

    if (ipv6 !== null) {
      return ipv6;
    }

    throw new Error(`Sandbox network host must be a bare hostname: "${host}".`);
  }

  if (!isValidSandboxNetworkHost(normalized)) {
    throw new Error(`Sandbox network host must be a bare hostname: "${host}".`);
  }

  return normalized;
}

function isValidSandboxNetworkHost(host: string): boolean {
  if (/^[0-9.]+$/u.test(host)) {
    return isValidIpv4(host);
  }

  if (host.length > 253) {
    return false;
  }

  return host
    .split(".")
    .every(
      (label) =>
        label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    );
}

function isValidIpv4(host: string): boolean {
  const octets = host.split(".");

  return (
    octets.length === 4 &&
    octets.every((octet) => /^(?:0|[1-9][0-9]{0,2})$/u.test(octet) && Number(octet) <= 255)
  );
}

function normalizeBracketedIpv6(host: string): string | null {
  if (!host.startsWith("[") || !host.endsWith("]") || !host.includes(":")) {
    return null;
  }

  try {
    const hostname = new URL(`http://${host}`).hostname;

    return hostname.startsWith("[") && hostname.endsWith("]") ? hostname : null;
  } catch {
    return null;
  }
}

/**
 * Extracts allowlist hostnames from platform URLs (control origin and R2
 * backup endpoint). Values without a scheme are retried as http:// URLs so a
 * host with an explicit port still resolves; anything unparsable throws,
 * because silently dropping a system host would strand a Limited sandbox
 * without platform connectivity.
 */
export function toSandboxSystemHostsFromUrls(
  urls: ReadonlyArray<string | null | undefined>,
): string[] {
  const hosts = new Set<string>();

  for (const value of urls) {
    const trimmed = value?.trim();

    if (trimmed === undefined || trimmed.length === 0) {
      continue;
    }

    hosts.add(parseUrlHostname(trimmed));
  }

  return [...hosts];
}

function parseUrlHostname(value: string): string {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(value);

  try {
    const hostname = new URL(hasScheme ? value : `http://${value}`).hostname;

    if (hostname.length > 0) {
      return hostname;
    }
  } catch {
    // Fall through to the shared error below.
  }

  throw new Error(`Sandbox system host URL is not parseable: "${value}".`);
}

/**
 * The single runtime host check: every limited allowlist, system hosts
 * included, passes through here before reaching the Sandbox Durable Object,
 * whose platform matcher treats `*` as a glob.
 */
export function resolveLimitedSandboxNetworkConstraints(input: {
  readonly environmentAllowedHosts: readonly string[];
  readonly systemHosts: readonly string[];
}): SandboxNetworkConstraints {
  const merged = new Set<string>();

  for (const host of [...input.systemHosts, ...input.environmentAllowedHosts]) {
    merged.add(normalizeSandboxNetworkHost(host));
  }

  return {
    allowedHosts: [...merged].toSorted(),
    networkPolicy: "limited",
  };
}
