import { SANDBOX_CACHE_PATH, SANDBOX_MEMORY_PATH } from "@mosoo/driver-protocol";
import type { DriverProfileConfig } from "@mosoo/driver-protocol";

const WRANGLER_DEV_PORT = "8787";

export function toContainerReachableOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.hostname = "host.docker.internal";
    url.port = WRANGLER_DEV_PORT;
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

  for (const alias of profile.session.spaceAliases) {
    directories.add(alias.globalMountPath);
    directories.add(getParentDirectory(alias.aliasPath));
    directories.add(getParentDirectory(alias.globalMountPath));
  }

  return [...directories];
}
