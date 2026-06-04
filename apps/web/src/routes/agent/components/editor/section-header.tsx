import type { ReactElement, ReactNode } from "react";

export function SectionHeader({ children }: { children: ReactNode }): ReactElement {
  return (
    <h4 className="text-fg-3 mb-3 text-[11px] font-semibold tracking-wider uppercase">
      {children}
    </h4>
  );
}
