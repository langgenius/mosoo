import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

function Input({ className, type, ...props }: ComponentProps<"input">): ReactElement {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-border-strong bg-card px-3 py-1 text-sm text-foreground outline-none transition-colors duration-150 selection:bg-green-200 selection:text-ink-900 placeholder:text-fg-muted file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
