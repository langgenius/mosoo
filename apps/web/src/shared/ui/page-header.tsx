import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}): ReactElement {
  const actionContent = children ?? actions;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 px-4 pt-5 pb-4 sm:flex-row sm:items-start sm:justify-between sm:px-8 sm:pt-7 sm:pb-5",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-fg-3 mb-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-fg-1 text-[22px] font-semibold tracking-[-0.01em] sm:text-[24px]">
          {title}
        </h1>
        {description ? (
          <p className="text-fg-2 mt-1 max-w-[560px] text-[13px] leading-5">{description}</p>
        ) : null}
      </div>
      {actionContent ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&_button]:min-h-10 sm:[&_button]:min-h-0">
          {actionContent}
        </div>
      ) : null}
    </div>
  );
}
