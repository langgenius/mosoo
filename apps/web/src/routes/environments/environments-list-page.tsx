import { Permission, can } from "@mosoo/contracts/permission";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useAppSession } from "@/app/session-provider";
import {
  createEnvironmentFork,
  deleteEnvironment,
  setOrganizationDefaultEnvironment,
} from "@/domains/environment/api/environment-client";
import { CreateEnvironmentDialog } from "@/domains/environment/components/create-environment-dialog";
import {
  environmentKeys,
  useOrganizationEnvironmentsQuery,
} from "@/domains/environment/query/environment-queries";
import { toEnvironmentId, toOrganizationId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { ListPageContent, ListPageSearch, ListPageToolbar } from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentListTable } from "./environment-list-table";
import { filterEnvironments, selectPersonalEnvironments } from "./environments-list-model";

export function EnvironmentsListPage() {
  const { activeOrganization, activeOrganizationId } = useAppSession();
  const organizationId = activeOrganizationId;
  const environmentsQuery = useOrganizationEnvironmentsQuery(organizationId);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const defaultMutation = useMutation({
    mutationFn: setOrganizationDefaultEnvironment,
    onSuccess: async () => {
      if (!isTruthy(organizationId)) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: environmentKeys.list(toOrganizationId(organizationId)),
      });
    },
  });
  const forkMutation = useMutation({
    mutationFn: createEnvironmentFork,
    onSuccess: async () => {
      if (!isTruthy(organizationId)) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: environmentKeys.list(toOrganizationId(organizationId)),
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: async () => {
      if (!isTruthy(organizationId)) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: environmentKeys.list(toOrganizationId(organizationId)),
      });
    },
  });
  const isAdmin = can(activeOrganization?.viewerRole, Permission.ProvidersCompanyManage);
  const environments = useMemo(() => environmentsQuery.data ?? [], [environmentsQuery.data]);
  const personalEnvironments = useMemo(
    () => selectPersonalEnvironments(environments),
    [environments],
  );
  const filteredEnvironments = useMemo(
    () => filterEnvironments(personalEnvironments, search),
    [personalEnvironments, search],
  );

  async function handleSetDefault(environmentId: string) {
    if (!isTruthy(organizationId)) {
      return;
    }
    setError(null);
    try {
      await defaultMutation.mutateAsync({
        environmentId: toEnvironmentId(environmentId),
        organizationId: toOrganizationId(organizationId),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to set default environment.",
      );
    }
  }

  async function handleFork(environmentId: string) {
    setError(null);
    try {
      await forkMutation.mutateAsync({ environmentId: toEnvironmentId(environmentId) });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to fork environment.");
    }
  }

  async function handleDelete(environmentId: string) {
    setError(null);
    try {
      await deleteMutation.mutateAsync({ environmentId: toEnvironmentId(environmentId) });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to delete environment.",
      );
    }
  }

  if (!isTruthy(organizationId)) {
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
            isAdmin={isAdmin}
            onDelete={(environmentId) => {
              void handleDelete(environmentId);
            }}
            onFork={(environmentId) => {
              void handleFork(environmentId);
            }}
            onSetDefault={(environmentId) => {
              void handleSetDefault(environmentId);
            }}
          />
        )}
      </ListPageContent>

      <CreateEnvironmentDialog
        onCreated={() => {
          if (!isTruthy(organizationId)) {
            return;
          }

          void queryClient.invalidateQueries({
            queryKey: environmentKeys.list(toOrganizationId(organizationId)),
          });
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        organizationId={organizationId}
      />
    </div>
  );
}
