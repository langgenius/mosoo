import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useAppSession } from "@/app/session-provider";
import {
  deleteEnvironment,
  setAppDefaultEnvironment,
} from "@/domains/environment/api/environment-client";
import { CreateEnvironmentDialog } from "@/domains/environment/components/create-environment-dialog";
import {
  environmentKeys,
  useAppEnvironmentsQuery,
} from "@/domains/environment/query/environment-queries";
import { toEnvironmentId, toAppId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import {
  ListPageContent,
  ListPageSearch,
  ListPageToolbar,
  ListPageToolbarSpacer,
} from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentListTable } from "./environment-list-table";
import { filterEnvironments } from "./environments-list-model";

export function EnvironmentsListPage() {
  const { activeAppId } = useAppSession();
  const appId = activeAppId;
  const environmentsQuery = useAppEnvironmentsQuery(appId);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const defaultMutation = useMutation({
    mutationFn: setAppDefaultEnvironment,
    onSuccess: async () => {
      if (!isTruthy(appId)) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: environmentKeys.list(appId),
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: async () => {
      if (!isTruthy(appId)) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: environmentKeys.list(appId),
      });
    },
  });
  const environments = useMemo(() => environmentsQuery.data ?? [], [environmentsQuery.data]);
  const filteredEnvironments = useMemo(
    () => filterEnvironments(environments, search),
    [environments, search],
  );

  async function handleSetDefault(environmentId: string) {
    if (!isTruthy(appId)) {
      return;
    }
    setError(null);
    try {
      await defaultMutation.mutateAsync({
        environmentId: toEnvironmentId(environmentId),
        appId: toAppId(appId),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to set default environment.",
      );
    }
  }

  async function handleDelete(environmentId: string) {
    if (!isTruthy(appId)) {
      return;
    }
    setError(null);
    try {
      await deleteMutation.mutateAsync({
        environmentId: toEnvironmentId(environmentId),
        appId: toAppId(appId),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to delete environment.",
      );
    }
  }

  if (!isTruthy(appId)) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Environments" description="Runtime templates that Agents can run inside.">
        <Button
          onClick={() => {
            setCreateOpen(true);
          }}
          size="sm"
        >
          <Plus className="size-3.5" />
          Create environment
        </Button>
      </PageHeader>

      <ListPageToolbar>
        <ListPageToolbarSpacer />

        <ListPageSearch value={search} onChange={setSearch} placeholder="Search environments…" />
      </ListPageToolbar>

      <ListPageContent className="space-y-3">
        {isTruthy(error) ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-[13px]">
            {error}
          </div>
        ) : null}

        {environmentsQuery.isLoading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading environments…</div>
        ) : environmentsQuery.error ? (
          <div className="text-destructive py-12 text-center text-[13px]">
            {environmentsQuery.error instanceof Error
              ? environmentsQuery.error.message
              : "Failed to load environments."}
          </div>
        ) : filteredEnvironments.length === 0 ? (
          <EmptyState
            icon={Box}
            title="No environments yet"
            description="Create an environment to define the runtime your Agents run inside."
            action={
              <Button
                onClick={() => {
                  setCreateOpen(true);
                }}
                size="sm"
              >
                <Plus className="size-3.5" />
                Create environment
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
          if (!isTruthy(appId)) {
            return;
          }

          void queryClient.invalidateQueries({
            queryKey: environmentKeys.list(appId),
          });
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        appId={appId}
      />
    </div>
  );
}
