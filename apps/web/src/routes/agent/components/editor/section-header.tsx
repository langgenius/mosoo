import type { ReactElement, ReactNode } from "react";

export function SectionHeader({ children }: { children: ReactNode }): ReactElement {
  // Sentence-case, 13px, foreground — identical to the "Agent type" header so
  // every section title on the Agent Builder surface reads at one weight, one
  // case, one color. See DESIGN.md "Copy & Capitalization".
  return <h4 className="text-foreground mb-3 text-[13px] font-semibold">{children}</h4>;
}
