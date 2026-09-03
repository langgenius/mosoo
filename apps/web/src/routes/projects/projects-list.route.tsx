import type { ProjectSummary } from "@mosoo/contracts/project";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { createProject } from "@/domains/project/api/project-client";
import { projectKeys } from "@/domains/project/query/project-queries";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { ChevronRight, Plus, Search } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { ProjectIdBadge } from "@/shared/ui/project-id-badge";

function ProjectCard({
  project,
  isCurrent,
  onEnter,
}: {
  project: ProjectSummary;
  isCurrent: boolean;
  onEnter: () => void;
}) {
  const { t } = useTranslation();
  const agentsQuery = useVisibleAgentsQuery(project.id);
  const agentCount = agentsQuery.data?.length;
  const agentLabel =
    agentCount === undefined
      ? "—"
      : agentCount === 1
        ? t("projects.agentCount", { count: String(agentCount) })
        : t("projects.agentsCount", { count: String(agentCount) });

  return (
    <div className="border-border bg-card hover:border-border-strong group relative flex min-h-[120px] flex-col gap-3 rounded-md border p-4 text-left transition-colors">
      <button
        type="button"
        onClick={onEnter}
        aria-label={t("projects.openProject", { name: project.name })}
        className="focus-visible:border-ring focus-visible:ring-ring absolute inset-0 rounded-md outline-none focus-visible:ring-[2px]"
      />
      <div className="pointer-events-none relative z-10 flex items-center gap-2">
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold">
          {project.name}
        </span>
        {isCurrent ? (
          <span className="bg-accent-soft text-accent-press rounded-full px-2 py-0.5 text-[10.5px] font-semibold">
            {t("projects.current")}
          </span>
        ) : null}
        <ChevronRight className="text-fg-3 group-hover:text-fg-1 size-4 shrink-0 transition-colors" />
      </div>
      <div className="pointer-events-none relative z-10 flex min-w-0 flex-col gap-2">
        <ProjectIdBadge projectId={project.id} className="pointer-events-auto w-fit" />
        <div className="text-muted-foreground text-xs">{agentLabel}</div>
      </div>
    </div>
  );
}

// Org-layer Projects list — the account/billing shell's view of the Projects it owns.
// Each Project is a top-level resource boundary; selecting one enters its Project
// console. Creating a Project calls the createProject mutation, then switches into it.
export function ProjectsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProject, activeOrganization, projects, projectsLoading, setActiveProject } =
    useAppSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query === ""
      ? projects
      : projects.filter((project) => project.name.toLowerCase().includes(query));
  }, [projects, search]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (activeOrganization === null) {
        throw new Error(t("common.noActiveOrganization"));
      }

      return createProject({ name: name.trim(), organizationId: activeOrganization.id });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error ? mutationError.message : t("projects.couldNotCreate"),
      );
    },
    onSuccess: async (project) => {
      setCreateOpen(false);
      setName("");
      setError(null);
      setActiveProject(project.id);
      await queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      void navigate("/");
    },
  });

  function enterProject(projectId: string) {
    setActiveProject(projectId);
    void navigate("/");
  }

  function submitCreate() {
    if (name.trim().length === 0 || createMutation.isPending) {
      return;
    }

    setError(null);
    createMutation.mutate();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-[320px]">
            <Search className="text-fg-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              className="h-9 pl-9"
              placeholder={t("projects.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={activeOrganization === null}
            onClick={() => {
              setName("");
              setError(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            {t("projects.new")}
          </Button>
        </div>

        <div className="mt-5">
          {projectsLoading ? (
            <div className="border-border bg-card text-muted-foreground rounded-md border px-4 py-6 text-sm">
              {t("projects.loadingProjects")}
            </div>
          ) : projects.length === 0 ? (
            <div className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-10 text-center text-sm">
              {t("projects.noProjectsYet")}
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-10 text-center text-sm">
              {t("projects.noProjectsMatch", { search })}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isCurrent={activeProject !== null && project.id === activeProject.id}
                  onEnter={() => enterProject(project.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("projects.new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="new-project-name" className="text-foreground text-sm font-medium">
              {t("settings.projectName")}
            </label>
            <Input
              id="new-project-name"
              placeholder="support-bot"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitCreate();
                }
              }}
            />
            {error === null ? null : <p className="text-destructive text-xs">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={name.trim().length === 0 || createMutation.isPending}
              onClick={submitCreate}
            >
              {createMutation.isPending ? t("projects.creating") : t("projects.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
