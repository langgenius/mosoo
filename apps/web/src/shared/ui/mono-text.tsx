import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Precise-information role (docs/design/console-design-contract.md, section 3):
 * ids, model identifiers, masked keys, durations, versions. 12.5px mono with
 * tabular numerals; never used for long descriptions or whole forms.
 */
export function MonoText({ className, ...props }: ComponentProps<"span">): ReactElement {
  return (
    <span
      data-slot="mono"
      className={cn("font-mono text-[12.5px] tabular-nums", className)}
      {...props}
    />
  );
}
