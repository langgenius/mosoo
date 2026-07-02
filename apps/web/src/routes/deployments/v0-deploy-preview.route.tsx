import { Box, CircleAlert } from "lucide-react";

import { Layout } from "@/app/app-shell";
import { AppIdBadge } from "@/shared/ui/app-id-badge";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { AppOverviewInstallGuide } from "../app-overview/app-overview-install";
import { DeployActions } from "./components/deploy-actions";
import { DeployOverview } from "./components/deploy-overview";
import { DeployRepoCard } from "./components/deploy-repo-card";
import { StatusBadge } from "./components/deploy-status-badge";
import { ActivityEmptyHint, DeploymentsHistory } from "./components/deployments-history";
import { DEPLOY_APP_IDENTITY } from "./deploy-console-data";
import { useDeployConsole } from "./use-deploy-console";

/**
 * Unauthenticated acceptance entry for the Overview deploy surface.
 *
 * Renders the same composition as the live App Overview ("/") inside the real
 * App-layer chrome but outside the auth guard, backed by the in-memory fixture
 * so it reviews on the web dev server alone (no API, login, or seeded data).
 * The simulated run machine walks empty → deploying → live, and the demo
 * control below the header showcases the failed state.
 */
export function V0DeployPreviewPage() {
  const { state, deploying, deployRepo, retryDeploy, failDeploy, deleteDeployment } =
    useDeployConsole();

  const { deployment, runs, agents } = state;
  const latestRun = runs[0];
  const canDeploy = deployment !== null && !deploying;

  return (
    <Layout>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="border-border bg-background flex shrink-0 flex-col items-start justify-between gap-4 border-b px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:px-8">
          <div className="min-w-0">
            <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase">
              <Box className="size-3.5" />
              App
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-foreground min-w-0 truncate text-2xl font-semibold tracking-normal">
                {DEPLOY_APP_IDENTITY.appName}
              </h1>
              <AppIdBadge appId={DEPLOY_APP_IDENTITY.appId} />
              {deployment !== null && latestRun !== undefined ? (
                <StatusBadge status={latestRun.status} />
              ) : null}
              <Badge variant="soil">Demo data</Badge>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            {deployment === null ? null : (
              <DeployActions
                appName={DEPLOY_APP_IDENTITY.appName}
                agentCount={agents.length}
                latestStatus={latestRun?.status ?? null}
                deploying={deploying}
                canDeploy={canDeploy}
                onRetry={retryDeploy}
                onDelete={deleteDeployment}
              />
            )}
            {deployment === null || deploying ? null : (
              <Button variant="outline" size="sm" onClick={failDeploy}>
                <CircleAlert className="size-3.5" />
                Simulate failed deploy
              </Button>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          {deployment === null ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-8">
              <AppOverviewInstallGuide />
              <DeployRepoCard
                appId={DEPLOY_APP_IDENTITY.appId}
                deploying={deploying}
                serverError={null}
                onDeploy={deployRepo}
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
              <DeployOverview
                deployment={deployment}
                latestRun={latestRun}
                agents={agents}
                deploying={deploying}
                deployError={null}
                onDeployRepo={deployRepo}
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
    </Layout>
  );
}
