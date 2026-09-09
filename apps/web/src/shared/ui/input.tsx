import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Field recipe (docs/design/console-design-contract.md, section 4): 32px,
 * 10px radius, strong hairline, white surface. Focus turns the border into
 * the focus tone with a soft glow; invalid turns the border to danger and
 * leaves the focus treatment alone; read-only and disabled change the surface
 * and text instead of fading the control.
 */
export const fieldClassName =
  "flex h-8 w-full min-w-0 rounded-md border border-border-strong bg-card px-3 text-[13px] text-fg-1 outline-none transition-[border-color,box-shadow,background-color] duration-150 ease-out selection:bg-green-100 selection:text-ink-900 placeholder:text-fg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-danger read-only:bg-paper-100 read-only:text-fg-2 disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-paper-200 disabled:text-fg-3";

function Input({ className, type, ...props }: ComponentProps<"input">): ReactElement {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClassName,
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-fg-1",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
