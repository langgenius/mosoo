import type { ReactElement, SVGProps } from "react";

// The X (formerly Twitter) wordmark glyph. Single-path, inherits currentColor —
// kept alongside the GitHub mark as a brand glyph, not a UI icon.
export function XMark({ className, ...rest }: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className} {...rest}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.966 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  );
}
