import { Bot, Box, KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { AppIdBadge } from "@/shared/ui/app-id-badge";

import { DeployActions } from "../deployments/components/deploy-actions";
import { DeployOverview } from "../deployments/components/deploy-overview";
import { DeployRepoCard } from "../deployments/components/deploy-repo-card";
import { StatusBadge } from "../deployments/components/deploy-status-badge";
import {
  ActivityEmptyHint,
  DeploymentsHistory,
} from "../deployments/components/deployments-history";
import { useLiveDeployConsole } from "../deployments/use-live-deploy-console";
import { AppOverviewInstallGuide } from "./app-overview-install";

function CenteredNotice({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      {children}
    </div>
  );
}

/**
 * The App Overview at "/": before the first deploy it is the install guide
 * plus the deploy-from-repo card; once a deployment exists it becomes the
 * deploy console — status, live URL, source, bound agents, and run activity.
 */
export function AppOverviewPage() {
  const { activeApp, appsLoading } = useAppSession();
  const appId = activeApp?.id ?? null;
  const live = useLiveDeployConsole(appId, activeApp?.name ?? "");

  if (activeApp === null) {
    return <CenteredNotice>{appsLoading ? "Loading App…" : "No App available."}</CenteredNotice>;
  }

  const { deployment, runs, agents } = live.state;
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
              {activeApp.name}
            </h1>
            <AppIdBadge appId={activeApp.id} />
            {deployment !== null && latestRun !== undefined ? (
              <StatusBadge status={latestRun.status} />
            ) : null}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          {deployment === null ? null : (
            <DeployActions
              appName={live.appName}
              agentCount={agents.length}
              latestStatus={latestRun?.status ?? null}
              deploying={live.deploying}
              canDeploy={live.canDeploy}
              onRetry={live.retryDeploy}
              onDelete={live.deleteDeployment}
            />
          )}
          <Link
            to="/providers"
            className="border-border hover:bg-muted inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors sm:flex-none"
          >
            <KeyRound className="size-4" />
            Provider keys
          </Link>
          <Link
            to="/agent?create=1"
            className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold shadow-xs transition-colors sm:flex-none"
          >
            <Bot className="size-4" />
            New agent
          </Link>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {live.loading ? (
          <CenteredNotice>Loading deployment…</CenteredNotice>
        ) : live.loadError !== null && deployment === null && agents.length === 0 ? (
          <CenteredNotice>{live.loadError}</CenteredNotice>
        ) : deployment === null ? (
          <div className="mx-auto flex max-w-4xl flex-col gap-8">
            <AppOverviewInstallGuide />
            <DeployRepoCard
              appId={activeApp.id}
              deploying={live.deploying}
              serverError={live.deployError}
              onDeploy={live.deployRepo}
            />
            <section>
              <h2 className="text-fg-3 mb-3 text-[10.5px] font-semibold tracking-wider uppercase">
                Activity
              </h2>
              <ActivityEmptyHint />
            </section>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl">
            {live.deleteError === null ? null : (
              <p className="text-destructive mb-4 text-[12.5px]">{live.deleteError}</p>
            )}
            <DeployOverview
              deployment={deployment}
              latestRun={latestRun}
              agents={agents}
              deploying={live.deploying}
              deployError={live.deployError}
              onDeployRepo={live.deployRepo}
            />
            <section className="mt-12">
              <h2 className="text-fg-3 mb-3 text-[10.5px] font-semibold tracking-wider uppercase">
                Activity
              </h2>
              <DeploymentsHistory runs={runs} />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
