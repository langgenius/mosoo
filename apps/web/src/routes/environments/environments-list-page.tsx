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
import {
  ListPageContent,
  ListPageSearch,
  ListPageToolbar,
  ListPageToolbarSpacer,
} from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";
import { ScopeTabs } from "@/shared/ui/scope-tabs";
import type { Scope } from "@/shared/ui/scope-tabs";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentListTable } from "./environment-list-table";
import {
  filterEnvironments,
  getEnvironmentsForScope,
  groupEnvironmentsByScope,
} from "./environments-list-model";

export function EnvironmentsListPage() {
  const { activeOrganization, activeOrganizationId } = useAppSession();
  const organizationId = activeOrganizationId;
  const environmentsQuery = useOrganizationEnvironmentsQuery(organizationId);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("mine");
  const [search, setSearch] = useState("");
  async function invalidateEnvironmentList() {
    if (!isTruthy(organizationId)) {
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: environmentKeys.list(toOrganizationId(organizationId)),
    });
  }

  const defaultMutation = useMutation({
    mutationFn: setOrganizationDefaultEnvironment,
    onSuccess: invalidateEnvironmentList,
  });
  const forkMutation = useMutation({
    mutationFn: createEnvironmentFork,
    onSuccess: invalidateEnvironmentList,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: invalidateEnvironmentList,
  });
  const isAdmin = can(activeOrganization?.viewerRole, Permission.ProvidersCompanyManage);
  const environments = useMemo(() => environmentsQuery.data ?? [], [environmentsQuery.data]);
  const environmentScopes = useMemo(() => groupEnvironmentsByScope(environments), [environments]);

  const scopeEnvironments = getEnvironmentsForScope(environmentScopes, scope);
  const filteredEnvironments = useMemo(
    () => filterEnvironments(scopeEnvironments, search),
    [scopeEnvironments, search],
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
        <ScopeTabs
          value={scope}
          onChange={setScope}
          tabs={[
            { count: environmentScopes.personalEnvironments.length, label: "Mine", value: "mine" },
            {
              count: environmentScopes.sharedEnvironments.length,
              label: "Shared with me",
              value: "shared",
            },
          ]}
        />

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
            title={scope === "mine" ? "No environments yet" : "No environments shared with you yet"}
            description={
              scope === "mine"
                ? "Create an environment to define the runtime your Agents run inside."
                : "Environments shared with you will show up here."
            }
            action={
              scope === "mine" ? (
                <Button
                  onClick={() => {
                    setCreateOpen(true);
                  }}
                  size="sm"
                >
                  <Plus className="size-3.5" />
                  Create environment
                </Button>
              ) : undefined
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
        onCreated={() => void invalidateEnvironmentList()}
        onOpenChange={setCreateOpen}
        open={createOpen}
        organizationId={organizationId}
      />
    </div>
  );
}
