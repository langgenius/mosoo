import type { ReactElement } from "react";

export function RequiredMark(): ReactElement {
  return (
    <span aria-label="required" className="text-destructive ml-0.5" title="Required">
      *
    </span>
  );
}
