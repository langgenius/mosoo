const DEVELOPMENT_BACKDOOR_EMAIL_DOMAIN = "@mosoo.ai";
const DEVELOPMENT_BACKDOOR_LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isMosooAiDevelopmentBackdoorEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(DEVELOPMENT_BACKDOOR_EMAIL_DOMAIN);
}

function getDevelopmentBackdoorHostname(origin: string): string | null {
  const normalizedOrigin = origin.trim().toLowerCase();
  const authority = normalizedOrigin.includes("://")
    ? (normalizedOrigin.split("://")[1]?.split("/")[0] ?? "")
    : (normalizedOrigin.split("/")[0] ?? "");
  const host = authority.split("@").at(-1) ?? "";

  if (!host) {
    return null;
  }

  if (host.startsWith("[")) {
    const closingBracketIndex = host.indexOf("]");
    return closingBracketIndex === -1 ? null : host.slice(1, closingBracketIndex);
  }

  return host.split(":")[0] ?? null;
}

export function isDevelopmentBackdoorLoopbackOrigin(origin: string): boolean {
  const hostname = getDevelopmentBackdoorHostname(origin);
  return hostname === null ? false : DEVELOPMENT_BACKDOOR_LOOPBACK_HOSTS.has(hostname);
}

export function canUseMosooAiDevelopmentBackdoor(email: string, origin: string): boolean {
  return isDevelopmentBackdoorLoopbackOrigin(origin) && isMosooAiDevelopmentBackdoorEmail(email);
}
