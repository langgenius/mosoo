import { useTranslation } from "@/shared/i18n";
import { SegmentedControl } from "@/shared/ui/segmented-control";

import { COST_TABS } from "./cost-model";
import type { CostTab } from "./cost-model";

export function CostTabBar({
  effectiveTab,
  setActiveTab,
}: {
  effectiveTab: CostTab;
  setActiveTab: (tab: CostTab) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-border-soft flex shrink-0 border-b px-4 py-3 sm:px-6">
      <SegmentedControl
        label={t("cost.projectUsage")}
        onChange={setActiveTab}
        options={COST_TABS.map((tab) => ({ label: t(tab.labelKey), value: tab.id }))}
        value={effectiveTab}
      />
    </div>
  );
}
