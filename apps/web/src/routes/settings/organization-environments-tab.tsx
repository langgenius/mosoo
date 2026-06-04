import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import { Permission, can } from "@mosoo/contracts/permission";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Box, Check, Loader2, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { setOrganizationDefaultEnvironment } from "@/domains/environment/api/environment-client";
import {
  environmentKeys,
  useOrganizationEnvironmentsQuery,
} from "@/domains/environment/query/environment-queries";
import { EnvironmentBadges } from "@/routes/environments/environment-badges";
import { toEnvironmentId, toOrganizationId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";

import { isTruthy } from "../../shared/lib/truthiness";

export function OrganizationEnvironmentsTab() {
  const { activeOrganization, activeOrganizationId, organizationsLoading } = useAppSession();
  const isAdmin = can(activeOrganization?.viewerRole, Permission.EnvironmentsSetOrgDefault);
  const organizationId = activeOrganizationId;
  const environmentsQuery = useOrganizationEnvironmentsQuery(organizationId);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingEnvironmentId, setPendingEnvironmentId] = useState<string | null>(null);

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

  const environments = useMemo(() => environmentsQuery.data ?? [], [environmentsQuery.data]);
  const defaultEnvironment = useMemo(
    () => environments.find((environment) => environment.isDefault) ?? null,
    [environments],
  );

  if (!activeOrganization) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {organizationsLoading ? "Loading organization…" : "No organization available."}
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/settings/members" replace />;
  }

  async function handleSetDefault(environmentId: string) {
    if (!isTruthy(organizationId)) {
      return;
    }
    setError(null);
    setPendingEnvironmentId(environmentId);
    try {
      await defaultMutation.mutateAsync({
        environmentId: toEnvironmentId(environmentId),
        organizationId: toOrganizationId(organizationId),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to set default environment.",
      );
    } finally {
      setPendingEnvironmentId(null);
    }
  }

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center border-b px-5">
        <span className="text-sm font-medium">Environments</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 py-8">
          <h1 className="text-fg-1 text-[20px] font-semibold tracking-[-0.01em]">
            Default environment
          </h1>
          <p className="text-fg-2 mt-1 text-[13px] leading-5">
            Choose the runtime template that new agents in this organization start with. Only
            organization-shared environments can be set as default — use{" "}
            <Link className="text-accent-press hover:underline" to="/environment">
              Environments
            </Link>{" "}
            to create, fork, and share environments.
          </p>

          {environmentsQuery.isLoading ? (
            <div className="text-fg-3 mt-8 py-12 text-center text-[13px]">
              Loading environments…
            </div>
          ) : environmentsQuery.error ? (
            <div className="text-destructive mt-8 py-12 text-center text-[13px]">
              {environmentsQuery.error instanceof Error
                ? environmentsQuery.error.message
                : "Failed to load environments."}
            </div>
          ) : (
            <>
              <CurrentDefaultCard environment={defaultEnvironment} />

              {isTruthy(error) ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive mt-5 rounded-md border px-3 py-2 text-[13px]">
                  {error}
                </div>
              ) : null}

              <h2 className="text-fg-1 mt-8 text-[14px] font-semibold">All environments</h2>
              <p className="text-fg-2 mt-1 text-[12.5px] leading-5">
                Personal environments must be shared with the organization before they can be set as
                default.
              </p>

              {environments.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    icon={Box}
                    title="No environments yet"
                    description="Create an environment from the Environments page to make it available here."
                  />
                </div>
              ) : (
                <EnvironmentRows
                  environments={environments}
                  pendingEnvironmentId={pendingEnvironmentId}
                  onSetDefault={(environmentId) => {
                    void handleSetDefault(environmentId);
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function CurrentDefaultCard({ environment }: { environment: EnvironmentSummary | null }) {
  return (
    <div className="border-border-soft mt-6 rounded-xl border bg-white/40 p-5">
      <div className="text-fg-3 text-[11px] font-semibold tracking-[0.14em] uppercase">
        Current default
      </div>
      {environment ? (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="text-fg-1 hover:text-accent-press truncate text-[15px] font-semibold"
                to={`/environment/${environment.id}`}
              >
                {environment.name}
              </Link>
              <EnvironmentBadges environment={environment} />
            </div>
            <div className="text-fg-2 mt-1 line-clamp-2 text-[12.5px] leading-5">
              {environment.description || "No description"}
            </div>
            <div className="text-fg-3 mt-2 text-[11.5px]">
              Owner: {environment.owner.name ?? "System"} ·{" "}
              {environment.networkPolicy === "limited"
                ? `Limited network · ${environment.allowedHosts.length} hosts`
                : "Full network"}
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to={`/environment/${environment.id}`}>Open</Link>
          </Button>
        </div>
      ) : (
        <div className="text-fg-2 mt-2 text-[13px]">
          No default environment is set. New agents fall back to the built-in system default.
        </div>
      )}
    </div>
  );
}

function EnvironmentRows({
  environments,
  onSetDefault,
  pendingEnvironmentId,
}: {
  environments: readonly EnvironmentSummary[];
  onSetDefault: (environmentId: string) => void;
  pendingEnvironmentId: string | null;
}) {
  return (
    <div className="border-border bg-card mt-4 overflow-hidden rounded-lg border">
      {environments.map((environment, index) => {
        const isPending = pendingEnvironmentId === environment.id;
        const isLast = index === environments.length - 1;

        return (
          <div
            key={environment.id}
            className={
              "flex flex-wrap items-center gap-3 px-4 py-3" +
              (isLast ? "" : " border-border-soft border-b")
            }
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className="text-fg-1 hover:text-accent-press truncate text-[14px] font-semibold"
                  to={`/environment/${environment.id}`}
                >
                  {environment.name}
                </Link>
                <EnvironmentBadges environment={environment} />
              </div>
              <div className="text-fg-3 mt-1 line-clamp-1 text-[12px]">
                {environment.description || "No description"}
              </div>
              <div className="text-fg-3 mt-1 text-[11.5px]">
                Owner: {environment.owner.name ?? "System"}
              </div>
            </div>
            {environment.isDefault ? (
              <span className="text-fg-3 inline-flex items-center gap-1 text-[12px]">
                <Check className="size-3.5" />
                Default
              </span>
            ) : (
              <Button
                disabled={isPending}
                onClick={() => {
                  onSetDefault(environment.id);
                }}
                size="sm"
                variant="outline"
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Setting…
                  </>
                ) : (
                  <>
                    <Star className="size-3.5" />
                    Set as default
                  </>
                )}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
