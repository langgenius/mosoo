import type { ReactNode } from "react";

import { useAppSession } from "@/app/session-provider";

import { DeployConsoleView } from "./components/deploy-console-view";
import { useLiveDeployConsole } from "./use-live-deploy-console";

function CenteredNotice({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      {children}
    </div>
  );
}

/**
 * Protected Deployments console for the active App: one page showing the live
 * deployment ledger + bound agents and the run history. Reads `appOverview` and
 * wires Retry/Delete to the `deployApp` / `deleteAppDeployment` mutations. The
 * fixture-backed preview lives at `/v0-deploy-preview`.
 */
export function DeploymentsPage() {
  const { activeApp, appsLoading } = useAppSession();
  const appId = activeApp?.id ?? null;
  const live = useLiveDeployConsole(appId, activeApp?.name ?? "");

  if (activeApp === null) {
    return <CenteredNotice>{appsLoading ? "Loading App…" : "No App available."}</CenteredNotice>;
  }

  if (live.loading) {
    return <CenteredNotice>Loading deployment…</CenteredNotice>;
  }

  if (live.error !== null && live.state.deployment === null && live.state.agents.length === 0) {
    return <CenteredNotice>{live.error}</CenteredNotice>;
  }

  return (
    <DeployConsoleView
      appName={live.appName}
      state={live.state}
      deploying={live.deploying}
      canDeploy={live.canDeploy}
      onRetry={live.retryDeploy}
      onDelete={live.deleteDeployment}
    />
  );
}
