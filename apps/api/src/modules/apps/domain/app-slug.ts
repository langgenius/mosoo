/**
 * App API namespace slug shape (PRD "API Namespace & Access", Open Decision 1
 * as adopted): the slug is minted from the App NAME at the first protocol
 * deploy, kebab-normalized to `[a-z0-9-]`, trimmed to
 * {@link APP_SLUG_MAX_BASE_LENGTH}, and globally unique per instance.
 * Collisions append `-2`, `-3`, … to the base. Once set the slug is
 * immutable: it appears in every namespace path, so slug stability is the
 * API compatibility promise (`renameApp` never touches it).
 */

export const APP_SLUG_MAX_BASE_LENGTH = 48;

/**
 * Fallback base for App names that normalize to nothing (for example a name
 * written entirely in non-Latin script); the collision suffix then provides
 * uniqueness.
 */
const APP_SLUG_EMPTY_NAME_BASE = "app";

/** Kebab-normalizes an App name into the collision-free slug base. */
export function buildAppSlugBase(name: string): string {
  const base = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, APP_SLUG_MAX_BASE_LENGTH)
    .replace(/-+$/u, "");

  return base.length > 0 ? base : APP_SLUG_EMPTY_NAME_BASE;
}

/** First attempt is the bare base; retries append `-2`, `-3`, … */
export function buildAppSlugCandidate(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
