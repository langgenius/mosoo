import { Check, Copy } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Copy-button glyph: the copy and check icons stacked in one grid cell,
 * cross-fading on `copied` instead of teleporting between two renders.
 */
export function CopyCheckIcon({
  className,
  copied,
}: {
  className?: string;
  copied: boolean;
}): ReactElement {
  return (
    <span className={cn("grid size-3.5 shrink-0 *:col-start-1 *:row-start-1", className)}>
      <Copy
        className={cn(
          "size-full transition-[opacity,scale] duration-(--dur-1) ease-(--ease-out)",
          copied ? "scale-75 opacity-0" : "scale-100 opacity-100",
        )}
      />
      <Check
        className={cn(
          "size-full transition-[opacity,scale] duration-(--dur-1) ease-(--ease-out)",
          copied ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
    </span>
  );
}
