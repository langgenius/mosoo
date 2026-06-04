import { X } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

export function AccessIconButton({
  disabled = false,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-destructive",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <X className="size-3.5" />
    </button>
  );
}
