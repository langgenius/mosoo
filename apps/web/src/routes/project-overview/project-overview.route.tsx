import { Link } from "react-router-dom";

import { useActiveProject } from "@/app/session/session-context";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Bot, KeyRound } from "@/shared/ui/icons";
import { PageHeader } from "@/shared/ui/page-header";
import { ProjectIdBadge } from "@/shared/ui/project-id-badge";

import { ProjectOverviewInstallGuide } from "./project-overview-install";

export function ProjectOverviewPage() {
  const project = useActiveProject();
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* The same header recipe as every other surface: the project name is
          the title, its id sits beside it, and the two actions are the
          shared button recipe (one primary per surface). */}
      <PageHeader
        className="border-border shrink-0 border-b"
        title={project.name}
        meta={
          <ProjectIdBadge
            copiedLabel={t("agent.projectIdCopied")}
            copyLabel={t("agent.copyProjectId")}
            label={`${t("agent.projectId")}:`}
            value={project.id}
          />
        }
      >
        <Button render={<Link to="/providers" />} variant="outline">
          <KeyRound className="size-4" />
          {t("projectOverview.providerKeys")}
        </Button>
        <Button render={<Link to="/agent?create=1" />}>
          <Bot className="size-4" />
          {t("projectOverview.newAgent")}
        </Button>
      </PageHeader>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <ProjectOverviewInstallGuide />
        </div>
      </main>
    </div>
  );
}
