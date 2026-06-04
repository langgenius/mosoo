import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import type { ThreadProcessEvent } from "../model/process";
import { VARIANT_ORDER, VARIANT_TONE } from "./process-event-style";

export function ProcessLegend({
  events: _events,
}: {
  events: readonly ThreadProcessEvent[];
}): ReactElement {
  return (
    <div className="text-fg-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
      {VARIANT_ORDER.map((variant) => (
        <span key={variant} className="inline-flex items-center gap-1">
          <span className={cn("size-2 rounded-sm", VARIANT_TONE[variant].swatch)} />
          <span>{variant}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="border-border bg-muted size-2 rounded-sm border" />
        <span>Unsupported</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="border-destructive/40 bg-destructive/40 size-2 rounded-sm border" />
        <span>Error</span>
      </span>
    </div>
  );
}
