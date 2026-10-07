import { validationError } from "../../../platform/errors";

export function parseOAuthEndpoint(value: string): string {
  const invalidMessage = "OAuth endpoints must use HTTPS without URL credentials or fragments.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw validationError(invalidMessage);
  }

  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw validationError(invalidMessage);
  }

  return url.toString();
}
