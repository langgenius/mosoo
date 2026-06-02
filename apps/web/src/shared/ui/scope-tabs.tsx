import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

export type Scope = "mine" | "shared" | "organization";

export interface ScopeTabItem {
  value: Scope;
  label: string;
  count?: number;
  visible?: boolean;
}

export function ScopeTabs({
  value,
  onChange,
  tabs,
  className,
}: {
  value: Scope;
  onChange: (value: Scope) => void;
  tabs: ScopeTabItem[];
  className?: string;
}): ReactElement {
  const visibleTabs = tabs.filter((tab) => tab.visible !== false);

  return (
    <div
      role="tablist"
      className={cn(
        "h-8 inline-flex items-center gap-0.5 rounded-md border border-border-strong bg-card p-0.5",
        className,
      )}
    >
      {visibleTabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              onChange(tab.value);
            }}
            className={cn(
              "h-7 px-3 inline-flex items-center gap-1.5 rounded-[8px] text-[13px] font-medium transition-colors",
              active ? "bg-paper-200 text-fg-1" : "text-fg-2 hover:bg-paper-200/60 hover:text-fg-1",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className={cn("font-mono text-[11px]", active ? "text-fg-3" : "text-fg-muted")}>
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
