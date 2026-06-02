import type { CSSProperties, ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";

// Warm, rounded display face — used large and light for headlines (marketing
// only). Body and UI stay on the neutral sans defined in app.css.
export const DISPLAY_FONT = '"Cabinet Grotesk", "Geist", ui-sans-serif, system-ui, sans-serif';

export const sectionHeadingStyle: CSSProperties = {
  fontFamily: DISPLAY_FONT,
  fontSize: "clamp(28px, 3.4vw, 44px)",
  fontWeight: 500,
  letterSpacing: "-0.028em",
  lineHeight: 1.08,
};

/** Uppercase overline with the single green accent dot. */
export function Eyebrow({
  children,
  tone = "light",
  className,
}: {
  children: ReactNode;
  tone?: "light" | "dark";
  className?: string;
}): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] uppercase",
        tone === "dark" ? "text-paper-100/85" : "text-fg-2",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          tone === "dark" ? "bg-green-400" : "bg-green-600",
        )}
      />
      {children}
    </span>
  );
}
