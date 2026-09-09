import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Bot, KeyRound } from "@/shared/ui/icons";
import { PageHeader } from "@/shared/ui/page-header";
import { ProjectIdBadge } from "@/shared/ui/project-id-badge";

import { ProjectOverviewInstallGuide } from "./project-overview-install";

export function ProjectOverviewPage() {
  const { activeProject, projectsLoading } = useAppSession();
  const { t } = useTranslation();

  if (activeProject === null) {
    return (
      <div className="text-fg-3 flex h-full items-center justify-center text-[13px]">
        {projectsLoading ? t("common.loadingProject") : t("common.noProject")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* The same header recipe as every other surface: the project name is
          the title, its id sits beside it, and the two actions are the
          shared button recipe (one primary per surface). */}
      <PageHeader
        className="border-border shrink-0 border-b"
        title={activeProject.name}
        meta={<ProjectIdBadge projectId={activeProject.id} />}
        actions={
          <>
            <Button render={<Link to="/providers" />} variant="outline">
              <KeyRound className="size-4" />
              {t("projectOverview.providerKeys")}
            </Button>
            <Button render={<Link to="/agent?create=1" />}>
              <Bot className="size-4" />
              {t("projectOverview.newAgent")}
            </Button>
          </>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <ProjectOverviewInstallGuide />
        </div>
      </main>
    </div>
  );
}
