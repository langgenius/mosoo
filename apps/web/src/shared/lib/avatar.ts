// Solid, on-brand background colors for the default (no-image) avatar. A single
// color is picked deterministically from a seed so a given account always renders
// the same avatar, while different accounts get some variety. All colors are dark
// enough to keep white initials legible.
const AVATAR_BACKGROUNDS = [
  "var(--green-600)",
  "var(--green-700)",
  "var(--green-800)",
  "var(--forest-600)",
  "var(--forest-700)",
  "var(--forest-800)",
] as const;

function hashSeed(seed: string): number {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

/**
 * Returns a deterministic solid background color for an account's default avatar.
 * Seed with a stable identifier (email preferred, name as a fallback) so the same
 * account renders the same color everywhere.
 */
export function getAvatarBackground(seed: string | null | undefined): string {
  const normalized = (seed ?? "").trim().toLowerCase();
  const index = normalized.length === 0 ? 0 : hashSeed(normalized) % AVATAR_BACKGROUNDS.length;

  return AVATAR_BACKGROUNDS[index] ?? AVATAR_BACKGROUNDS[0];
}

/** Returns the uppercase initial to render inside a default avatar. */
export function getAvatarInitial(name: string | null | undefined): string {
  return (name ?? "").trim().charAt(0).toUpperCase() || "?";
}
