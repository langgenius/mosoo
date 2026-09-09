import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Page header recipe (docs/design/console-design-contract.md, section 3): the
 * `t-page-title` role (Geist 24px / 500 / -0.02em on a 28px line, 22px under
 * 640px) over an optional 13px secondary description, with the surface's
 * actions on the trailing side. `meta` renders beside the title, outside the
 * heading (an id badge, a status), so it keeps body sizing. There is no
 * eyebrow slot on purpose: a kicker above the title only repeats what the
 * sidebar already says.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
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
        {meta ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="t-page-title min-w-0 truncate max-sm:text-[22px]">{title}</h1>
            {meta}
          </div>
        ) : (
          <h1 className="t-page-title max-sm:text-[22px]">{title}</h1>
        )}
        {description ? (
          <p className="text-fg-2 mt-1.5 max-w-[560px] text-[13px] leading-5 text-pretty">
            {description}
          </p>
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
