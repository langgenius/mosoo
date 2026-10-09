import type { EnvironmentId } from "@mosoo/id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useActiveProject } from "@/app/session/session-context";
import {
  deleteEnvironment,
  setProjectDefaultEnvironment,
} from "@/domains/environment/api/environment-client";
import { CreateEnvironmentDialog } from "@/domains/environment/components/create-environment-dialog";
import { EnvironmentCliCallout } from "@/domains/environment/components/environment-cli-callout";
import {
  environmentKeys,
  useProjectEnvironmentsQuery,
} from "@/domains/environment/query/environment-queries";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Box, Plus } from "@/shared/ui/icons";
import { ListPageContent, ListPageSearch, ListPageToolbar } from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentListTable } from "./environment-list-table";
import { filterEnvironments } from "./environments-list-model";

export function EnvironmentsListPage() {
  const { t } = useTranslation();
  const project = useActiveProject();
  const environmentsQuery = useProjectEnvironmentsQuery(project.id);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function invalidateEnvironments(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: environmentKeys.list(project.id) });
  }

  const defaultMutation = useMutation({
    mutationFn: setProjectDefaultEnvironment,
    onSuccess: invalidateEnvironments,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: invalidateEnvironments,
  });
  const environments = useMemo(() => environmentsQuery.data ?? [], [environmentsQuery.data]);
  const filteredEnvironments = useMemo(
    () => filterEnvironments(environments, search),
    [environments, search],
  );

  async function handleSetDefault(environmentId: EnvironmentId) {
    setError(null);
    try {
      await defaultMutation.mutateAsync({ environmentId, projectId: project.id });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : t("environments.setDefaultFailed"),
      );
    }
  }

  async function handleDelete(environmentId: EnvironmentId) {
    setError(null);
    try {
      await deleteMutation.mutateAsync({ environmentId, projectId: project.id });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t("environments.deleteFailed"));
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title={t("environments.title")} description={t("environments.listDescription")}>
        <Button
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          {t("environments.create")}
        </Button>
      </PageHeader>

      <ListPageToolbar>
        <ListPageSearch
          value={search}
          onChange={setSearch}
          placeholder={t("environments.searchPlaceholder")}
        />
      </ListPageToolbar>

      <ListPageContent className="space-y-3">
        <EnvironmentCliCallout />

        {isTruthy(error) ? (
          <div
            className="border-danger/30 bg-danger-bg text-danger-fg rounded-md border px-3 py-2 text-[13px]"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {environmentsQuery.isLoading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">{t("environments.loading")}</div>
        ) : environmentsQuery.error ? (
          <div className="text-danger py-12 text-center text-[13px]">
            {environmentsQuery.error instanceof Error
              ? environmentsQuery.error.message
              : t("environments.loadFailed")}
          </div>
        ) : filteredEnvironments.length === 0 ? (
          <EmptyState
            icon={Box}
            title={t("environments.noEnvironments")}
            description={t("environments.noEnvironmentsDescription")}
          >
            <Button
              onClick={() => {
                setCreateOpen(true);
              }}
              size="sm"
            >
              <Plus className="size-3.5" />
              {t("environments.create")}
            </Button>
          </EmptyState>
        ) : (
          <EnvironmentListTable
            environments={filteredEnvironments}
            onDelete={(environmentId) => {
              void handleDelete(environmentId);
            }}
            onSetDefault={(environmentId) => {
              void handleSetDefault(environmentId);
            }}
          />
        )}
      </ListPageContent>

      <CreateEnvironmentDialog
        onOpenChange={setCreateOpen}
        open={createOpen}
        projectId={project.id}
      />
    </div>
  );
}
