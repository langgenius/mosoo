import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

function Label({ className, ...props }: ComponentProps<"label">): ReactElement {
  return (
    // Design-system primitive: the control association is supplied by callers via
    // `htmlFor` (or by wrapping a control), so it can't be asserted at this site.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
