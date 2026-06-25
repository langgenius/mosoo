import type { ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";

// Shared chrome for every /settings/* sub-tab so they line up: a thin title
// bar plus a left-aligned, consistently padded content column. Tabs only vary
// the content width to fit their payload (narrow forms vs. wide data tables).
const SETTINGS_TAB_WIDTHS = {
  form: "max-w-[560px]",
  full: "max-w-6xl",
  wide: "max-w-3xl",
} as const;

export type SettingsTabWidth = keyof typeof SETTINGS_TAB_WIDTHS;

export function SettingsTabHeader({ actions, title }: { actions?: ReactNode; title: ReactNode }) {
  return (
    <header className="border-border-subtle flex h-12 shrink-0 items-center justify-between gap-3 border-b px-6">
      <span className="text-sm font-medium">{title}</span>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SettingsTabBody({
  children,
  className,
  width = "form",
}: {
  children: ReactNode;
  className?: string;
  width?: SettingsTabWidth;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={cn("p-6", SETTINGS_TAB_WIDTHS[width], className)}>{children}</div>
    </div>
  );
}
