import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}): ReactElement {
  const actionContent = children ?? action;

  return (
    <div
      className={cn(
        "flex h-full min-h-[320px] flex-col items-center justify-center text-center",
        className,
      )}
    >
      <div className="bg-paper-200 text-fg-3 flex size-12 items-center justify-center rounded-full">
        <Icon className="size-5" strokeWidth={1.5} />
      </div>
      <p className="text-fg-1 mt-4 text-[14px] font-semibold text-balance">{title}</p>
      {description ? (
        <p className="text-fg-3 mt-1.5 max-w-[360px] text-[13px] text-pretty">{description}</p>
      ) : null}
      {actionContent ? <div className="mt-5">{actionContent}</div> : null}
    </div>
  );
}
