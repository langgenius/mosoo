import { Box } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";
import { AppIdBadge } from "@/shared/ui/app-id-badge";

import { DeployActions } from "./components/deploy-actions";
import { DeployOverview } from "./components/deploy-overview";
import { DeployRepoCard } from "./components/deploy-repo-card";
import { StatusBadge } from "./components/deploy-status-badge";
import { ActivitySection } from "./components/deployments-history";
import type { DeployConsoleState } from "./deploy-console-data";

/** The console shape both data sources (live GraphQL, fixture) expose. */
export interface DeployConsoleController {
  state: DeployConsoleState;
  deploying: boolean;
  canDeploy: boolean;
  deployRepo: (repoUrl: string) => void;
  retryDeploy: () => void;
  deleteDeployment: () => void;
}

function LoadErrorBanner({ className, message }: { className?: string; message: string }) {
  return (
    <div className={cn("bg-destructive/8 rounded-md px-3 py-2 text-[12.5px]", className)}>
      <span className="text-destructive font-semibold">Couldn&apos;t load deployment status: </span>
      <span className="text-fg-2">{message}</span>
    </div>
  );
}

/**
 * The Overview deploy surface shared verbatim by the live "/" route and the
 * fixture-backed /v0-deploy-preview acceptance route — one composition, two
 * data sources, so the preview can never drift from production.
 *
 * Pre-deploy the body is the empty state: `emptyHero` (the install guide) and
 * the repo-deploy card. Once a deployment exists it is the deploy console:
 * status pill + actions, preview hatch, URL/Source/agents cards, Activity.
 * A load error never blanks the page — the empty state needs no data at all.
 */
export function DeploySurface({
  appId,
  appName,
  deleteError = null,
  deploy,
  deployError,
  emptyHero,
  headerActions,
  headerBadges,
  loadError = null,
  loading = false,
  runsError = null,
}: {
  appId: string;
  appName: string;
  /** `deleteAppDeployment` mutation error. */
  deleteError?: string | null;
  deploy: DeployConsoleController;
  /** `deployApp` mutation error — surfaced inline next to the deploy form. */
  deployError: string | null;
  /** Pre-deploy hero content (the install guide) rendered above the repo card. */
  emptyHero?: ReactNode;
  /** Right-aligned header extras (route-specific links or demo controls). */
  headerActions?: ReactNode;
  /** Extra badges next to the App name (e.g. the preview's "Demo data"). */
  headerBadges?: ReactNode;
  /** The overview read failed — shown as a banner, never a blank page. */
  loadError?: string | null;
  loading?: boolean;
  /** The run-list read failed — surfaced inside the Activity section. */
  runsError?: string | null;
}) {
  const { deployment, runs, agents } = deploy.state;
  const latestRun = runs[0];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 flex-col items-start justify-between gap-4 border-b px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:px-8">
        <div className="min-w-0">
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase">
            <Box className="size-3.5" />
            App
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-foreground min-w-0 truncate text-2xl font-semibold tracking-normal">
              {appName}
            </h1>
            <AppIdBadge appId={appId} />
            {deployment !== null && latestRun !== undefined ? (
              <StatusBadge status={latestRun.status} />
            ) : null}
            {headerBadges}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          {deployment === null ? null : (
            <DeployActions
              appName={appName}
              agentCount={agents.length}
              latestStatus={latestRun?.status ?? null}
              deploying={deploy.deploying}
              canDeploy={deploy.canDeploy}
              onRetry={deploy.retryDeploy}
              onDelete={deploy.deleteDeployment}
            />
          )}
          {headerActions}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {loading ? (
          <p className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading deployment…
          </p>
        ) : deployment === null ? (
          <div className="mx-auto flex max-w-4xl flex-col gap-8">
            {loadError === null ? null : <LoadErrorBanner message={loadError} />}
            {emptyHero}
            <DeployRepoCard
              appId={appId}
              deploying={deploy.deploying}
              serverError={deployError}
              onDeploy={deploy.deployRepo}
            />
            <ActivitySection preDeploy runs={[]} error={runsError} />
          </div>
        ) : (
          <div className="mx-auto max-w-5xl">
            {deleteError === null ? null : (
              <p className="text-destructive mb-4 text-[12.5px]">{deleteError}</p>
            )}
            {loadError === null ? null : <LoadErrorBanner className="mb-4" message={loadError} />}
            <DeployOverview
              deployment={deployment}
              latestRun={latestRun}
              agents={agents}
              deploying={deploy.deploying}
              deployError={deployError}
              onDeployRepo={deploy.deployRepo}
            />
            <ActivitySection className="mt-12" runs={runs} error={runsError} />
          </div>
        )}
      </main>
    </div>
  );
}
