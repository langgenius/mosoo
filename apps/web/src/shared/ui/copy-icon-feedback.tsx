import { Check, Copy } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

export function CopyIconFeedback({
  className = "size-3.5",
  copied,
}: {
  className?: string;
  copied: boolean;
}): ReactElement {
  const iconClassName =
    "col-start-1 row-start-1 transition-[opacity,transform] duration-[var(--dur-1)] ease-[var(--ease-out)]";

  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center", className)}>
      <Check
        className={cn(
          iconClassName,
          className,
          copied ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
      <Copy
        className={cn(
          iconClassName,
          className,
          copied ? "scale-75 opacity-0" : "scale-100 opacity-100",
        )}
      />
    </span>
  );
}
