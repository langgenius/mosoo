import { Grid2X2, List } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

type ViewMode = "list" | "grid";

export function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn(
        "h-8 inline-flex items-center border border-border-strong rounded-md overflow-hidden bg-card",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => {
          onChange("list");
        }}
        className={cn(
          "h-full w-8 flex items-center justify-center transition-colors",
          value === "list" ? "bg-paper-200 text-fg-1" : "text-fg-3 hover:bg-paper-200/50",
        )}
        aria-label="List view"
        aria-pressed={value === "list"}
      >
        <List className="size-3.5" />
      </button>
      <span className="bg-border-strong h-5 w-px" />
      <button
        type="button"
        onClick={() => {
          onChange("grid");
        }}
        className={cn(
          "h-full w-8 flex items-center justify-center transition-colors",
          value === "grid" ? "bg-paper-200 text-fg-1" : "text-fg-3 hover:bg-paper-200/50",
        )}
        aria-label="Grid view"
        aria-pressed={value === "grid"}
      >
        <Grid2X2 className="size-3.5" />
      </button>
    </div>
  );
}
