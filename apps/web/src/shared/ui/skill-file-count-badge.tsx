import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

export function formatSkillFileCount(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

export function SkillFileCountBadge({
  className,
  count,
}: {
  className?: string;
  count: number;
}): ReactElement {
  return (
    <span
      className={cn(
        "border-border-subtle text-muted-foreground inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
        className,
      )}
    >
      {formatSkillFileCount(count)}
    </span>
  );
}
