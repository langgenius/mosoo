import { useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import { deriveDefaultFaviconUrl } from "./favicon-url";

const FALLBACK_COLOR = "#6366F1";

const PALETTE = [
  FALLBACK_COLOR, // Indigo
  "#F97316", // Orange
  "#10B981", // Emerald
  "#EC4899", // Pink
  "#8B5CF6", // Violet
  "#F59E0B", // Amber
  "#06B6D4", // Cyan
  "#EF4444", // Red
];

function hashToColor(seed: string): string {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % PALETTE.length;
  }
  return PALETTE[hash] ?? FALLBACK_COLOR;
}

interface Props {
  url?: string | undefined;
  serverUrl?: string | undefined;
  name: string;
  size?: number;
  className?: string;
}

export function IconAvatar({ url, serverUrl, name, size = 40, className }: Props): ReactElement {
  const [errored, setErrored] = useState(false);
  const firstChar = (name.trim().at(0) ?? "?").toUpperCase();
  const bg = hashToColor(name);
  const placeholderStyle = useMemo<CSSProperties>(
    () => ({
      background: bg,
      fontSize: Math.round(size * 0.4),
      height: size,
      width: size,
    }),
    [bg, size],
  );
  const imageFrameStyle = useMemo<CSSProperties>(
    () => ({
      height: size,
      width: size,
    }),
    [size],
  );

  const resolvedUrl =
    url !== undefined && url.length > 0 ? url : deriveDefaultFaviconUrl(serverUrl);
  const shouldShowFallback = resolvedUrl === undefined || resolvedUrl.length === 0 || errored;

  if (shouldShowFallback) {
    return (
      <div
        className={cn(
          "rounded-lg flex items-center justify-center text-white font-semibold shrink-0",
          className,
        )}
        style={placeholderStyle}
        aria-label={name}
      >
        {firstChar}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg overflow-hidden shrink-0 bg-white border border-border",
        "flex items-center justify-center",
        className,
      )}
      style={imageFrameStyle}
    >
      <img
        src={resolvedUrl}
        alt={name}
        width={size}
        height={size}
        onError={() => {
          setErrored(true);
        }}
        className="size-full object-contain"
      />
    </div>
  );
}
