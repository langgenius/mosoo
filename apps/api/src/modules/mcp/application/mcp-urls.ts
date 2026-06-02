import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

export function getCallbackUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.pathname = `${PUBLIC_API_PREFIX}/mcp/oauth/callback`;
  url.search = "";
  return url.toString();
}
