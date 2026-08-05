import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";

import { useAppSession } from "../../app/session-provider";
import { ProvidersTab } from "./providers-tab";

export function ProvidersPage(): ReactElement {
  const { activeAppId, appsLoading } = useAppSession();
  const { t } = useTranslation();

  if (activeAppId === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? t("common.loadingApp") : t("common.noApp")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ProvidersTab appId={activeAppId} />
    </div>
  );
}
