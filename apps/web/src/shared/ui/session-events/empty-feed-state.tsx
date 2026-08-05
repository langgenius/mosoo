import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";

export function EmptyFeedState(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full items-center justify-center px-8 py-16">
      <div className="max-w-sm text-center">
        <div className="text-fg-1 text-[14px] font-semibold">{t("sessionEvents.feedEmpty")}</div>
        <p className="text-fg-3 mt-1 text-[12.5px] leading-5">
          {t("sessionEvents.feedEmptyDescription")}
        </p>
      </div>
    </div>
  );
}
