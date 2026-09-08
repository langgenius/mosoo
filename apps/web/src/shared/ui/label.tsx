import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/** Field label: 13px medium, default text; a disabled control mutes it to the subtle tone. */
function Label({ className, ...props }: ComponentProps<"label">): ReactElement {
  return (
    // Design-system primitive: the control association is supplied by callers via
    // `htmlFor` (or by wrapping a control), so it can't be asserted at this site.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-[13px] leading-none font-medium text-fg-1 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-fg-3 peer-disabled:cursor-not-allowed peer-disabled:text-fg-3",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
