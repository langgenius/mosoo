import type { CSSProperties } from "react";

export const DISPLAY_FONT = '"Cabinet Grotesk", "Geist", ui-sans-serif, system-ui, sans-serif';

export const sectionHeadingStyle: CSSProperties = {
  fontFamily: DISPLAY_FONT,
  fontSize: "clamp(28px, 3.4vw, 44px)",
  fontWeight: 500,
  letterSpacing: "-0.028em",
  lineHeight: 1.08,
};
