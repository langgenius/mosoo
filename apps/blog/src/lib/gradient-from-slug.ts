// Deterministic painterly gradient per post — no art assets required. The
// slug is hashed to seed a palette pick + angles, so the same post always
// gets the same visual. Inspired by ref3 in the design brief: pinkish/cream
// top half blending into a deep landscape band at the bottom.

const PALETTES: ReadonlyArray<readonly [string, string, string, string]> = [
  ["#f0d8c5", "#e6b8a8", "#6a8f5e", "#243a23"],
  ["#e9d5e0", "#b89cc1", "#5f7a9b", "#1f2d3f"],
  ["#f3e6c4", "#dfc497", "#9a7c4a", "#3a2c1a"],
  ["#dfe9d6", "#8fb38c", "#4a7355", "#1a2a1f"],
  ["#f0c5c8", "#c98794", "#7a5a72", "#2a1f30"],
  ["#dde7ed", "#9eb6c3", "#5d7585", "#1c2b35"],
  ["#e8e0c8", "#c0b48a", "#6f6a3f", "#2b2715"],
  ["#f2d9b6", "#d49a6a", "#7a4e2e", "#2e1c12"],
];

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface GradientVisual {
  readonly background: string;
  readonly palette: readonly [string, string, string, string];
}

export function gradientFromSlug(slug: string): GradientVisual {
  const h = hash(slug);
  const palette = PALETTES[h % PALETTES.length];
  const angle = (h >> 4) % 60; // 0–59° tilt for organic horizon line
  const horizon = 52 + ((h >> 8) % 16); // 52–67% from top
  const blur = 28 + ((h >> 12) % 24); // soften the horizon

  const [skyHi, skyLo, landHi, landLo] = palette;

  // Layer 1: warm sky band (top), Layer 2: cool land band (bottom),
  // Layer 3: directional sheen for painterly quality.
  const background = [
    `linear-gradient(${180 + angle}deg, ${skyHi} 0%, ${skyLo} ${horizon - 6}%, ${landHi} ${horizon + 4}%, ${landLo} 100%)`,
    `radial-gradient(120% 80% at 30% 110%, rgba(255,255,255,0.18) 0%, transparent 60%)`,
    `radial-gradient(80% 60% at 80% 0%, rgba(255,255,255,0.22) 0%, transparent 70%)`,
  ].join(", ");

  return { background: `${background}; filter: blur(0); --horizon-blur: ${blur}px`, palette };
}
