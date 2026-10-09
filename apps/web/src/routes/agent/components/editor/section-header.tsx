import type { ReactElement, ReactNode } from "react";

export function SectionHeader({ children }: { children: ReactNode }): ReactElement {
  // Sentence case, 13px, foreground, so every section title on the Preview
  // configuration surface reads at one weight, one case, one colour
  // (docs/design/console-design-contract.md, section 10).
  return <h4 className="text-foreground mb-3 text-[13px] font-semibold">{children}</h4>;
}
