import { SANDBOX_CACHE_PATH, SANDBOX_MEMORY_PATH } from "agent-driver/paths";

import type { DriverProfileConfig } from "../../domain/driver-snapshot";

export function toContainerReachableOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);

  // Keep the original port: local requests reach the API through whichever
  // dev server received them (vite on WEB_DEV_PORT or wrangler on
  // WRANGLER_DEV_PORT), and both listen on all interfaces. Forcing a fixed
  // port breaks any dev setup that does not run wrangler on that port.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.hostname = "host.docker.internal";
  }

  return url.toString();
}

export function sanitizeProcessId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-").slice(0, 63);
}

export function getOrganizationPath(profile: DriverProfileConfig): string {
  return profile.session.sessionOrganizationPath;
}

export function getParentDirectory(path: string): string {
  const parts = path.split("/").filter(Boolean);

  if (parts.length <= 1) {
    return "/";
  }

  return `/${parts.slice(0, -1).join("/")}`;
}

export function listAdditionalDirectories(
  profile: DriverProfileConfig,
  organizationPath: string,
): string[] {
  const directories = new Set<string>([
    SANDBOX_CACHE_PATH,
    SANDBOX_MEMORY_PATH,
    profile.session.homePath,
    organizationPath,
  ]);

  return [...directories];
}
