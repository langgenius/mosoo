// Solid background colors for the default (no-image) avatar. A single color is
// picked deterministically from a seed so a given account always renders the same
// avatar, while different accounts get some variety. These are literal hex values
// (not theme tokens) so the fill always renders regardless of which stylesheets are
// loaded — earlier the palette referenced CSS variables that were undefined in the
// web app, leaving the avatar with no background color at all. All colors are dark
// enough to keep white initials legible.
const AVATAR_BACKGROUNDS = [
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#dc2626", // red
  "#ea580c", // orange
  "#0d9488", // teal
  "#0891b2", // cyan
  "#4f46e5", // indigo
  "#16a34a", // green
  "#ca8a04", // amber
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
