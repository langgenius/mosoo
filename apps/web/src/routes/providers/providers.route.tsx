import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";

import { useAppSession } from "../../app/session-provider";
import { ProvidersTab } from "./providers-tab";

export function ProvidersPage(): ReactElement {
  const { activeProjectId, projectsLoading } = useAppSession();
  const { t } = useTranslation();

  if (activeProjectId === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {projectsLoading ? t("common.loadingProject") : t("common.noProject")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ProvidersTab projectId={activeProjectId} />
    </div>
  );
}
