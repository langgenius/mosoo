import type { ReactElement, ReactNode } from "react";

const SECTION_HEADER_STYLE = { color: "#777169" } as const;

export function SectionHeader({ children }: { children: ReactNode }): ReactElement {
  return (
    <h4
      className="mb-3 text-[11px] font-semibold tracking-wider uppercase"
      style={SECTION_HEADER_STYLE}
    >
      {children}
    </h4>
  );
}
