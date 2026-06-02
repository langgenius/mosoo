import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

const MAX_AVATAR_URL_LENGTH = 2048;

const INTERNAL_FILE_PATH_PATTERN = new RegExp(
  `^${PUBLIC_API_PREFIX}/files/[A-Za-z0-9]+/content(?:\\?disposition=inline)?$`,
);

export function normalizeOrganizationAvatarUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length > MAX_AVATAR_URL_LENGTH) {
    throw new Error("Avatar URL is too long.");
  }

  if (INTERNAL_FILE_PATH_PATTERN.test(trimmed)) {
    return trimmed;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Avatar URL must be a valid http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Avatar URL must use http or https.");
  }

  return parsed.toString();
}
