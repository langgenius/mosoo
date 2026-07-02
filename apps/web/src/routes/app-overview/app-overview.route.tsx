import { Bot, KeyRound } from "lucide-react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";

import { AppOverviewInstallGuide } from "./app-overview-install";
import { DeploySurface } from "./deploy/deploy-surface";
import { useLiveDeployConsole } from "./deploy/use-live-deploy-console";

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
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? "Loading App…" : "No App available."}
      </div>
    );
  }

  return (
    <DeploySurface
      appId={activeApp.id}
      appName={live.appName}
      deploy={live}
      loading={live.loading}
      loadError={live.loadError}
      runsError={live.runsError}
      deployError={live.deployError}
      deleteError={live.deleteError}
      emptyHero={<AppOverviewInstallGuide />}
      headerActions={
        <>
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
        </>
      }
    />
  );
}
