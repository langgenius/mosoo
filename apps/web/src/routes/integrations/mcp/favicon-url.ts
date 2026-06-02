export function deriveDefaultFaviconUrl(serverUrl: string | null | undefined): string | undefined {
  if (serverUrl === null || serverUrl === undefined || serverUrl.length === 0) {
    return undefined;
  }

  try {
    return new URL("/favicon.ico", new URL(serverUrl).origin).toString();
  } catch {
    return undefined;
  }
}
