import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

export function FilterEmptyState({ onReset }: { onReset: () => void }): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-8 text-center">
      <div>
        <div className="text-fg-1 text-[14px] font-semibold">
          {t("sessionEvents.filterEmptyTitle")}
        </div>
        <p className="text-fg-3 mt-1 text-[12.5px]">{t("sessionEvents.filterEmptyDescription")}</p>
      </div>
      <Button onClick={onReset} size="sm" variant="outline">
        {t("sessionEvents.resetFilters")}
      </Button>
    </div>
  );
}
