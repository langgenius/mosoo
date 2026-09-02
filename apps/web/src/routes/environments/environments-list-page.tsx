import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useAppSession } from "@/app/session-provider";
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
import { toEnvironmentId, toProjectId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { ListPageContent, ListPageSearch, ListPageToolbar } from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentListTable } from "./environment-list-table";
import { filterEnvironments } from "./environments-list-model";

export function EnvironmentsListPage() {
  const { t } = useTranslation();
  const { activeProjectId } = useAppSession();
  const projectId = activeProjectId;
  const environmentsQuery = useProjectEnvironmentsQuery(projectId);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const defaultMutation = useMutation({
    mutationFn: setProjectDefaultEnvironment,
    onSuccess: async () => {
      if (!isTruthy(projectId)) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: environmentKeys.list(projectId),
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: async () => {
      if (!isTruthy(projectId)) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: environmentKeys.list(projectId),
      });
    },
  });
  const environments = useMemo(() => environmentsQuery.data ?? [], [environmentsQuery.data]);
  const filteredEnvironments = useMemo(
    () => filterEnvironments(environments, search),
    [environments, search],
  );

  async function handleSetDefault(environmentId: string) {
    if (!isTruthy(projectId)) {
      return;
    }
    setError(null);
    try {
      await defaultMutation.mutateAsync({
        environmentId: toEnvironmentId(environmentId),
        projectId: toProjectId(projectId),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : t("environments.setDefaultFailed"),
      );
    }
  }

  async function handleDelete(environmentId: string) {
    if (!isTruthy(projectId)) {
      return;
    }
    setError(null);
    try {
      await deleteMutation.mutateAsync({
        environmentId: toEnvironmentId(environmentId),
        projectId: toProjectId(projectId),
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t("environments.deleteFailed"));
    }
  }

  if (!isTruthy(projectId)) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title={t("environments.title")} description={t("environments.listDescription")}>
        <Button
          onClick={() => {
            setCreateOpen(true);
          }}
          size="sm"
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
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-[13px]">
            {error}
          </div>
        ) : null}

        {environmentsQuery.isLoading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">{t("environments.loading")}</div>
        ) : environmentsQuery.error ? (
          <div className="text-destructive py-12 text-center text-[13px]">
            {environmentsQuery.error instanceof Error
              ? environmentsQuery.error.message
              : t("environments.loadFailed")}
          </div>
        ) : filteredEnvironments.length === 0 ? (
          <EmptyState
            icon={Box}
            title={t("environments.noEnvironments")}
            description={t("environments.noEnvironmentsDescription")}
            action={
              <Button
                onClick={() => {
                  setCreateOpen(true);
                }}
                size="sm"
              >
                <Plus className="size-3.5" />
                {t("environments.create")}
              </Button>
            }
          />
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
        onCreated={() => {
          if (!isTruthy(projectId)) {
            return;
          }

          void queryClient.invalidateQueries({
            queryKey: environmentKeys.list(projectId),
          });
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        projectId={projectId}
      />
    </div>
  );
}
