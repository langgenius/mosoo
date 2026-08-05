import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";

export function RequiredMark(): ReactElement {
  const { t } = useTranslation();

  return (
    <span aria-label={t("agent.required")} className="text-destructive ml-0.5" title={t("agent.required")}>
      *
    </span>
  );
}
