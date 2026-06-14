import { cn } from "@/shared/lib/class-names";

import { COST_TABS } from "./cost-model";
import type { CostTab } from "./cost-model";

export function CostTabBar({
  effectiveTab,
  setActiveTab,
}: {
  effectiveTab: CostTab;
  setActiveTab: (tab: CostTab) => void;
}) {
  return (
    <div className="border-border-subtle flex shrink-0 gap-1 border-b px-5 py-2.5">
      {COST_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => {
            setActiveTab(tab.id);
          }}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
            effectiveTab === tab.id
              ? "bg-ink-100 text-fg-1"
              : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
